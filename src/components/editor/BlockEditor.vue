<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronUp, ChevronDown, Copy, Trash2, Plus } from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { deserializeMarkdown } from '@/core/serializer/markdown'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import { detectBlockSyntax } from '@/core/parser/blockSyntax'
import { uuid } from '@/core/blocks/factory'
import type { Block, Mark } from '@/core/blocks/types'
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

  // 检测块级 Markdown 语法（# 标题、- 列表、> 引用、``` 代码块、| 表格 等）
  const rawText = (block.content.text as string) || ''
  const syntaxMatch = detectBlockSyntax(rawText)

  if (syntaxMatch && syntaxMatch.type !== 'paragraph') {
    if (syntaxMatch.type === 'code_block') {
      doc.updateBlock(
        id,
        {
          type: 'code_block',
          content: { code: '' },
          props: syntaxMatch.props ?? {},
        },
        '转换为代码块',
      )
      return
    }
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
      doc.updateBlock(
        id,
        {
          type: 'list',
          content: {
            items: [{ id: uuid(), text: parsed.text, marks: parsed.marks, checked }],
          },
          props: syntaxMatch.props ?? { listType: 'bullet' },
        },
        '转换为列表',
      )
      editor.selectBlock(id)
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
    // 标题/引用：解析行内语法
    const parsed = parseInlineMarkdown(syntaxMatch.strippedText)
    doc.updateBlock(
      id,
      {
        type: syntaxMatch.type,
        content: { text: parsed.text, marks: parsed.marks },
        props: syntaxMatch.props ?? {},
      },
      '转换区块类型',
    )
    editor.selectBlock(id)
    await nextTick()
    await nextTick()
    focusBlockAt(id, 'start')
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

/** 计算合并点在 DOM 源码文本中的偏移量(含语法标记和标题/引用前缀) */
function getDomMergePoint(block: Block): number {
  const text = (block.content.text as string) || ''
  const marks: Mark[] = (block.content.marks as Mark[]) || []
  const source = marksToSource(text, marks)
  const sourceLen = source.length
  if (block.type === 'heading') {
    const level = (block.props as { level?: number }).level ?? 1
    return level + 1 + sourceLen
  }
  if (block.type === 'quote') {
    const lineCount = source.split('\n').length
    return sourceLen + lineCount * 2
  }
  return sourceLen
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

  // 将当前行 marks 偏移到上一行纯文本末尾(marks 基于纯文本坐标)
  const mergePoint = prevText.length
  const offsetMarks: Mark[] = currentMarks.map((m) => ({
    ...m,
    start: m.start + mergePoint,
    end: m.end + mergePoint,
  }))

  // 合并点在 DOM 源码文本中的偏移量(updateBlock 之前计算,避免 prev 被替换)
  const domMergePoint = getDomMergePoint(prev)

  // 合并文本 + marks, 删除当前行(批处理,只产生一条历史记录)
  doc.batch(() => {
    doc.updateBlock(
      prev.id,
      {
        content: {
          text: prevText + currentText,
          marks: [...prevMarks, ...offsetMarks],
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

function onKeydown(e: KeyboardEvent) {
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

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', flushSourceCommit)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', flushSourceCommit)
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
