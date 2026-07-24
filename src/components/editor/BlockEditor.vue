<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  Plus
} from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { deserializeMarkdown } from '@/core/serializer/markdown'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import { detectBlockSyntax } from '@/core/parser/blockSyntax'
import { uuid } from '@/core/blocks/factory'
import type { Block, Mark } from '@/core/blocks/types'
import BlockRenderer from './BlockRenderer.vue'
import { interceptExternalLink, openExternalUrl } from '@/core/serializer/markdownFile'

const doc = useDocumentStore()
const editor = useEditorStore()

const canvasRef = ref<HTMLElement | null>(null)
const sourceText = ref('')
/** 源码模式下用户正在输入时阻止 syncSource 覆盖 textarea */
const isSourceInputting = ref(false)

const selectedId = computed(() => editor.selectedBlockId)

const zoomStyle = computed(() => ({
  width: `calc(var(--a4-width) * ${editor.zoom / 100})`,
  maxWidth: '100%'
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
      // 代码块：特殊处理，内容清空
      doc.updateBlock(id, {
        type: 'code_block',
        content: { code: '' },
        props: syntaxMatch.props ?? {}
      }, '转换为代码块')
    } else if (syntaxMatch.type === 'table' && syntaxMatch.extra?.headers) {
      // 表格：用 headers 初始化,解析每个单元格的行内 marks
      const headers = (syntaxMatch.extra.headers as string[]).map((h) => {
        const parsed = parseInlineMarkdown(h)
        return { text: parsed.text, marks: parsed.marks }
      })
      doc.updateBlock(id, {
        type: 'table',
        content: { headers, rows: [] },
        props: {}
      }, '转换为表格')
    } else if (syntaxMatch.type === 'list') {
      // 列表：创建单元素 items 数组,解析行内 marks
      const parsed = parseInlineMarkdown(syntaxMatch.strippedText)
      const checked = syntaxMatch.extra?.checked as boolean | undefined
      doc.updateBlock(id, {
        type: 'list',
        content: {
          items: [
            { id: uuid(), text: parsed.text, marks: parsed.marks, checked }
          ]
        },
        props: syntaxMatch.props ?? { listType: 'bullet' }
      }, '转换为列表')
    } else if (syntaxMatch.type === 'divider') {
      // 分隔线：无内容
      doc.updateBlock(id, {
        type: 'divider',
        content: {},
        props: {}
      }, '转换为分隔线')
    } else {
      // 标题/引用：解析行内语法
      const parsed = parseInlineMarkdown(syntaxMatch.strippedText)
      doc.updateBlock(id, {
        type: syntaxMatch.type,
        content: { text: parsed.text, marks: parsed.marks },
        props: syntaxMatch.props ?? {}
      }, '转换区块类型')
    }
  }

  // 创建新段落块,如果光标后有剩余文本则带入
  const newId = doc.insertBlockAfter(id, 'paragraph', '新建区块')
  if (afterText) {
    const parsed = parseInlineMarkdown(afterText)
    doc.updateBlock(newId, {
      content: { text: parsed.text, marks: parsed.marks }
    }, '设置分割文本')
  }
  editor.selectBlock(newId)
  await nextTick()
  await nextTick()
  focusBlockAt(newId, 'start')
}

/** 行首 Backspace：合并到上一行（或删除空行） */
async function onBackspaceMerge(id: string) {
  const idx = doc.blocks.findIndex((b) => b.id === id)
  if (idx <= 0) return
  const current = doc.blocks[idx]
  const prev = doc.blocks[idx - 1]

  // 上一行不是可编辑块（divider/page_break/list）→ 仅删除当前行
  if (prev.type !== 'paragraph' && prev.type !== 'heading') {
    doc.removeBlock(id, '删除空区块')
    editor.selectBlock(prev.id)
    await nextTick()
    await nextTick()
    focusBlockAt(prev.id, 'end')
    return
  }

  const prevText = (prev.content.text as string) || ''
  const prevMarks: Mark[] = (prev.content.marks as Mark[]) || []
  const currentText = (current.content.text as string) || ''
  const currentMarks: Mark[] = (current.content.marks as Mark[]) || []

  // 将当前行 marks 偏移到上一行文本末尾
  const offset = prevText.length
  const offsetMarks: Mark[] = currentMarks.map((m) => ({
    ...m,
    start: m.start + offset,
    end: m.end + offset
  }))

  // 合并文本 + marks，更新上一行
  doc.updateBlock(prev.id, {
    content: {
      text: prevText + currentText,
      marks: [...prevMarks, ...offsetMarks]
    }
  }, '合并区块')

  // 删除当前行
  doc.removeBlock(id, '删除空区块')
  editor.selectBlock(prev.id)

  await nextTick()
  await nextTick()
  // 光标停在合并点（上一行原文末尾）
  focusBlockAt(prev.id, offset)
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

function moveUp(id: string) { doc.moveBlockUp(id) }
function moveDown(id: string) { doc.moveBlockDown(id) }
function duplicate(id: string) {
  const newId = doc.duplicateBlock(id)
  if (newId) editor.selectBlock(newId)
}
function remove(id: string) { doc.removeBlock(id, '删除区块') }

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
  sourceText.value = doc.exportMarkdown()
}

function onSourceInput() {
  isSourceInputting.value = true
  const parsed = deserializeMarkdown(sourceText.value)
  doc.replaceBlocks(parsed, '编辑源码')
  nextTick(() => { isSourceInputting.value = false })
}

// 源码模式:blocks 变化时(撤销/重做/外部修改)自动同步 textarea
watch(
  () => doc.blocks,
  () => {
    if (editor.mode === 'source' && !isSourceInputting.value) {
      syncSource()
    }
  },
  { deep: true }
)

/* ===== 全局快捷键 ===== */
function onKeydown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return

  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault()
    e.shiftKey ? doc.redo() : doc.undo()
  } else if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    doc.redo()
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault()
    doc.saveToFile()
  }
  // Ctrl+K 改由 EditorView 统一处理(唤起 AI 浮窗)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => editor.mode,
  (mode, prevMode) => {
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
  }
)
</script>

<template>
  <div class="editor-canvas no-scrollbar" ref="canvasRef" @click="onCanvasClick">
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
          <div class="block-actions" v-if="selectedId === block.id">
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

          <div class="drag-handle" v-if="selectedId === block.id">
            <Plus :size="10" />
          </div>

          <div class="block-content">
            <BlockRenderer
              :block="block"
              @update="(p) => updateBlock(block.id, p)"
              @enter="(afterText: string) => onEnter(block.id, afterText)"
              @backspace-merge="onBackspaceMerge(block.id)"
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
  box-shadow: var(--shadow-lg), 0 1px 3px rgba(0, 0, 0, 0.06);
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