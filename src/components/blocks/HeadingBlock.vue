<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Block, HeadingContent, HeadingProps } from '@/core/blocks/types'
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
  (e: 'enter', afterText: string): void
  (e: 'backspace-merge'): void
  (e: 'select'): void
}>()

const el = ref<HTMLElement | null>(null)
const selfUpdate = ref(false)
const autocomplete = useWikilinkAutocomplete({ el })

const content = () => props.block.content as HeadingContent
const level = () => (props.block.props as HeadingProps).level

const isSelected = computed(() => editor.selectedBlockId === props.block.id)
const tag = computed(() => `h${level()}`)

function renderSource() {
  if (!el.value) return
  const c = content()
  const source = marksToSource(c.text, c.marks)
  const prefix = '#'.repeat(level()) + ' '
  el.value.innerText = prefix + source
}

function renderHtml() {
  if (!el.value) return
  const c = content()
  const html = marksToHtml(c.text, c.marks)
  el.value.innerHTML = html
}

function render() {
  if (isSelected.value) renderSource()
  else renderHtml()
}

onMounted(() => {
  render()
  nextTick(() => {
    requestAnimationFrame(render)
  })
})

watch(isSelected, (selected) => {
  nextTick(() => {
    if (selected) {
      renderSource()
      el.value?.focus()
    } else {
      renderHtml()
    }
  })
})

watch(
  () => [content().text, content().marks],
  () => {
    if (selfUpdate.value) {
      selfUpdate.value = false
      return
    }
    nextTick(render)
  },
  { deep: true }
)

watch(() => doc.renderTick, () => {
  nextTick(() => requestAnimationFrame(render))
})

// props 变化(level/align)时重新渲染
watch(() => props.block.props, () => nextTick(render), { deep: true })

function commitWithMarks(text: string) {
  if (!el.value) return
  // 解析块级前缀: #/##/### 等,更新 level
  let cleanText = text
  const headingMatch = text.match(/^(#{1,6})\s+(.*)$/s)
  let newLevel = level()
  if (headingMatch) {
    newLevel = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6
    cleanText = headingMatch[2]
  }
  const parsed = parseInlineMarkdown(cleanText)
  selfUpdate.value = true
  emit('update', {
    content: {
      text: parsed.text,
      marks: parsed.marks
    },
    props: { level: newLevel }
  })
}

function isCursorAtStart(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed || !el.value) return false
  const testRange = document.createRange()
  testRange.selectNodeContents(el.value)
  testRange.setEnd(range.startContainer, range.startOffset)
  return testRange.toString().length === 0
}

/** 获取光标在元素内的字符偏移量 */
function getCursorOffset(): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.value) return 0
  const range = sel.getRangeAt(0)
  const preRange = document.createRange()
  preRange.selectNodeContents(el.value)
  preRange.setEnd(range.startContainer, range.startOffset)
  return preRange.toString().length
}

function onKeydown(e: KeyboardEvent) {
  if (autocomplete.onKeyDown(e)) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (el.value) {
      const fullText = el.value.innerText
      const offset = getCursorOffset()
      const beforeText = fullText.slice(0, offset)
      const afterText = fullText.slice(offset)
      commitWithMarks(beforeText)
      selfUpdate.value = false
      emit('enter', afterText)
    } else {
      emit('enter', '')
    }
  } else if (e.key === 'Backspace' && isCursorAtStart()) {
    e.preventDefault()
    emit('backspace-merge')
  }
}

function onInput() {
  autocomplete.checkTrigger()
}

function onBlur() {
  autocomplete.close()
  if (el.value) {
    commitWithMarks(el.value.innerText)
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
  <component
    :is="tag"
    ref="el"
    class="heading-block"
    :contenteditable="isSelected ? 'true' : 'false'"
    spellcheck="false"
    @keydown="onKeydown"
    @input="onInput"
    @blur="onBlur"
    @click="onClick"
    @mousedown="onMousedown"
  ></component>
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
.heading-block {
  color: var(--foreground);
  font-family: var(--font-sans);
  line-height: 1.3;
  margin: 12px 0;
  outline: none;
  word-break: break-word;
  overflow-wrap: break-word;
}
h1.heading-block { font-size: 24px; font-weight: 600; line-height: 1.25; }
h2.heading-block { font-size: 18px; font-weight: 600; }
h3.heading-block { font-size: 16px; font-weight: 600; }
h4.heading-block { font-size: 15px; font-weight: 600; }
h5.heading-block { font-size: 14px; font-weight: 600; }
h6.heading-block { font-size: 13px; font-weight: 600; color: var(--muted-foreground); }
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
