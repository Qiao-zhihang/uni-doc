<script setup lang="ts">
/**
 * 引用 Block
 * Markdown 语法: > text
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Block, QuoteContent } from '@/core/blocks/types'
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
  (e: 'enter', afterText: string): void
  (e: 'backspace-merge'): void
  (e: 'select'): void
  (e: 'convert', targetType: string): void
  (e: 'navigate', direction: 'prev' | 'next'): void
}>()

const el = ref<HTMLElement | null>(null)
const selfUpdate = ref(false)
/** Enter 换块时跳过 onBlur 提交(此时 DOM 还显示旧文本,会覆盖已提交的截断内容) */
const skipNextBlur = ref(false)
const autocomplete = useWikilinkAutocomplete({ el })
const { isComposing, onCompositionStart, onCompositionEnd, onPasteClean, onTabKey } =
  useContentEditable(el)

const content = () => props.block.content as QuoteContent

const isSelected = computed(() => editor.selectedBlockId === props.block.id)

/** 是否有块级内部内容（而非纯文本） */
const hasBlocks = computed(() => (content().blocks?.length ?? 0) > 0)

function renderSource() {
  if (!el.value) return
  const c = content()
  const source = marksToSource(c.text, c.marks)
  el.value.innerText = source
    .split('\n')
    .map((line) => '> ' + line)
    .join('\n')
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
)

watch(
  () => doc.renderTick,
  () => {
    nextTick(() => requestAnimationFrame(render))
  },
)

function commitWithMarks(text: string) {
  if (!el.value) return
  // 引用块编辑态显示源码时每行含 > 前缀,提交前逐行剥离
  const stripped = text
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
  const parsed = parseInlineMarkdown(stripped)
  selfUpdate.value = true
  emit('update', { content: { text: parsed.text, marks: parsed.marks } })
}

function isCursorAtStart(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed || !el.value) return false
  const testRange = document.createRange()
  testRange.selectNodeContents(el.value)
  testRange.setEnd(range.startContainer, range.startOffset)
  const offset = testRange.toString().length
  // 编辑态每行有 > 前缀,找到第一行文本内容的起始位置
  const firstLine = el.value.innerText.split('\n')[0] ?? ''
  const prefixMatch = firstLine.match(/^>\s?/)
  const contentStart = prefixMatch ? prefixMatch[0].length : 0
  return offset < contentStart
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

/** 获取选区在元素内的起止偏移量（无选区时 start===end） */
function getSelectionOffsets(): { start: number; end: number } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.value) return { start: 0, end: 0 }
  const range = sel.getRangeAt(0)
  const preStart = document.createRange()
  preStart.selectNodeContents(el.value)
  preStart.setEnd(range.startContainer, range.startOffset)
  const start = preStart.toString().length
  if (range.collapsed) return { start, end: start }
  const preEnd = document.createRange()
  preEnd.selectNodeContents(el.value)
  preEnd.setEnd(range.endContainer, range.endOffset)
  const end = preEnd.toString().length
  return { start, end }
}

function isCursorAtEnd(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.value) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  return getCursorOffset() === el.value.innerText.length
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    onTabKey(e)
    return
  }
  if (autocomplete.onKeyDown(e)) return

  if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && isCursorAtStart()) {
    e.preventDefault()
    emit('navigate', 'prev')
    return
  }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && isCursorAtEnd()) {
    e.preventDefault()
    emit('navigate', 'next')
    return
  }

  if (e.key === 'Enter') {
    if (e.shiftKey) {
      e.preventDefault()
      if (el.value) {
        const fullText = el.value.innerText
        const { start, end } = getSelectionOffsets()
        const beforeText = fullText.slice(0, start)
        const afterText = fullText
          .slice(end)
          .split('\n')
          .map((line) => line.replace(/^>\s?/, ''))
          .join('\n')
        commitWithMarks(beforeText)
        selfUpdate.value = false
        skipNextBlur.value = true
        emit('enter', afterText)
      } else {
        emit('enter', '')
      }
    } else {
      e.preventDefault()
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && el.value) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const textNode = document.createTextNode('\n> ')
        range.insertNode(textNode)
        range.setStartAfter(textNode)
        range.setEndAfter(textNode)
        sel.removeAllRanges()
        sel.addRange(range)
        selfUpdate.value = true
        commitWithMarks(el.value.innerText)
      }
    }
  } else if (e.key === 'Backspace' && isCursorAtStart()) {
    e.preventDefault()
    commitWithMarks(el.value?.innerText || '')
    skipNextBlur.value = true
    emit('convert', 'paragraph')
  }
}

function onInput() {
  if (isComposing.value) return
  autocomplete.checkTrigger()
}

function onBlur() {
  autocomplete.close()
  if (skipNextBlur.value) {
    skipNextBlur.value = false
    return
  }
  if (isComposing.value) return
  if (el.value) {
    commitWithMarks(el.value.innerText)
  }
}

function onCompositionEndLocal() {
  onCompositionEnd()
  if (document.activeElement !== el.value && el.value) {
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
  <div class="quote-wrapper">
    <blockquote
      v-if="!hasBlocks"
      ref="el"
      class="quote-block"
      :contenteditable="isSelected ? 'true' : 'false'"
      spellcheck="false"
      @keydown="onKeydown"
      @input="onInput"
      @blur="onBlur"
      @paste="onPasteClean"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEndLocal"
      @click="onClick"
      @mousedown="onMousedown"
    ></blockquote>
    <div v-else class="quote-block quote-block-rich">
      <BlockRenderer v-for="child in content().blocks" :key="child.id" :block="child" />
    </div>
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
.quote-block {
  border-left: 3px solid var(--brand-500);
  padding: 8px 16px;
  margin: 8px 0;
  color: var(--muted-foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
  outline: none;
  min-height: 1.7em;
  word-break: break-word;
  white-space: pre-wrap;
  transition:
    border-color 0.12s ease,
    color 0.12s ease,
    padding 0.12s ease;
}
.quote-block[contenteditable='true'] {
  border-left: none;
  padding-left: 0;
  color: var(--foreground);
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
:deep(.md-highlight) {
  background: rgba(255, 235, 59, 0.3);
  padding: 0 2px;
  border-radius: 2px;
}
:deep(.inline-code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--secondary);
}
</style>
