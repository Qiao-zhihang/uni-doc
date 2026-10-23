<script setup lang="ts">
/**
 * 代码块 Block
 * Markdown 语法: ```lang ... ```
 * 当 language 为 mermaid 时,未选中态渲染为图表,选中态显示源码编辑
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Block, CodeBlockContent, CodeBlockProps } from '@/core/blocks/types'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { useThemeStore } from '@/stores/theme'
import { useContentEditable } from '@/composables/useContentEditable'
import { renderMermaidSvg, type MermaidTheme } from '@/core/render/mermaid'

const props = defineProps<{ block: Block }>()
const doc = useDocumentStore()
const editor = useEditorStore()
const theme = useThemeStore()
const emit = defineEmits<{
  (e: 'update', patch: Partial<Block>): void
  (e: 'backspace-merge'): void
  (e: 'select'): void
  (e: 'navigate', direction: 'prev' | 'next'): void
}>()

const el = ref<HTMLElement | null>(null)
const { isComposing, onCompositionStart, onCompositionEnd, onPasteClean, onTabKey } =
  useContentEditable(el)
const selfUpdate = ref(false)
/** Mermaid 渲染输出 */
const mermaidSvg = ref<string>('')
const mermaidError = ref<string>('')
const mermaidRendering = ref(false)
/** 组件实例唯一标识,避免演示模式与编辑器同时渲染时 mermaid id 冲突 */
const instanceId = Math.random().toString(36).slice(2, 8)

/**
 * Mermaid 渲染结果缓存(按 block id + 源码 + 主题)。
 *
 * renderTick 在**每次** commit 后都会递增(document.ts:246),而本组件的 renderTick
 * 监听此前只要 isMermaid 就无脑重渲(见下),于是「在任意一个代码块里打字」会触发
 * 文档中所有 mermaid 块重新走一遍 render —— 大文档下直接表现为打字卡顿。
 *
 * 放在模块级而不是组件内,是因为 block 对象在每次 updateBlock 后都是新对象
 * (document.ts:379-385),组件内 ref 也会随 tab 切换而重建;用 block.id 作键
 * 才能在 block 对象被替换后继续命中。
 * 容量上限兜底,防止长会话里大量不同图表把内存撑大。
 */
const MERMAID_CACHE_LIMIT = 64
const mermaidCache = new Map<string, { code: string; theme: MermaidTheme; svg: string }>()

/** 本组件最近一次成功渲染的输入(未改变的输入直接复用缓存) */
const lastRendered = ref<{ code: string; theme: MermaidTheme } | null>(null)

function cacheSetCapped(key: string, value: { code: string; theme: MermaidTheme; svg: string }) {
  mermaidCache.delete(key)
  mermaidCache.set(key, value)
  if (mermaidCache.size > MERMAID_CACHE_LIMIT) {
    const oldest = mermaidCache.keys().next().value
    if (oldest !== undefined) mermaidCache.delete(oldest)
  }
}

const content = () => props.block.content as CodeBlockContent
const language = () => (props.block.props as CodeBlockProps).language ?? 'plaintext'
const isMermaid = computed(() => language().toLowerCase() === 'mermaid')
const isSelected = computed(() => editor.selectedBlockId === props.block.id)

function syncText() {
  if (!el.value) return
  const current = el.value.innerText
  if (current !== content().code) {
    el.value.innerText = content().code
  }
}

/** Mermaid 主题跟随应用主题 */
function mermaidTheme(): MermaidTheme {
  return theme.mode === 'dark' ? 'dark' : 'default'
}

/** 渲染 Mermaid 图表(相同源码 + 主题直接复用缓存,命中也记为一次渲染) */
async function renderMermaid() {
  if (!isMermaid.value) {
    mermaidSvg.value = ''
    mermaidError.value = ''
    lastRendered.value = null
    return
  }
  const code = content().code.trim()
  if (!code) {
    mermaidSvg.value = ''
    mermaidError.value = ''
    lastRendered.value = null
    return
  }
  const themeName = mermaidTheme()
  const cached = mermaidCache.get(props.block.id)
  if (cached && cached.code === code && cached.theme === themeName) {
    mermaidSvg.value = cached.svg
    mermaidError.value = ''
    lastRendered.value = { code, theme: themeName }
    return
  }
  lastRendered.value = { code, theme: themeName }
  mermaidRendering.value = true
  try {
    // 初始化与 render 统一在 core/render/mermaid 里(AI 气泡共用同一套逻辑)
    // 唯一 id 防止重复(加实例标识避免演示模式与编辑器同时渲染时冲突)
    const id = `mmd-${props.block.id.replace(/[^a-zA-Z0-9]/g, '')}-${instanceId}`
    const svg = await renderMermaidSvg(code, id, {
      theme: themeName,
      // antiscript:标签仍按 HTML 渲染(兼容 <br/> 等既有写法),但 mermaid 会执行
      // DOMPurify 净化(标签文本 + 最终 SVG),图内链接也会过 sanitizeUrl。
      // 请勿改回 'loose' —— loose 是唯一三处净化全部跳过的档位,而 AI 能通过
      // insert_block 把 mermaid 块写进用户文档,形成"模型输出→文档→编辑器"链路。
      securityLevel: 'antiscript',
      fontFamily: 'inherit',
    })
    mermaidSvg.value = svg
    mermaidError.value = ''
    cacheSetCapped(props.block.id, { code, theme: themeName, svg })
  } catch (e: unknown) {
    // mermaid.render 失败会抛出,显示错误信息
    const err = e as { message?: string; str?: string }
    mermaidError.value = err.message || err.str || String(e)
    mermaidSvg.value = ''
    // 失败结果不入缓存:上次 lastRendered 标记要撤掉,否则同源码不会再重试
    lastRendered.value = null
  } finally {
    mermaidRendering.value = false
  }
}

onMounted(() => {
  syncText()
  nextTick(() => {
    requestAnimationFrame(syncText)
  })
  if (isMermaid.value) renderMermaid()
})

watch(
  () => content().code,
  () => {
    if (selfUpdate.value) {
      selfUpdate.value = false
      return
    }
    syncText()
    // 源码变化时,若处于渲染态(未选中),重新渲染
    if (isMermaid.value && !isSelected.value) {
      renderMermaid()
    }
  },
)

watch(
  () => doc.renderTick,
  () => {
    nextTick(() => requestAnimationFrame(syncText))
    /*
     * renderTick 每次 commit 都会涨(document.ts:246),而这里以前只要 isMermaid 就重渲
     * —— 于是「在任意代码块里打字」都会把文档里所有 mermaid 图重渲一遍。
     * 现在比对「本次将要渲染的输入」与「上次真正渲染过的输入」,未变化直接跳过;
     * 输入确实变了时,renderMermaid 内部还有一层缓存兜底。
     */
    if (!isMermaid.value) return
    const code = content().code.trim()
    const last = lastRendered.value
    if (last && last.code === code && last.theme === mermaidTheme()) return
    renderMermaid()
  },
)

// 选中态变化:切到源码编辑或切回图表渲染
watch(isSelected, () => {
  if (isSelected.value) {
    // 切到源码编辑态:等 <pre> 挂载后填充内容
    nextTick(() => {
      requestAnimationFrame(() => {
        syncText()
      })
    })
  } else if (isMermaid.value) {
    // 失焦时重新渲染图表(可能源码已改)
    renderMermaid()
  }
})

// 主题变化时重新渲染
watch(
  () => theme.mode,
  () => {
    if (isMermaid.value && !isSelected.value) {
      renderMermaid()
    }
  },
)

function onInput() {
  if (isComposing.value) return
  if (!el.value) return
  const code = el.value.innerText
  selfUpdate.value = true
  emit('update', { content: { code } })
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

function isCursorAtEnd(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.value) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  const testRange = document.createRange()
  testRange.selectNodeContents(el.value)
  testRange.setStart(range.endContainer, range.endOffset)
  return testRange.toString().length === 0
}

function insertTextAtCursor(text: string) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.value) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.setEndAfter(textNode)
  sel.removeAllRanges()
  sel.addRange(range)
}

function onKeydown(e: KeyboardEvent) {
  // IME 组合输入期间让位:输入法用 Enter 上屏候选词,否则会误插换行(详见 ParagraphBlock)
  if (e.isComposing || isComposing.value) return
  if (e.key === 'Tab') {
    onTabKey(e)
    return
  }
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
    /*
     * 代码块内 Enter 一律换行,Shift+Enter 不额外区分。
     * 原实现把 Shift+Enter 交给 `emit('enter','')`,而 BlockEditor.onEnter 对
     * code_block 直接 return(BlockEditor.vue:49-51),该事件被吞掉 —— 结果是
     * 「Shift+Enter 完全没反应」。代码块里真正的换块出口是方向键导航,
     * 保持与 Enter 一致比留一个空操作更符合直觉。
     */
    e.preventDefault()
    insertTextAtCursor('\n')
    if (el.value) {
      selfUpdate.value = true
      emit('update', { content: { code: el.value.innerText } })
    }
  } else if (e.key === 'Backspace' && isCursorAtStart()) {
    e.preventDefault()
    if (el.value) {
      selfUpdate.value = true
      emit('update', { content: { code: el.value.innerText } })
    }
    emit('backspace-merge')
  }
}
</script>

<template>
  <div class="code-block-wrapper">
    <div class="code-lang">{{ language() }}</div>
    <!-- Mermaid 渲染态:未选中时显示图表 -->
    <div
      v-if="isMermaid && !isSelected"
      class="mermaid-render"
      :class="{ 'is-loading': mermaidRendering }"
    >
      <div v-if="mermaidRendering" class="mermaid-loading">渲染中…</div>
      <div v-else-if="mermaidError" class="mermaid-error">
        <div class="mermaid-error-title">图表语法错误</div>
        <pre class="mermaid-error-detail">{{ mermaidError }}</pre>
      </div>
      <div v-else class="mermaid-svg" v-html="mermaidSvg"></div>
    </div>
    <!-- 源码编辑态:普通代码块或 mermaid 选中时 -->
    <pre
      v-else
      ref="el"
      class="code-block"
      contenteditable="true"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
      @focus="emit('select')"
      @click="emit('select')"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @paste="onPasteClean"
    ></pre>
  </div>
</template>

<style scoped>
.code-block-wrapper {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.code-lang {
  padding: 4px 12px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted-foreground);
  background: var(--secondary);
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
}
.code-block {
  margin: 0;
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--foreground);
  background: var(--secondary);
  outline: none;
  min-height: 1.6em;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: break-word;
}

/* Mermaid 渲染区 */
.mermaid-render {
  padding: 24px 16px;
  background: var(--card);
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.mermaid-render.is-loading::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.5);
  pointer-events: none;
}
.mermaid-loading {
  font-size: 13px;
  color: var(--muted-foreground);
}
.mermaid-svg {
  width: 100%;
  display: flex;
  justify-content: center;
}
.mermaid-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}
.mermaid-error {
  width: 100%;
  padding: 12px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #b91c1c;
}
.mermaid-error-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.mermaid-error-detail {
  font-size: 11px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  color: #991b1b;
}
</style>
