<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronUp, ChevronDown, Copy, Trash2, Plus } from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { deserializeMarkdown } from '@/core/serializer/markdown'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import { detectBlockSyntax } from '@/core/parser/blockSyntax'
import { uuid } from '@/core/blocks/factory'
import type { Block, BlockType, Mark } from '@/core/blocks/types'
import BlockRenderer from './BlockRenderer.vue'
import { interceptExternalLink, openExternalUrl } from '@/core/serializer/markdownFile'
import { marksToSource } from '@/components/blocks/marks'

const doc = useDocumentStore()
const editor = useEditorStore()

const canvasRef = ref<HTMLElement | null>(null)
const sourceText = ref('')
/** 源码模式下用户正在输入时阻止 syncSource 覆盖 textarea */
const isSourceInputting = ref(false)
/** 源码模式提交防抖定时器 */
let sourceCommitTimer: ReturnType<typeof setTimeout> | null = null

/** 行首 Backspace 合并两个文本块时插入的分隔符 */
const BLOCK_MERGE_SEPARATOR = ' '

const selectedId = computed(() => editor.selectedBlockId)

const zoomStyle = computed(() => ({
  width: `calc(var(--a4-width) * ${editor.zoom / 100})`,
  maxWidth: '100%',
}))

function selectBlock(id: string) {
  editor.selectBlock(id)
}

function updateBlock(id: string, patch: Partial<Block>) {
  doc.updateBlock(id, patch, '编辑内容')
}

async function onEnter(id: string, afterText: string = '') {
  const block = doc.blocks.find((b) => b.id === id)
  if (!block) return

  // 代码块内回车：不触发转换，直接换行
  if (block.type === 'code_block') {
    return
  }

  /**
   * 语法转换后统一收尾：在当前块之后新建一个段落并把光标放到段落开头。
   * afterText(Enter 时位于光标之后的原文)会写入新段落，避免拆分时丢字。
   * 转换与新建放在同一个 batch 里，只产生一条历史记录。
   */
  async function continueAfterConversion(patch: {
    type: BlockType
    content: Record<string, unknown>
    props?: Record<string, unknown>
  }) {
    const newId = doc.batch(() => {
      doc.updateBlock(id, patch, '转换区块类型')
      const nid = doc.insertBlockAfter(id, 'paragraph', '新建区块')
      if (afterText) {
        const parsed = parseInlineMarkdown(afterText)
        doc.updateBlock(
          nid,
          { content: { text: parsed.text, marks: parsed.marks } },
          '设置分割文本',
        )
      }
      return nid
    }, '转换区块类型')
    editor.selectBlock(newId)
    await nextTick()
    await nextTick()
    focusBlockAt(newId, 'start')
  }

  // 检测块级 Markdown 语法（# 标题、- 列表、> 引用、``` 代码块 等）
  const rawText = (block.content.text as string) || ''
  const syntaxMatch = detectBlockSyntax(rawText)

  if (syntaxMatch && syntaxMatch.type !== 'paragraph') {
    if (syntaxMatch.type === 'code_block') {
      doc.updateBlock(
        id,
        {
          type: 'code_block',
          content: { code: rawText },
          props: syntaxMatch.props ?? {},
        },
        '转换为代码块',
      )
      return
    }
    // 表格分支目前不可达:blockSyntax.detectBlockSyntax 已显式禁用表格检测
    if (syntaxMatch.type === 'table' && syntaxMatch.extra?.headers) {
      const headers = (syntaxMatch.extra.headers as string[]).map((h) => {
        const parsed = parseInlineMarkdown(h)
        return { text: parsed.text, marks: parsed.marks }
      })
      doc.updateBlock(
        id,
        {
          type: 'table',
          content: { headers, rows: [] },
          props: {},
        },
        '转换为表格',
      )
      return
    }
    if (syntaxMatch.type === 'list') {
      const parsed = parseInlineMarkdown(syntaxMatch.strippedText)
      const checked = syntaxMatch.extra?.checked as boolean | undefined
      await continueAfterConversion({
        type: 'list',
        content: {
          items: [{ id: uuid(), text: parsed.text, marks: parsed.marks, checked }],
        },
        props: syntaxMatch.props ?? { listType: 'bullet' },
      })
      return
    }
    if (syntaxMatch.type === 'divider') {
      doc.updateBlock(
        id,
        {
          type: 'divider',
          content: {},
          props: {},
        },
        '转换为分隔线',
      )
      // 分隔线后自动加一个段落以便继续编辑
      const nextId = doc.insertBlockAfter(id, 'paragraph', '新建区块')
      editor.selectBlock(nextId)
      await nextTick()
      await nextTick()
      focusBlockAt(nextId, 'start')
      return
    }
    // 标题/引用：解析行内语法，转换后在其后新建段落继续书写
    const parsed = parseInlineMarkdown(syntaxMatch.strippedText)
    await continueAfterConversion({
      type: syntaxMatch.type,
      content: { text: parsed.text, marks: parsed.marks },
      props: syntaxMatch.props ?? {},
    })
    return
  }

  // 普通 Enter：在当前块后插入新段落(批处理,只产生一条历史记录)
  const newId = doc.batch(() => {
    const nid = doc.insertBlockAfter(id, 'paragraph', '新建区块')
    if (afterText) {
      const parsed = parseInlineMarkdown(afterText)
      doc.updateBlock(nid, { content: { text: parsed.text, marks: parsed.marks } }, '设置分割文本')
    }
    return nid
  }, '新建区块')
  editor.selectBlock(newId)
  await nextTick()
  await nextTick()
  focusBlockAt(newId, 'start')
}

const TEXT_BASED_TYPES = new Set(['paragraph', 'heading', 'quote'])

function findEditableBlockIndex(fromIdx: number): number {
  for (let i = fromIdx; i >= 0; i--) {
    if (TEXT_BASED_TYPES.has(doc.blocks[i].type)) return i
  }
  return -1
}

function findEditableBlockIndexForward(fromIdx: number): number {
  for (let i = fromIdx; i < doc.blocks.length; i++) {
    if (TEXT_BASED_TYPES.has(doc.blocks[i].type)) return i
  }
  return -1
}

/**
 * 计算合并后 prev 块中「两段文字交界处」的 DOM 偏移量。
 *
 * 不能用 getDomMergePoint(prev) —— 它基于 prev **单独渲染**时的文本长度，
 * 而合并后的 prev 文本多了一个分隔符，引用块的 DOM 前缀还要按合并后的行数重算。
 */
function getMergedBoundaryOffset(prev: Block, prevSourceLen: number, prevText: string): number {
  const sepLen = BLOCK_MERGE_SEPARATOR.length
  if (prev.type === 'heading') {
    const level = (prev.props as { level?: number }).level ?? 1
    // DOM = '#'.repeat(level) + ' ' + source
    return level + 1 + prevSourceLen + sepLen
  }
  if (prev.type === 'quote') {
    // QuoteBlock.renderSource 对合并后的每一行都前置 '> ',
    // 因此前缀个数必须按**合并后**的行数算(prevText 本身可能已含换行)
    const mergedLineCount = (prevText + BLOCK_MERGE_SEPARATOR).split('\n').length
    return prevSourceLen + sepLen + mergedLineCount * 2
  }
  return prevSourceLen + sepLen
}

/** 行首 Backspace：合并到上一行（或删除空行） */
async function onBackspaceMerge(id: string) {
  const idx = doc.blocks.findIndex((b) => b.id === id)
  if (idx <= 0) return
  const current = doc.blocks[idx]
  const prev = doc.blocks[idx - 1]

  // 上一行不是可编辑文本块 → 仅删除当前行，focus 跳到最近的可编辑块末尾
  if (!TEXT_BASED_TYPES.has(prev.type)) {
    doc.removeBlock(id, '删除空区块')
    const targetIdx = findEditableBlockIndex(idx - 2)
    if (targetIdx >= 0) {
      editor.selectBlock(doc.blocks[targetIdx].id)
    } else {
      editor.selectBlock(prev.id)
    }
    await nextTick()
    await nextTick()
    if (targetIdx >= 0) {
      focusBlockAt(doc.blocks[targetIdx].id, 'end')
    }
    return
  }

  const prevText = (prev.content.text as string) || ''
  const prevMarks: Mark[] = (prev.content.marks as Mark[]) || []
  let currentText = ''
  let currentMarks: Mark[] = []
  if (current.type === 'code_block') {
    currentText = (current.content.code as string) || ''
  } else if (TEXT_BASED_TYPES.has(current.type)) {
    currentText = (current.content.text as string) || ''
    currentMarks = (current.content.marks as Mark[]) || []
  }

  // 行首 Backspace 合并两段时应插入分隔符,否则 abc + def 会粘成 abcdef
  const sep = BLOCK_MERGE_SEPARATOR

  // 将当前行 marks 偏移到合并后的位置(marks 基于纯文本坐标)
  const mergePoint = prevText.length + sep.length
  const offsetMarks: Mark[] = currentMarks.map((m) => ({
    ...m,
    start: m.start + mergePoint,
    end: m.end + mergePoint,
  }))

  // prev 的 marks 原本止于 prevText.length,插入分隔符后会被拉长,
  // 导致格式"越过"交界处包住后一段文字(如 abc 加粗则 def 也变粗)。
  // 这里把 prev 的 marks 截断到 prevText.length,再与偏移后的 current marks 拼接。
  const clampedPrevMarks: Mark[] = prevMarks.map((m) => ({
    ...m,
    start: Math.min(m.start, prevText.length),
    end: Math.min(m.end, prevText.length),
  }))

  // 交界处在 DOM 源码文本中的偏移量(updateBlock 之前计算,避免 prev 被替换)
  const prevSourceLen = marksToSource(prevText, prevMarks).length
  const domMergePoint = getMergedBoundaryOffset(prev, prevSourceLen, prevText)

  // 合并文本 + marks, 删除当前行(批处理,只产生一条历史记录)
  doc.batch(() => {
    doc.updateBlock(
      prev.id,
      {
        content: {
          text: prevText + sep + currentText,
          marks: [...clampedPrevMarks, ...offsetMarks],
        },
      },
      '合并区块',
    )
    // 删除当前行
    doc.removeBlock(id, '删除空区块')
  }, '合并区块')
  editor.selectBlock(prev.id)

  await nextTick()
  await nextTick()
  focusBlockAt(prev.id, domMergePoint)
}

async function onConvert(id: string, targetType: string) {
  const block = doc.blocks.find((b) => b.id === id)
  if (!block) return
  const textBaseProps =
    targetType === 'heading'
      ? { level: (block.props as { level?: number }).level ?? 2 }
      : { align: (block.props as { align?: string }).align ?? 'left' }
  doc.updateBlock(id, { type: targetType, props: textBaseProps }, '转换区块类型')
  editor.selectBlock(id)
  await nextTick()
  await nextTick()
  focusBlockAt(id, 'start')
}

async function onListOutdent(id: string, payload: { idx: number; text: string; marks: Mark[] }) {
  const blockIdx = doc.blocks.findIndex((b) => b.id === id)
  if (blockIdx === -1) return
  const block = doc.blocks[blockIdx]
  if (block.type !== 'list') return
  const items = (
    block.content as { items: Array<{ id: string; text: string; marks: Mark[]; checked: boolean }> }
  ).items
  const before = items.slice(0, payload.idx)
  const after = items.slice(payload.idx + 1)
  const listType = (block.props as { listType?: string }).listType ?? 'bullet'

  const paraId = doc.batch(() => {
    let anchorId: string | null = null
    if (before.length > 0) {
      doc.updateBlock(id, { content: { items: before } }, '更新列表')
      anchorId = id
    } else {
      doc.removeBlock(id, '删除空列表')
      anchorId = blockIdx > 0 ? doc.blocks[blockIdx - 1].id : null
    }

    const pid = doc.insertBlockAfter(anchorId, 'paragraph', '列表项转段落')
    doc.updateBlock(pid, { content: { text: payload.text, marks: payload.marks } })

    if (after.length > 0) {
      const newListId = doc.insertBlockAfter(pid, 'list', '拆分列表', listType as any)
      doc.updateBlock(newListId, { content: { items: after } })
    }
    return pid
  }, '列表项转段落')

  editor.selectBlock(paraId)
  await nextTick()
  await nextTick()
  focusBlockAt(paraId, 'start')
}

function onNavigate(id: string, direction: 'prev' | 'next') {
  const idx = doc.blocks.findIndex((b) => b.id === id)
  if (idx === -1) return
  let targetIdx = -1
  let targetPos: 'start' | 'end' = 'end'
  if (direction === 'prev') {
    targetIdx = findEditableBlockIndex(idx - 1)
    targetPos = 'end'
  } else {
    targetIdx = findEditableBlockIndexForward(idx + 1)
    targetPos = 'start'
  }
  if (targetIdx >= 0) {
    const target = doc.blocks[targetIdx]
    editor.selectBlock(target.id)
    nextTick(() => focusBlockAt(target.id, targetPos))
  }
}

function focusBlockAt(id: string, at: 'start' | 'end' | number) {
  if (!canvasRef.value) return
  const row = canvasRef.value.querySelector(`[data-block-id="${id}"]`)
  if (!row) return
  const editable = row.querySelector('[contenteditable="true"]') as HTMLElement | null
  if (!editable) return
  editable.focus()
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()

  if (at === 'start') {
    const child = editable.firstChild
    range.setStart(child || editable, 0)
    range.setEnd(child || editable, 0)
  } else if (at === 'end') {
    const child = editable.lastChild
    const len = child?.textContent?.length ?? 0
    range.setStart(child || editable, len)
    range.setEnd(child || editable, len)
  } else {
    // 数字偏移：遍历文本节点定位
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT)
    let remaining = at
    let placed = false
    let node: Node | null
    while ((node = walker.nextNode())) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) {
        range.setStart(node, remaining)
        range.setEnd(node, remaining)
        placed = true
        break
      }
      remaining -= len
    }
    if (!placed) {
      const child = editable.lastChild
      const len = child?.textContent?.length ?? 0
      range.setStart(child || editable, len)
      range.setEnd(child || editable, len)
    }
  }

  sel.removeAllRanges()
  sel.addRange(range)
}

function moveUp(id: string) {
  doc.moveBlockUp(id)
}
function moveDown(id: string) {
  doc.moveBlockDown(id)
}
function duplicate(id: string) {
  const newId = doc.duplicateBlock(id)
  if (newId) editor.selectBlock(newId)
}
function remove(id: string) {
  doc.removeBlock(id, '删除区块')
}

/** 同步检测并拦截外链点击，返回是否处理了 */
function isExternalLinkClick(e: MouseEvent): boolean {
  const href = interceptExternalLink(e)
  if (href) {
    openExternalUrl(href)
    return true
  }
  return false
}

function onBlockRowClick(e: MouseEvent, id: string) {
  if (isExternalLinkClick(e)) return
  selectBlock(id)
}

function onCanvasClick(e: MouseEvent) {
  if (isExternalLinkClick(e)) return
  if (e.target === e.currentTarget) {
    // 点击画布空白处:仅取消选中,不新建块、不跳转光标
    editor.selectBlock(null)
  }
}

function onEndAreaClick() {
  const newId = doc.appendBlock('paragraph')
  editor.selectBlock(newId)
  nextTick(() => focusBlockAt(newId, 'start'))
}

function syncSource() {
  if (isSourceInputting.value) return
  sourceText.value = doc.exportMarkdown()
}

function onSourceInput() {
  isSourceInputting.value = true
  // 防抖提交:连续输入时只产生一条历史记录
  if (sourceCommitTimer) clearTimeout(sourceCommitTimer)
  sourceCommitTimer = setTimeout(() => {
    const parsed = deserializeMarkdown(sourceText.value)
    doc.replaceBlocks(parsed, '编辑源码')
    sourceCommitTimer = null
    nextTick(() => {
      isSourceInputting.value = false
    })
  }, 500)
}

// 源码模式:renderTick 变化时(撤销/重做/外部修改)自动同步 textarea
watch(
  () => [doc.renderTick, editor.mode],
  () => {
    if (editor.mode === 'source' && !isSourceInputting.value) {
      syncSource()
    }
  },
)

/* ===== 全局快捷键 ===== */
/** 让当前正在编辑的 contenteditable 失焦以触发 onBlur 提交,避免未保存内容丢失 */
function flushPendingEdit() {
  const ae = document.activeElement as HTMLElement | null
  if (ae && ae.closest('[contenteditable="true"]')) {
    ae.blur()
  }
}

/**
 * 判断按键事件是否真的来自编辑器画布。
 *
 * 本处理器挂在 window 上(见 onMounted),否则它会对**整个应用**生效:
 * 在 AI 面板输入框里打字时,只要编辑器还留着 selectedBlockId,
 * 按 Backspace 就会删掉文档里的块、按 Ctrl+Z 会撤销文档而不是撤销输入框。
 * 因此凡是可能改动文档的分支,都必须先确认事件源在画布内。
 */
function isEventFromEditor(e: KeyboardEvent): boolean {
  const canvas = canvasRef.value
  const inCanvas = (n: Node | null | undefined): boolean =>
    !!canvas && !!n && (canvas === n || canvas.contains(n))
  // 正常情况:事件源就是正在编辑的 contenteditable
  if (inCanvas(e.target as Node | null)) return true
  // 兜底:个别情况(如 IME 组合、事件源被解析为 body)下 e.target 不可靠,
  // 改看当前焦点元素是否落在画布内
  return inCanvas(document.activeElement)
}

function onKeydown(e: KeyboardEvent) {
  // 焦点不在编辑器内 → 完全不干预,把按键交还给当前控件(AI 输入框、设置页输入框等)
  if (!isEventFromEditor(e)) return

  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl) {
    // 源码模式下:Ctrl+Z/Y 交给 textarea 处理(字符级撤销),Ctrl+S 保存前先 flush 未提交修改
    if (editor.mode === 'source') {
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        if (sourceCommitTimer) {
          clearTimeout(sourceCommitTimer)
          sourceCommitTimer = null
          const parsed = deserializeMarkdown(sourceText.value)
          doc.replaceBlocks(parsed, '编辑源码')
          isSourceInputting.value = false
        }
        doc.saveToFile()
      }
      return
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault()
      flushPendingEdit()
      if (e.shiftKey) doc.redo()
      else doc.undo()
    } else if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault()
      flushPendingEdit()
      doc.redo()
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault()
      doc.saveToFile()
    }
    return
  }

  // 源码模式:不响应 block 相关快捷键
  if (editor.mode === 'source') return

  if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId.value) {
    const ae = document.activeElement as HTMLElement | null
    const inEditable = ae?.closest('[contenteditable="true"]')
    if (!inEditable) {
      e.preventDefault()
      const idx = doc.blocks.findIndex((b) => b.id === selectedId.value)
      doc.removeBlock(selectedId.value, '删除区块')
      const focusTarget = doc.blocks[Math.max(0, idx - 1)]
      if (focusTarget) {
        editor.selectBlock(focusTarget.id)
        nextTick(() => focusBlockAt(focusTarget.id, 'end'))
      }
    }
  }
}

/** Flush 源码模式的未提交修改(防止防抖期间关闭导致内容丢失) */
function flushSourceCommit() {
  if (sourceCommitTimer) {
    clearTimeout(sourceCommitTimer)
    sourceCommitTimer = null
    const parsed = deserializeMarkdown(sourceText.value)
    doc.replaceBlocks(parsed, '编辑源码')
    isSourceInputting.value = false
  }
}

/**
 * 焦点落到编辑器之外的"非按钮"控件时清空选中块。
 *
 * 选中态原本只由"点画布空白"和"切到源码模式"两处清除,导致点了 AI 面板输入框后
 * selectedBlockId 仍然悬空。按钮类元素排除在外,以便工具栏的"转换为…/插入…"
 * 仍能作用于当前选中块。
 */
function onDocumentFocusIn(e: FocusEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  // 焦点仍在编辑器内 → 保留选中
  if (target === canvasRef.value || canvasRef.value?.contains(target)) return
  // 按钮/链接等"动作型"控件保留选中,让工具栏能作用于当前块
  const tag = target.tagName
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return
  if (target.closest('button, a, [role="button"]')) return
  // AI 面板自身的控件(重命名输入框等)也算编辑目标,清掉选中更安全
  editor.selectBlock(null)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', flushSourceCommit)
  // 捕获阶段监听,确保在控件自身的 focus 处理之前完成选中态清理
  document.addEventListener('focusin', onDocumentFocusIn, true)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', flushSourceCommit)
  document.removeEventListener('focusin', onDocumentFocusIn, true)
  flushSourceCommit()
})

watch(
  () => editor.mode,
  (mode, prevMode) => {
    // 切出源码模式:若有未提交的防抖修改,立即提交
    if (prevMode === 'source') {
      flushSourceCommit()
    }
    // 从可视化切到源码模式:先让当前正在编辑的 contenteditable 提交内容(必须在 DOM 被卸载前)
    if (mode === 'source' && prevMode !== 'source') {
      flushPendingEdit()
      editor.selectBlock(null)
    }
    if (!canvasRef.value || !prevMode) return
    const canvas = canvasRef.value
    // 切换前:记录旧模式下视口中线在总内容中的比例
    const totalH = canvas.scrollHeight
    const clientH = canvas.clientHeight
    const midY = canvas.scrollTop + clientH / 2
    const ratio = totalH > 0 ? midY / totalH : 0

    if (mode === 'source') syncSource()

    // 切换后:用 requestAnimationFrame 等浏览器完成布局再计算新高度
    // (textarea 自动换行、block 渲染需要一次布局周期,nextTick 时机过早)
    const applyScroll = () => {
      const newTotal = canvas.scrollHeight
      const newClient = canvas.clientHeight
      const newMidY = ratio * newTotal
      const maxScroll = Math.max(0, newTotal - newClient)
      canvas.scrollTop = Math.max(0, Math.min(maxScroll, newMidY - newClient / 2))
    }
    // 先 nextTick 让 Vue 完成虚拟 DOM patch,再 rAF 等布局完成
    nextTick(() => requestAnimationFrame(applyScroll))
  },
)
</script>

<template>
  <div ref="canvasRef" class="editor-canvas no-scrollbar" @click="onCanvasClick">
    <!-- 源码模式 -->
    <div v-if="editor.mode === 'source'" class="source-wrap" :style="zoomStyle">
      <textarea
        v-model="sourceText"
        class="source-textarea"
        spellcheck="false"
        placeholder="在此编辑 Markdown 源码..."
        @input="onSourceInput"
      ></textarea>
    </div>

    <!-- 可视化模式 -->
    <div v-else class="paper-wrap" :style="zoomStyle">
      <div class="a4-paper">
        <div
          v-for="block in doc.blocks"
          :key="block.id"
          class="block-row"
          :class="{ selected: selectedId === block.id }"
          :data-block-id="block.id"
          @click.stop="(e: MouseEvent) => onBlockRowClick(e, block.id)"
        >
          <!-- Block 操作按钮 -->
          <div v-if="selectedId === block.id" class="block-actions">
            <button class="action-btn" title="上移" @click.stop="moveUp(block.id)">
              <ChevronUp :size="12" />
            </button>
            <button class="action-btn" title="下移" @click.stop="moveDown(block.id)">
              <ChevronDown :size="12" />
            </button>
            <button class="action-btn" title="复制" @click.stop="duplicate(block.id)">
              <Copy :size="12" />
            </button>
            <button class="action-btn danger" title="删除" @click.stop="remove(block.id)">
              <Trash2 :size="12" />
            </button>
          </div>

          <div v-if="selectedId === block.id" class="drag-handle">
            <Plus :size="10" />
          </div>

          <div class="block-content">
            <BlockRenderer
              :block="block"
              @update="(p) => updateBlock(block.id, p)"
              @enter="(afterText: string) => onEnter(block.id, afterText)"
              @backspace-merge="onBackspaceMerge(block.id)"
              @convert="(t: string) => onConvert(block.id, t)"
              @outdent="(p) => onListOutdent(block.id, p)"
              @navigate="(d) => onNavigate(block.id, d)"
              @select="selectBlock(block.id)"
            />
          </div>
        </div>

        <div class="end-area" @click.stop="onEndAreaClick"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-canvas {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: var(--muted);
}
.paper-wrap {
  margin: 0 auto;
}
.a4-paper {
  width: 100%;
  min-height: var(--a4-min-height);
  padding: 48px 48px 24px;
  background: var(--card);
  border-radius: 8px;
  box-shadow:
    var(--shadow-lg),
    0 1px 3px rgba(0, 0, 0, 0.06);
}
.block-row {
  position: relative;
  border-radius: 4px;
  transition: background 0.12s ease;
}
.block-row.selected {
  background: var(--secondary);
}
.block-actions {
  position: absolute;
  left: -40px;
  top: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.block-row.selected .block-actions {
  opacity: 1;
}
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--muted-foreground);
  background: var(--card);
  border: 1px solid var(--border);
}
.action-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.action-btn.danger:hover {
  color: var(--destructive);
}
.drag-handle {
  position: absolute;
  left: -16px;
  top: 6px;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
  cursor: grab;
  opacity: 0;
}
.block-row.selected .drag-handle {
  opacity: 0.6;
}
.block-content {
  position: relative;
}
.end-area {
  min-height: 80px;
}
.source-wrap {
  margin: 0 auto;
}
.source-textarea {
  width: 100%;
  min-height: var(--a4-min-height);
  padding: 48px;
  background: var(--card);
  border: none;
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
  color: var(--foreground);
  resize: vertical;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
