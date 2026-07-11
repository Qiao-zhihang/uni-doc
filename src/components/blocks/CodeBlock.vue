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

const props = defineProps<{ block: Block }>()
const doc = useDocumentStore()
const editor = useEditorStore()
const theme = useThemeStore()
const emit = defineEmits<{
  (e: 'update', patch: Partial<Block>): void
  (e: 'enter', afterText: string): void
  (e: 'backspace-merge'): void
  (e: 'select'): void
}>()

const el = ref<HTMLElement | null>(null)
const selfUpdate = ref(false)
/** Mermaid 渲染输出 */
const mermaidSvg = ref<string>('')
const mermaidError = ref<string>('')
const mermaidRendering = ref(false)
/** 组件实例唯一标识,避免演示模式与编辑器同时渲染时 mermaid id 冲突 */
const instanceId = Math.random().toString(36).slice(2, 8)

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
function mermaidTheme() {
  return theme.mode === 'dark' ? 'dark' : 'default'
}

/** 渲染 Mermaid 图表 */
async function renderMermaid() {
  if (!isMermaid.value) {
    mermaidSvg.value = ''
    mermaidError.value = ''
    return
  }
  const code = content().code.trim()
  if (!code) {
    mermaidSvg.value = ''
    mermaidError.value = ''
    return
  }
  mermaidRendering.value = true
  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme(),
      securityLevel: 'loose',
      fontFamily: 'inherit'
    })
    // 唯一 id 防止重复(加实例标识避免演示模式与编辑器同时渲染时冲突)
    const id = `mmd-${props.block.id.replace(/[^a-zA-Z0-9]/g, '')}-${instanceId}`
    const { svg } = await mermaid.render(id, code)
    mermaidSvg.value = svg
    mermaidError.value = ''
  } catch (e: unknown) {
    // mermaid.render 失败会抛出,显示错误信息
    const err = e as { message?: string; str?: string }
    mermaidError.value = err.message || err.str || String(e)
    mermaidSvg.value = ''
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
  }
)

watch(() => doc.renderTick, () => {
  nextTick(() => requestAnimationFrame(syncText))
  if (isMermaid.value) renderMermaid()
})

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
watch(() => theme.mode, () => {
  if (isMermaid.value && !isSelected.value) {
    renderMermaid()
  }
})

function onInput() {
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
  return el.value.innerText.length === 0
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (el.value) emit('update', { content: { code: el.value.innerText } })
    emit('enter', '')
  } else if (e.key === 'Backspace' && isCursorAtStart()) {
    e.preventDefault()
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
