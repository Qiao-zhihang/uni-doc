<script setup lang="ts">
/**
 * 图片 Block
 * 支持插入方式:本地文件选择 / 粘贴 / URL 输入 / 拖拽
 * 存储:图片复制到 vault/assets/,src 存相对路径
 * 属性:对齐(align) + 宽度百分比(width)
 */
import { computed, ref, watch } from 'vue'
import type { Block, ImageContent, ImageProps } from '@/core/blocks/types'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import {
  pickImageToVault,
  writeImageToVault,
  downloadImageToVault
} from '@/core/vault/vault'
import { isTauri } from '@/core/serializer/markdownFile'
import { ImageIcon, Upload, Link as LinkIcon } from 'lucide-vue-next'

async function convertFileSrc(path: string): Promise<string> {
  if (!isTauri()) return path
  const { convertFileSrc: cv } = await import('@tauri-apps/api/core')
  return cv(path)
}

const props = defineProps<{ block: Block }>()
const doc = useDocumentStore()
const editor = useEditorStore()
const emit = defineEmits<{
  (e: 'update', patch: Partial<Block>): void
  (e: 'select'): void
  (e: 'enter', afterText: string): void
}>()

const content = () => props.block.content as ImageContent
const imgProps = () => (props.block.props as ImageProps) ?? {}

const isSelected = computed(() => editor.selectedBlockId === props.block.id)

/** 是否正在加载图片 */
const loading = ref(false)
/** URL 输入模式 */
const urlInputMode = ref(false)
const urlInput = ref('')

/** 拖拽悬浮态 */
const dragOver = ref(false)

/** 解析图片 src 为可显示的 URL */
const displaySrc = ref('')

async function resolveSrc() {
  const src = content().src
  if (!src) {
    displaySrc.value = ''
    return
  }
  // 绝对路径或 http(s)/data 直接用
  if (/^(https?:|data:|asset:|\/|blob:)/.test(src)) {
    displaySrc.value = src
    return
  }
  // 相对路径(vault 内):src 相对文档所在目录,需拼上"vaultRoot/文档目录/src"
  const root = doc.vaultRoot
  if (!root || !isTauri()) {
    displaySrc.value = src
    return
  }
  // 算出文档所在目录(去掉文件名);path 为 null 时落到 vault 根
  const tabPath = doc.activeTabPath
  const dir = tabPath ? tabPath.split('/').slice(0, -1).join('/') : ''
  const abs = (dir ? `${root}/${dir}/${src}` : `${root}/${src}`).replace(/\\/g, '/')
  displaySrc.value = await convertFileSrc(abs)
}

watch(() => content().src, resolveSrc, { immediate: true })

/** 宽度样式:width 存像素值,渲染时用 px */
const widthStyle = computed(() => {
  const w = imgProps().width
  if (w && w > 0) return { width: `${w}px`, height: 'auto' }
  return { maxWidth: '100%', height: 'auto' }
})

const alignClass = computed(() => `align-${imgProps().align ?? 'center'}`)

function update(patch: Partial<Block>) {
  emit('update', patch)
}

/** 右下角拖拽调整大小(Obsidian 风格) */
const resizing = ref(false)
const imgWrapRef = ref<HTMLElement | null>(null)

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  resizing.value = true
  const startX = e.clientX
  const startWidth = imgProps().width ?? (imgWrapRef.value?.offsetWidth ?? 300)

  const onMove = (ev: MouseEvent) => {
    if (!resizing.value) return
    // 鼠标水平位移即宽度变化(直观)
    const dx = ev.clientX - startX
    const newWidth = Math.max(40, Math.min(1200, startWidth + dx))
    update({ props: { ...props.block.props, width: newWidth } })
  }
  const onUp = () => {
    resizing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** 选择本地图片 */
async function pickLocal() {
  if (!doc.vaultRoot) return
  loading.value = true
  try {
    const rel = await pickImageToVault(doc.vaultRoot, doc.activeTabPath ?? '')
    if (rel) {
      update({ content: { src: rel, alt: content().alt } })
    }
  } catch (e) {
    console.error('选择图片失败:', e)
  } finally {
    loading.value = false
  }
}

/** 粘贴图片 */
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      if (!doc.vaultRoot) return
      loading.value = true
      try {
        const blob = item.getAsFile()
        if (!blob) continue
        const ext = blob.type.split('/')[1]?.split(';')[0] || 'png'
        const data = new Uint8Array(await blob.arrayBuffer())
        const rel = await writeImageToVault(doc.vaultRoot, doc.activeTabPath ?? '', data, ext)
        update({ content: { src: rel, alt: content().alt } })
      } catch (err) {
        console.error('粘贴图片失败:', err)
      } finally {
        loading.value = false
      }
      break
    }
  }
}

/** 拖拽图片 */
async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  if (!doc.vaultRoot) return
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  const file = files[0]
  if (!file.type.startsWith('image/')) return
  loading.value = true
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const data = new Uint8Array(await file.arrayBuffer())
    const rel = await writeImageToVault(doc.vaultRoot, doc.activeTabPath ?? '', data, ext)
    update({ content: { src: rel, alt: content().alt } })
  } catch (err) {
    console.error('拖拽图片失败:', err)
  } finally {
    loading.value = false
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

/** URL 输入确认 */
async function confirmUrl() {
  const url = urlInput.value.trim()
  if (!url) {
    urlInputMode.value = false
    return
  }
  loading.value = true
  try {
    if (url.startsWith('http')) {
      if (!doc.vaultRoot) {
        console.error('无法下载远程图片:未设置 vault 根目录')
        return
      }
      const rel = await downloadImageToVault(doc.vaultRoot, doc.activeTabPath ?? '', url)
      update({ content: { src: rel, alt: content().alt } })
    } else {
      update({ content: { src: url, alt: content().alt } })
    }
    urlInputMode.value = false
    urlInput.value = ''
  } catch (e) {
    console.error('URL 图片加载失败:', e)
  } finally {
    loading.value = false
  }
}

/** 图片加载错误 */
function onImgError() {
  console.warn('图片加载失败:', content().src)
}
</script>

<template>
  <div
    class="image-block"
    :class="[alignClass, { selected: isSelected, 'drag-over': dragOver }]"
    :tabindex="isSelected ? 0 : -1"
    @click="emit('select')"
    @focus="emit('select')"
    @paste="onPaste"
    @drop="onDrop"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @keydown.enter.prevent.stop="emit('enter', '')"
  >
    <!-- 有图片:显示图片 + 右下角拖拽手柄 -->
    <div
      v-if="content().src && !loading"
      class="image-wrap"
      ref="imgWrapRef"
      :class="{ resizing }"
    >
      <img
        :src="displaySrc"
        :alt="content().alt"
        class="image-content"
        :style="widthStyle"
        @error="onImgError"
        draggable="false"
      />
      <!-- 右下角拖拽手柄(选中时显示) -->
      <div
        v-if="isSelected"
        class="resize-handle"
        @mousedown="onResizeStart"
      ></div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="image-placeholder">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>

    <!-- 无图片:占位区 -->
    <div v-if="!content().src && !loading" class="image-placeholder">
      <ImageIcon :size="32" class="placeholder-icon" />
      <div class="placeholder-actions" v-if="isSelected">
        <button class="placeholder-btn" @click.stop="pickLocal">
          <Upload :size="14" />
          <span>本地文件</span>
        </button>
        <button class="placeholder-btn" @click.stop="urlInputMode = true">
          <LinkIcon :size="14" />
          <span>URL</span>
        </button>
        <span class="placeholder-hint">或粘贴 / 拖拽图片到此</span>
      </div>
      <div v-if="!isSelected" class="placeholder-hint">点击选择图片</div>
    </div>

    <!-- URL 输入框 -->
    <div v-if="urlInputMode" class="url-input-wrap" @click.stop>
      <input
        v-model="urlInput"
        class="url-input"
        placeholder="输入图片 URL 或本地路径..."
        @keydown.enter="confirmUrl"
        @keydown.escape="urlInputMode = false"
        autofocus
      />
      <button class="url-confirm" @click="confirmUrl">确认</button>
      <button class="url-cancel" @click="urlInputMode = false">取消</button>
    </div>
  </div>
</template>

<style scoped>
.image-block {
  position: relative;
  margin: 8px 0;
  outline: none;
  border-radius: 4px;
  transition: background 0.12s ease;
}
.image-block.selected {
  background: rgba(var(--brand-500-rgb, 59, 130, 246), 0.05);
}
.image-block.drag-over {
  background: var(--secondary);
  outline: 2px dashed var(--brand-500);
  outline-offset: 4px;
}
.align-left { text-align: left; }
.align-center { text-align: center; }
.align-right { text-align: right; }
.image-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.image-wrap.resizing {
  user-select: none;
}
.image-content {
  display: block;
  height: auto;
  border-radius: 4px;
  max-width: 100%;
}
/* 右下角拖拽手柄(Obsidian 风格) */
.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: var(--brand-500);
  border: 2px solid var(--card);
  border-radius: 0 0 4px 0;
  opacity: 0.8;
  z-index: 5;
}
.resize-handle:hover {
  opacity: 1;
}
.image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 120px;
  padding: 24px;
  border: 2px dashed var(--border);
  border-radius: 6px;
  color: var(--muted-foreground);
  text-align: center;
}
.placeholder-icon {
  opacity: 0.4;
}
.placeholder-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.placeholder-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.placeholder-btn:hover {
  background: var(--secondary);
}
.placeholder-hint {
  font-size: 11px;
  color: var(--muted-foreground);
}
.url-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.url-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--background);
  color: var(--foreground);
  font-size: 12px;
  outline: none;
}
.url-input:focus {
  border-color: var(--brand-500);
}
.url-confirm, .url-cancel {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.url-confirm {
  background: var(--brand-500);
  color: white;
  border: none;
}
.url-cancel {
  background: var(--secondary);
  color: var(--foreground);
  border: 1px solid var(--border);
}
.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--brand-500);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
