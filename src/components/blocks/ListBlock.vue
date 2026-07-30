<script setup lang="ts">
/**
 * 列表 Block
 * 参考 PRD §11.2 / §11.4:list 含列表项数组(文本 + 勾选状态)
 * 支持三种类型:无序(bullet)/ 有序(ordered)/ 任务(task)
 * 列表项内的行内 Markdown 语法(粗体/斜体等)在回车时渲染
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Block, ListContent, ListProps, ListItem, Mark } from '@/core/blocks/types'
import { uuid } from '@/core/blocks/factory'
import { marksToHtml, marksToSource } from './marks'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { useWikilinkAutocomplete } from '@/composables/useWikilinkAutocomplete'
import { useContentEditable } from '@/composables/useContentEditable'
import WikilinkPopup from '@/components/common/WikilinkPopup.vue'
import BlockRenderer from '@/components/editor/BlockRenderer.vue'

const props = defineProps<{ block: Block }>()
const doc = useDocumentStore()
const editor = useEditorStore()
const emit = defineEmits<{
  (e: 'update', patch: Partial<Block>): void
  (e: 'enter'): void
  (e: 'backspace-merge'): void
  (e: 'select'): void
  (e: 'outdent', payload: { idx: number; text: string; marks: Mark[] }): void
  (e: 'navigate', direction: 'prev' | 'next'): void
}>()

const itemRefs = ref<HTMLElement[]>([])
const selfUpdate = ref(false)
/** Enter/Backspace 切换 item 时跳过 onBlur 提交(此时 DOM 仍显示旧文本,会覆盖已提交内容) */
const skipNextBlur = ref(false)
// 当前编辑中的 item 元素(用于 wikilink 自动补全)
const activeItemEl = ref<HTMLElement | null>(null)
const { isComposing, onCompositionStart, onCompositionEnd, onPasteClean, onTabKey } =
  useContentEditable(activeItemEl)
const autocomplete = useWikilinkAutocomplete({ el: activeItemEl })

const content = () => props.block.content as ListContent
const listType = () => (props.block.props as ListProps).listType
const listStart = () => (props.block.props as ListProps).start ?? 1

const isSelected = computed(() => editor.selectedBlockId === props.block.id)

function setItemRef(el: HTMLElement | null, idx: number) {
  if (el) itemRefs.value[idx] = el
}

/** 按选中态渲染所有列表项 */
function syncText() {
  const items = content().items ?? []
  items.forEach((item, idx) => {
    const el = itemRefs.value[idx]
    if (!el) return
    if (isSelected.value) {
      const source = marksToSource(item.text, item.marks)
      el.innerText = source
    } else {
      const html = marksToHtml(item.text, item.marks)
      el.innerHTML = html
    }
  })
}

/** 确保列表至少有一个 item(空列表无法编辑) */
function ensureItems() {
  const c = content()
  if (!c.items || c.items.length === 0) {
    selfUpdate.value = true
    emit('update', {
      content: { items: [{ id: uuid(), text: '', marks: [], checked: false }] },
    })
  }
}

onMounted(() => {
  ensureItems()
  nextTick(() => {
    syncText()
    requestAnimationFrame(syncText)
  })
})

watch(isSelected, () => {
  nextTick(() => {
    syncText()
    if (isSelected.value) itemRefs.value[0]?.focus()
  })
})

watch(
  () => content().items,
  () => {
    if (selfUpdate.value) {
      selfUpdate.value = false
      return
    }
    nextTick(syncText)
  },
)
watch(
  () => doc.renderTick,
  () => {
    nextTick(() => requestAnimationFrame(syncText))
  },
)

// props 变化(listType)时重新渲染
watch(
  () => props.block.props,
  () => nextTick(syncText),
)

/** 回车时解析行内 Markdown 并提交 marks */
function commitItemWithMarks(idx: number, text: string) {
  const parsed = parseInlineMarkdown(text)
  const items = content().items.map((it, i) =>
    i === idx ? { ...it, text: parsed.text, marks: parsed.marks } : it,
  )
  selfUpdate.value = true
  emit('update', { content: { items } })
}

function toggleCheck(idx: number) {
  const items = content().items.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it))
  emit('update', { content: { items } })
}

/** 检测光标是否在 contenteditable 元素开头 */
function isCursorAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  const testRange = document.createRange()
  testRange.selectNodeContents(el)
  testRange.setEnd(range.startContainer, range.startOffset)
  return testRange.toString().length === 0
}

function isCursorAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  const testRange = document.createRange()
  testRange.selectNodeContents(el)
  testRange.setStart(range.endContainer, range.endOffset)
  return testRange.toString().length === 0
}

/** 获取选区在元素内的起止偏移量（无选区时 start===end） */
function getSelectionOffsets(el: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 }
  const range = sel.getRangeAt(0)
  const preStart = document.createRange()
  preStart.selectNodeContents(el)
  preStart.setEnd(range.startContainer, range.startOffset)
  const start = preStart.toString().length
  if (range.collapsed) return { start, end: start }
  const preEnd = document.createRange()
  preEnd.selectNodeContents(el)
  preEnd.setEnd(range.endContainer, range.endOffset)
  const end = preEnd.toString().length
  return { start, end }
}

function focusItemAtEnd(idx: number) {
  const el = itemRefs.value[idx]
  if (!el) return
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function focusItemAtStart(idx: number) {
  const el = itemRefs.value[idx]
  if (!el) return
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function onItemKeydown(e: KeyboardEvent, idx: number) {
  if (e.key === 'Tab') {
    onTabKey(e)
    return
  }
  // 优先处理 wikilink 自动补全的键盘导航
  if (autocomplete.onKeyDown(e)) return
  const items = content().items
  const el = itemRefs.value[idx]

  // 箭头键导航
  if (el) {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && isCursorAtStart(el)) {
      e.preventDefault()
      if (idx === 0) {
        emit('navigate', 'prev')
      } else {
        focusItemAtEnd(idx - 1)
      }
      return
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && isCursorAtEnd(el)) {
      e.preventDefault()
      if (idx === items.length - 1) {
        emit('navigate', 'next')
      } else {
        focusItemAtStart(idx + 1)
      }
      return
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (el) {
      const fullText = el.innerText
      const { start, end } = getSelectionOffsets(el)
      const beforeText = fullText.slice(0, start)
      const afterText = fullText.slice(end)
      // 光标前内容留在当前项
      const parsedBefore = parseInlineMarkdown(beforeText)
      const itemsBefore = content().items.map((it, i) =>
        i === idx ? { ...it, text: parsedBefore.text, marks: parsedBefore.marks } : it,
      )
      // 光标后内容移到新项
      const parsedAfter = parseInlineMarkdown(afterText)
      const newItem: ListItem = {
        id: uuid(),
        text: parsedAfter.text,
        marks: parsedAfter.marks,
        checked: false,
      }
      const newItems = [...itemsBefore.slice(0, idx + 1), newItem, ...itemsBefore.slice(idx + 1)]
      selfUpdate.value = true
      skipNextBlur.value = true
      emit('update', { content: { items: newItems } })
      nextTick(() => {
        focusItemAtStart(idx + 1)
      })
    }
  } else if (e.key === 'Backspace' && el && isCursorAtStart(el)) {
    e.preventDefault()
    if (el.innerText.trim() === '') {
      skipNextBlur.value = true
      if (items.length <= 1) {
        emit('backspace-merge')
      } else {
        const newItems = items.filter((_, i) => i !== idx)
        selfUpdate.value = true
        emit('update', { content: { items: newItems } })
        nextTick(() => {
          const prev = itemRefs.value[Math.max(0, idx - 1)]
          prev?.focus()
          if (prev) {
            const range = document.createRange()
            range.selectNodeContents(prev)
            range.collapse(false)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }
        })
      }
    } else {
      commitItemWithMarks(idx, el.innerText)
      skipNextBlur.value = true
      const parsed = parseInlineMarkdown(el.innerText)
      emit('outdent', { idx, text: parsed.text, marks: parsed.marks })
    }
  }
}

/** 列表项输入时检测 [[ 触发自动补全 */
function onItemInput(e: Event) {
  if (isComposing.value) return
  activeItemEl.value = e.target as HTMLElement
  autocomplete.checkTrigger()
}

function isOrdered() {
  return listType() === 'ordered'
}
function isTask() {
  return listType() === 'task'
}

/** 列表项失焦时提交 */
function onBlurItem(idx: number, text: string) {
  if (isComposing.value) return
  autocomplete.close()
  // Enter/Backspace 切换 item 时已显式提交,跳过(此时 DOM 可能还显示旧文本)
  if (skipNextBlur.value) {
    skipNextBlur.value = false
    return
  }
  commitItemWithMarks(idx, text)
}

function onCompositionEndLocal() {
  onCompositionEnd()
  const active = document.activeElement as HTMLElement | null
  if (active && !itemRefs.value.includes(active) && active.innerText !== undefined) {
    // 如果组合结束时焦点已不在列表项中,不做额外提交(由 onBlur 处理)
  }
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
  <div
    class="list-block"
    :class="{ 'is-empty': (content().items?.length ?? 0) === 0 }"
    @click="onClick"
    @mousedown="onMousedown"
  >
    <ol v-if="isOrdered()" class="ordered">
      <li v-for="(item, idx) in content().items" :key="item.id" class="item">
        <div class="item-main">
          <span class="marker">{{ listStart() + idx }}.</span>
          <div
            :ref="(el) => setItemRef(el as HTMLElement, idx)"
            class="item-text"
            :contenteditable="isSelected ? 'true' : 'false'"
            spellcheck="false"
            @keydown="(e: KeyboardEvent) => onItemKeydown(e, idx)"
            @input="onItemInput"
            @blur="(e: Event) => onBlurItem(idx, (e.target as HTMLElement).innerText)"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEndLocal"
            @paste="onPasteClean"
          ></div>
        </div>
        <div v-if="item.children && item.children.length" class="item-children">
          <BlockRenderer v-for="child in item.children" :key="child.id" :block="child" />
        </div>
      </li>
    </ol>
    <ul v-else class="bullet">
      <li v-for="(item, idx) in content().items" :key="item.id" class="item">
        <div class="item-main">
          <input
            v-if="isTask()"
            type="checkbox"
            class="checkbox"
            :checked="item.checked"
            @change="toggleCheck(idx)"
          />
          <span v-else class="marker">•</span>
          <div
            :ref="(el) => setItemRef(el as HTMLElement, idx)"
            class="item-text"
            :class="{ checked: isTask() && item.checked }"
            :contenteditable="isSelected ? 'true' : 'false'"
            spellcheck="false"
            @keydown="(e: KeyboardEvent) => onItemKeydown(e, idx)"
            @input="onItemInput"
            @blur="(e: Event) => onBlurItem(idx, (e.target as HTMLElement).innerText)"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEndLocal"
            @paste="onPasteClean"
          ></div>
        </div>
        <div v-if="item.children && item.children.length" class="item-children">
          <BlockRenderer v-for="child in item.children" :key="child.id" :block="child" />
        </div>
      </li>
    </ul>
  </div>
  <WikilinkPopup
    :visible="autocomplete.visible.value"
    :items="autocomplete.items.value"
    :selected-index="autocomplete.selectedIndex.value"
    :x="autocomplete.popupX.value"
    :y="autocomplete.popupY.value"
    @select="autocomplete.confirm()"
    @hover="(idx: number) => (autocomplete.selectedIndex.value = idx)"
  />
</template>

<style scoped>
.list-block {
  margin: 8px 0;
  color: var(--foreground);
  font-size: 14px;
  line-height: 1.7;
}
.list-block.is-empty {
  min-height: 1.7em;
  cursor: text;
}
.ordered,
.bullet {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 16px;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.item-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.item-children {
  margin-left: 24px;
}
.marker {
  flex-shrink: 0;
  color: var(--muted-foreground);
  min-width: 16px;
}
.checkbox {
  flex-shrink: 0;
  margin-top: 4px;
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--primary);
}
.item-text {
  flex: 1;
  font-family: var(--font-sans);
  outline: none;
  min-height: 1.7em;
  word-break: break-word;
}
.item-text.checked {
  text-decoration: line-through;
  color: var(--muted-foreground);
}
:deep(.inline-code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--secondary);
}
:deep(.md-link) {
  color: var(--brand-500);
  text-decoration: underline;
}
:deep(.md-wikilink) {
  color: var(--brand-500);
  text-decoration: underline;
  cursor: pointer;
}
:deep(.md-image) {
  max-width: 100%;
  border-radius: 4px;
}
:deep(.md-highlight) {
  background: rgba(255, 235, 59, 0.3);
  padding: 0 2px;
  border-radius: 2px;
}
</style>
