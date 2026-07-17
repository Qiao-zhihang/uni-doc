<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Block, ParagraphContent, ParagraphProps } from '@/core/blocks/types'
import { marksToHtml, marksToSource } from './marks'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { writeImageToVault } from '@/core/vault/vault'
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
/** Enter 换块时跳过 onBlur 提交(此时 DOM 还显示旧文本,会覆盖已提交的截断内容) */
const skipNextBlur = ref(false)

// wikilink 自动补全
const autocomplete = useWikilinkAutocomplete({ el })

const content = () => props.block.content as ParagraphContent
const align = () => (props.block.props as ParagraphProps).align ?? 'left'

// 选中态:选中=编辑态(显示源码语法),未选中=阅读态(显示渲染HTML)
const isSelected = computed(() => editor.selectedBlockId === props.block.id)

/** 渲染为带语法的源码纯文本(编辑态) */
function renderSource() {
  if (!el.value) return
  const c = content()
  const source = marksToSource(c.text, c.marks)
  el.value.innerText = source
}

/** 渲染为带样式的 HTML(阅读态) */
function renderHtml() {
  if (!el.value) return
  const c = content()
  const html = marksToHtml(c.text, c.marks)
  el.value.innerHTML = html
}

/** 按选中态渲染 */
function render() {
  if (isSelected.value) renderSource()
  else renderHtml()
}

// onMounted 同步渲染(el.value 已就绪),再用 nextTick + rAF 兜底
onMounted(() => {
  render()
  nextTick(() => {
    requestAnimationFrame(render)
  })
})

// 选中态切换:编辑态↔阅读态
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

// 外部数据变化时按当前态重新渲染
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

// props 变化(align)时重新渲染
watch(() => props.block.props, () => nextTick(render), { deep: true })

function commitWithMarks(text: string) {
  if (!el.value) return
  const parsed = parseInlineMarkdown(text)
  selfUpdate.value = true
  emit('update', {
    content: {
      text: parsed.text,
      marks: parsed.marks
    }
  })
}

// onInput 不写回 store:contenteditable 的 innerText 会丢失 $$、** 等语法字符,
// 若实时写回会污染 content.text。编辑期间仅 DOM 生效,失焦/Enter 时提交。

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
  // 优先处理 wikilink 自动补全的键盘导航
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
      // 跳过即将触发的 onBlur:selectBlock 会导致本块失焦,
      // 但此时 DOM 仍显示旧文本,onBlur 会错误覆盖已提交的截断内容
      skipNextBlur.value = true
      emit('enter', afterText)
    } else {
      emit('enter', '')
    }
  } else if (e.key === 'Backspace' && isCursorAtStart()) {
    e.preventDefault()
    // 同理:Backspace 合并也会导致失焦,跳过 onBlur
    skipNextBlur.value = true
    emit('backspace-merge')
  }
}

/** 输入时检测 [[ 触发自动补全 */
function onInput() {
  autocomplete.checkTrigger()
}

/** 失焦时提交并切回阅读态(由 isSelected watch 处理渲染) */
function onBlur() {
  autocomplete.close()
  // Enter/Backspace 换块时已显式提交,跳过(此时 DOM 可能还显示旧文本)
  if (skipNextBlur.value) {
    skipNextBlur.value = false
    return
  }
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

/** 粘贴图片:拦截并转换为图片块(contenteditable 默认会把 img 插入 DOM,innerText 会丢失) */
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      if (!doc.vaultRoot) return
      const blob = item.getAsFile()
      if (!blob) continue
      const ext = blob.type.split('/')[1]?.split(';')[0] || 'png'
      const data = new Uint8Array(await blob.arrayBuffer())
      const rel = await writeImageToVault(doc.vaultRoot, doc.activeTabPath ?? '', data, ext)
      // 当前段落块转换为图片块(id 不变,保持选中)
      selfUpdate.value = true
      emit('update', {
        type: 'image',
        content: { src: rel, alt: '' },
        props: { align: 'center', width: 100 }
      })
      return
    }
  }
}
</script>

<template>
  <p
    ref="el"
    class="paragraph-block"
    :class="`align-${align()}`"
    :contenteditable="isSelected ? 'true' : 'false'"
    spellcheck="false"
    @keydown="onKeydown"
    @input="onInput"
    @blur="onBlur"
    @paste="onPaste"
    @click="onClick"
    @mousedown="onMousedown"
  ></p>
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
.paragraph-block {
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
  margin: 8px 0;
  outline: none;
  min-height: 1.7em;
  word-break: break-word;
  overflow-wrap: break-word;
}
.align-left { text-align: left; }
.align-center { text-align: center; }
.align-right { text-align: right; }
.align-justify { text-align: justify; }
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
