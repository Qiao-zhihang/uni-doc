<script setup lang="ts">
/**
 * 表格 Block
 * Markdown 语法: | a | b | \n |---|---| \n | 1 | 2 |
 * 单元格内的行内 Markdown 语法(粗体/斜体等)在失焦或回车时渲染
 * 右键单元格弹出上下文菜单:增加行/列、删除行/列
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Block, TableContent, TableCell } from '@/core/blocks/types'
import { marksToHtml, marksToSource } from './marks'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { useWikilinkAutocomplete } from '@/composables/useWikilinkAutocomplete'
import WikilinkPopup from '@/components/common/WikilinkPopup.vue'

const props = defineProps<{ block: Block }>()
const doc = useDocumentStore()
const editor = useEditorStore()
const emit = defineEmits<{
  (e: 'update', patch: Partial<Block>): void
  (e: 'select'): void
}>()

const cellRefs = ref<Map<string, HTMLElement>>(new Map())
const selfUpdate = ref(false)
// 当前编辑中的 cell 元素(用于 wikilink 自动补全)
const activeCellEl = ref<HTMLElement | null>(null)
const autocomplete = useWikilinkAutocomplete({ el: activeCellEl })

const content = () => props.block.content as TableContent

const isSelected = computed(() => editor.selectedBlockId === props.block.id)

function cellKey(rowIdx: number, colIdx: number) {
  return `${rowIdx}:${colIdx}`
}

function setCellRef(el: HTMLElement | null, rowIdx: number, colIdx: number) {
  if (el) cellRefs.value.set(cellKey(rowIdx, colIdx), el)
}

/** 按选中态渲染所有单元格 */
function syncCells() {
  const c = content()
  const renderCell = (cell: TableCell, key: string) => {
    const el = cellRefs.value.get(key)
    if (!el) return
    if (isSelected.value) {
      const source = marksToSource(cell.text, cell.marks)
      el.innerText = source
    } else {
      const html = marksToHtml(cell.text, cell.marks)
      el.innerHTML = html
    }
  }
  c.headers.forEach((cell, colIdx) => renderCell(cell, cellKey(-1, colIdx)))
  c.rows.forEach((row, rowIdx) => {
    row.forEach((cell, colIdx) => renderCell(cell, cellKey(rowIdx, colIdx)))
  })
}

/** 确保表格至少有 1 列表头 + 1 行数据(空表格无法编辑) */
function ensureCells() {
  const c = content()
  if (c.headers.length === 0 && c.rows.length === 0) {
    selfUpdate.value = true
    emit('update', {
      content: {
        headers: [{ text: '', marks: [] }],
        rows: [[{ text: '', marks: [] }]]
      }
    })
  }
}

onMounted(() => {
  ensureCells()
  nextTick(() => {
    syncCells()
    requestAnimationFrame(syncCells)
  })
  // capture 阶段:先于目标元素处理,避免被块组件 stopPropagation 吞掉
  window.addEventListener('click', closeContextMenu, true)
})

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu, true)
  cellRefs.value.clear()
})

watch(isSelected, () => {
  nextTick(syncCells)
})

watch(
  () => [content().headers, content().rows],
  () => {
    if (selfUpdate.value) {
      selfUpdate.value = false
      return
    }
    nextTick(syncCells)
  },
  { deep: true }
)
watch(() => doc.renderTick, () => {
  nextTick(() => requestAnimationFrame(syncCells))
})

/** 失焦/回车时解析行内 Markdown 并提交 marks */
function commitCellWithMarks(rowIdx: number, colIdx: number, text: string) {
  const parsed = parseInlineMarkdown(text)
  const headers = content().headers.map((c) => ({ ...c }))
  const rows = content().rows.map((r) => r.map((c) => ({ ...c })))
  if (rowIdx === -1) {
    if (headers[colIdx]) {
      headers[colIdx].text = parsed.text
      headers[colIdx].marks = parsed.marks
    }
  } else {
    if (!rows[rowIdx]) rows[rowIdx] = []
    if (!rows[rowIdx][colIdx]) rows[rowIdx][colIdx] = { text: '', marks: [] }
    rows[rowIdx][colIdx].text = parsed.text
    rows[rowIdx][colIdx].marks = parsed.marks
  }
  selfUpdate.value = true
  emit('update', { content: { headers, rows } })
}

function onCellKeydown(e: KeyboardEvent, rowIdx: number, colIdx: number) {
  if (autocomplete.onKeyDown(e)) return
  if (e.key === 'Enter') {
    e.preventDefault()
    const el = cellRefs.value.get(cellKey(rowIdx, colIdx))
    if (el) {
      commitCellWithMarks(rowIdx, colIdx, el.innerText)
      selfUpdate.value = false
    }
  }
}

/** 单元格输入时检测 [[ 触发自动补全 */
function onCellInput(e: Event) {
  activeCellEl.value = e.target as HTMLElement
  autocomplete.checkTrigger()
}

function onCellBlur(rowIdx: number, colIdx: number) {
  autocomplete.close()
  const el = cellRefs.value.get(cellKey(rowIdx, colIdx))
  if (!el) return
  commitCellWithMarks(rowIdx, colIdx, el.innerText)
}

/* ============== 右键菜单:行列增删 ============== */

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  rowIdx: number  // -1 表示表头行
  colIdx: number
}

const contextMenu = ref<ContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  rowIdx: 0,
  colIdx: 0
})

function onCellContextmenu(e: MouseEvent, rowIdx: number, colIdx: number) {
  e.preventDefault()
  emit('select')
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    rowIdx,
    colIdx
  }
}

function closeContextMenu() {
  if (contextMenu.value.visible) {
    contextMenu.value.visible = false
  }
}

/** 在当前行上方插入行(表头行不允许上方插入,转为在表头下方插入第一行数据) */
function insertRowAbove() {
  const { rowIdx } = contextMenu.value
  const headers = content().headers.map((c) => ({ ...c }))
  const rows = content().rows.map((r) => r.map((c) => ({ ...c })))
  const colCount = headers.length
  const newRow: TableCell[] = Array.from({ length: colCount }, () => ({ text: '', marks: [] }))
  const insertAt = rowIdx === -1 ? 0 : rowIdx
  rows.splice(insertAt, 0, newRow)
  selfUpdate.value = true
  emit('update', { content: { headers, rows } })
  nextTick(() => requestAnimationFrame(syncCells))
  closeContextMenu()
}

/** 在当前行下方插入行 */
function insertRowBelow() {
  const { rowIdx } = contextMenu.value
  const headers = content().headers.map((c) => ({ ...c }))
  const rows = content().rows.map((r) => r.map((c) => ({ ...c })))
  const colCount = headers.length
  const newRow: TableCell[] = Array.from({ length: colCount }, () => ({ text: '', marks: [] }))
  const insertAt = rowIdx === -1 ? 0 : rowIdx + 1
  rows.splice(insertAt, 0, newRow)
  selfUpdate.value = true
  emit('update', { content: { headers, rows } })
  nextTick(() => requestAnimationFrame(syncCells))
  closeContextMenu()
}

/** 在当前列左侧插入列 */
function insertColLeft() {
  const { colIdx } = contextMenu.value
  const headers = content().headers.map((c) => ({ ...c }))
  const rows = content().rows.map((r) => r.map((c) => ({ ...c })))
  const aligns = [...(content().aligns ?? [])]
  headers.splice(colIdx, 0, { text: '', marks: [] })
  rows.forEach((r) => r.splice(colIdx, 0, { text: '', marks: [] }))
  aligns.splice(colIdx, 0, 'left')
  selfUpdate.value = true
  emit('update', { content: { headers, rows, aligns } })
  nextTick(() => requestAnimationFrame(syncCells))
  closeContextMenu()
}

/** 在当前列右侧插入列 */
function insertColRight() {
  const { colIdx } = contextMenu.value
  const headers = content().headers.map((c) => ({ ...c }))
  const rows = content().rows.map((r) => r.map((c) => ({ ...c })))
  const aligns = [...(content().aligns ?? [])]
  headers.splice(colIdx + 1, 0, { text: '', marks: [] })
  rows.forEach((r) => r.splice(colIdx + 1, 0, { text: '', marks: [] }))
  aligns.splice(colIdx + 1, 0, 'left')
  selfUpdate.value = true
  emit('update', { content: { headers, rows, aligns } })
  nextTick(() => requestAnimationFrame(syncCells))
  closeContextMenu()
}

/** 删除当前行(至少保留 1 行数据) */
function deleteRow() {
  const { rowIdx } = contextMenu.value
  if (rowIdx === -1) {
    closeContextMenu()
    return  // 表头行不删除
  }
  const headers = content().headers.map((c) => ({ ...c }))
  const rows = content().rows.map((r) => r.map((c) => ({ ...c })))
  if (rows.length <= 1) {
    closeContextMenu()
    return  // 至少保留 1 行
  }
  rows.splice(rowIdx, 1)
  selfUpdate.value = true
  emit('update', { content: { headers, rows } })
  nextTick(() => requestAnimationFrame(syncCells))
  closeContextMenu()
}

/** 删除当前列(至少保留 1 列) */
function deleteCol() {
  const { colIdx } = contextMenu.value
  const headers = content().headers.map((c) => ({ ...c }))
  const rows = content().rows.map((r) => r.map((c) => ({ ...c })))
  const aligns = [...(content().aligns ?? [])]
  if (headers.length <= 1) {
    closeContextMenu()
    return  // 至少保留 1 列
  }
  headers.splice(colIdx, 1)
  rows.forEach((r) => r.splice(colIdx, 1))
  aligns.splice(colIdx, 1)
  selfUpdate.value = true
  emit('update', { content: { headers, rows, aligns } })
  nextTick(() => requestAnimationFrame(syncCells))
  closeContextMenu()
}

/** 点击事件:阅读态下点链接跳转,点其他地方进入编辑态 */
function onClick(e: MouseEvent) {
  if (isSelected.value) return
  const target = e.target as HTMLElement
  const wikilinkEl = target.closest('.md-wikilink') as HTMLElement | null
  if (wikilinkEl) {
    const linkTarget = wikilinkEl.dataset.target
    if (linkTarget) {
      e.preventDefault()
      e.stopPropagation()
      void doc.openWikilink(linkTarget)
      return
    }
  }
  const linkEl = target.closest('.md-link') as HTMLAnchorElement | null
  if (linkEl) {
    e.stopPropagation()
    return
  }
  emit('select')
}

/** mousedown:点 wikilink 时阻止 focus,常规链接保持默认行为 */
function onMousedown(e: MouseEvent) {
  if (isSelected.value) return
  const target = e.target as HTMLElement
  if (target.closest('.md-wikilink')) {
    e.preventDefault()
  }
}
</script>

<template>
  <div class="table-block" @click="onClick" @mousedown="onMousedown">
    <table>
      <thead>
        <tr>
          <th v-for="(_h, i) in content().headers" :key="i" :style="{ textAlign: (content().aligns?.[i] ?? 'left') }">
            <div
              :ref="(el) => setCellRef(el as HTMLElement, -1, i)"
              class="cell header-cell"
              :contenteditable="isSelected ? 'true' : 'false'"
              spellcheck="false"
              @keydown="(e: KeyboardEvent) => onCellKeydown(e, -1, i)"
              @input="onCellInput"
              @blur="onCellBlur(-1, i)"
              @contextmenu="(e: MouseEvent) => onCellContextmenu(e, -1, i)"
            ></div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(_row, rIdx) in content().rows" :key="rIdx">
          <td v-for="(_cell, cIdx) in content().rows[rIdx]" :key="cIdx" :style="{ textAlign: (content().aligns?.[cIdx] ?? 'left') }">
            <div
              :ref="(el) => setCellRef(el as HTMLElement, rIdx, cIdx)"
              class="cell"
              :contenteditable="isSelected ? 'true' : 'false'"
              spellcheck="false"
              @keydown="(e: KeyboardEvent) => onCellKeydown(e, rIdx, cIdx)"
              @input="onCellInput"
              @blur="onCellBlur(rIdx, cIdx)"
              @contextmenu="(e: MouseEvent) => onCellContextmenu(e, rIdx, cIdx)"
            ></div>
          </td>
        </tr>
      </tbody>
    </table>
    <WikilinkPopup
      :visible="autocomplete.visible.value"
      :items="autocomplete.items.value"
      :selected-index="autocomplete.selectedIndex.value"
      :x="autocomplete.popupX.value"
      :y="autocomplete.popupY.value"
      @select="autocomplete.confirm()"
      @hover="(idx: number) => (autocomplete.selectedIndex.value = idx)"
    />

    <!-- 右键上下文菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="table-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button class="menu-item" @click="insertRowAbove">在上方插入行</button>
        <button class="menu-item" @click="insertRowBelow">在下方插入行</button>
        <div class="menu-divider"></div>
        <button class="menu-item" @click="insertColLeft">在左侧插入列</button>
        <button class="menu-item" @click="insertColRight">在右侧插入列</button>
        <div class="menu-divider"></div>
        <button
          class="menu-item danger"
          :disabled="contextMenu.rowIdx === -1 || content().rows.length <= 1"
          @click="deleteRow"
        >删除当前行</button>
        <button
          class="menu-item danger"
          :disabled="content().headers.length <= 1"
          @click="deleteCol"
        >删除当前列</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.table-block {
  margin: 8px 0;
  overflow-x: auto;
  font-family: var(--font-sans);
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
th, td {
  border: 1px solid var(--border);
  padding: 0;
  vertical-align: top;
}
.cell {
  width: 100%;
  min-height: 1.6em;
  padding: 6px 10px;
  background: transparent;
  color: var(--foreground);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  word-break: break-word;
}
.header-cell {
  font-weight: 600;
  background: var(--secondary);
}
:deep(.inline-code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--secondary);
}
:deep(.md-link) { color: var(--brand-500); text-decoration: underline; }
:deep(.md-wikilink) { color: var(--brand-500); text-decoration: underline; cursor: pointer; }
:deep(.md-image) { max-width: 100%; border-radius: 4px; }
:deep(.md-highlight) { background: rgba(255, 235, 59, 0.3); padding: 0 2px; border-radius: 2px; }
</style>

<style>
/* 右键菜单(非 scoped,因为 Teleport 到 body) */
.table-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  padding: 4px 0;
  background: var(--popover, #fff);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-family: var(--font-sans, system-ui);
  font-size: 13px;
}
.table-context-menu .menu-item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  color: var(--foreground, #333);
  font-family: inherit;
  font-size: inherit;
}
.table-context-menu .menu-item:hover:not(:disabled) {
  background: var(--secondary, #f5f5f5);
}
.table-context-menu .menu-item:disabled {
  color: var(--muted-foreground, #aaa);
  cursor: not-allowed;
}
.table-context-menu .menu-item.danger {
  color: #dc2626;
}
.table-context-menu .menu-item.danger:hover:not(:disabled) {
  background: #fef2f2;
}
.table-context-menu .menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--border, #e0e0e0);
}
</style>
