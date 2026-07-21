<script setup lang="ts">
/**
 * 列表 Block
 * 参考 PRD §11.2 / §11.4:list 含列表项数组(文本 + 勾选状态)
 * 支持三种类型:无序(bullet)/ 有序(ordered)/ 任务(task)
 * 列表项内的行内 Markdown 语法(粗体/斜体等)在回车时渲染
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Block, ListContent, ListProps, ListItem } from '@/core/blocks/types'
import { uuid } from '@/core/blocks/factory'
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
  (e: 'enter'): void
  (e: 'backspace-merge'): void
  (e: 'select'): void
}>()

const itemRefs = ref<HTMLElement[]>([])
const selfUpdate = ref(false)
/** Enter/Backspace 切换 item 时跳过 onBlur 提交(此时 DOM 仍显示旧文本,会覆盖已提交内容) */
const skipNextBlur = ref(false)
// 当前编辑中的 item 元素(用于 wikilink 自动补全)
const activeItemEl = ref<HTMLElement | null>(null)
const autocomplete = useWikilinkAutocomplete({ el: activeItemEl })

const content = () => props.block.content as ListContent
const listType = () => (props.block.props as ListProps).listType

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
      content: { items: [{ id: uuid(), text: '', marks: [], checked: false }] }
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
  { deep: true }
)
watch(() => doc.renderTick, () => {
  nextTick(() => requestAnimationFrame(syncText))
})

// props 变化(listType)时重新渲染
watch(() => props.block.props, () => nextTick(syncText), { deep: true })

/** 回车时解析行内 Markdown 并提交 marks */
function commitItemWithMarks(idx: number, text: string) {
  const parsed = parseInlineMarkdown(text)
  const items = content().items.map((it, i) =>
    i === idx ? { ...it, text: parsed.text, marks: parsed.marks } : it
  )
  selfUpdate.value = true
  emit('update', { content: { items } })
}

function toggleCheck(idx: number) {
  const items = content().items.map((it, i) =>
    i === idx ? { ...it, checked: !it.checked } : it
  )
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

function onItemKeydown(e: KeyboardEvent, idx: number) {
  // 优先处理 wikilink 自动补全的键盘导航
  if (autocomplete.onKeyDown(e)) return
  const items = content().items
  const el = itemRefs.value[idx]
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (el) {
      commitItemWithMarks(idx, el.innerText)
      selfUpdate.value = false
      // 跳过即将触发的 onBlur:Enter 会切到新 item,旧 item blur 时 DOM 仍显示旧文本
      skipNextBlur.value = true
    }
    const newItem: ListItem = { id: uuid(), text: '', marks: [], checked: false }
    const newItems = [...items.slice(0, idx + 1), newItem, ...items.slice(idx + 1)]
    selfUpdate.value = true
    emit('update', { content: { items: newItems } })
    nextTick(() => {
      itemRefs.value[idx + 1]?.focus()
    })
  } else if (e.key === 'Backspace' && el && isCursorAtStart(el) && el.innerText.trim() === '') {
    e.preventDefault()
    // 跳过即将触发的 onBlur:Backspace 会切到 prev item,当前 item blur 时 DOM 仍显示旧文本
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
  }
}

/** 列表项输入时检测 [[ 触发自动补全 */
function onItemInput(e: Event) {
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
  autocomplete.close()
  // Enter/Backspace 切换 item 时已显式提交,跳过(此时 DOM 可能还显示旧文本)
  if (skipNextBlur.value) {
    skipNextBlur.value = false
    return
  }
  commitItemWithMarks(idx, text)
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
        <span class="marker">{{ idx + 1 }}.</span>
        <div
          :ref="(el) => setItemRef(el as HTMLElement, idx)"
          class="item-text"
          :contenteditable="isSelected ? 'true' : 'false'"
          spellcheck="false"
          @keydown="(e: KeyboardEvent) => onItemKeydown(e, idx)"
          @input="onItemInput"
          @blur="(e: Event) => onBlurItem(idx, (e.target as HTMLElement).innerText)"
        ></div>
      </li>
    </ol>
    <ul v-else class="bullet">
      <li v-for="(item, idx) in content().items" :key="item.id" class="item">
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
        ></div>
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
  align-items: flex-start;
  gap: 8px;
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
:deep(.md-link) { color: var(--brand-500); text-decoration: underline; }
:deep(.md-wikilink) { color: var(--brand-500); text-decoration: underline; cursor: pointer; }
:deep(.md-image) { max-width: 100%; border-radius: 4px; }
:deep(.md-highlight) { background: rgba(255, 235, 59, 0.3); padding: 0 2px; border-radius: 2px; }
</style>
