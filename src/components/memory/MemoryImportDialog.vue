<script setup lang="ts">
/**
 * 导入记忆弹窗：预览文件内容，选择「合并 / 替换」后写入 store
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AlertTriangle, FileJson, FileUp, Loader2, X } from 'lucide-vue-next'
import { useAiMemoryStore, type ImportMemoryResult } from '@/stores/aiMemory'
import { parseMemoryExport } from '@/ai/memoryCore'

const props = defineProps<{
  visible: boolean
  raw: unknown
  fileName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'imported', result: ImportMemoryResult): void
}>()

const memoryStore = useAiMemoryStore()

type ImportMode = 'merge' | 'replace'

const mode = ref<ImportMode>('merge')
const importing = ref(false)
const errorMessage = ref('')

interface ImportPreview {
  facts: number
  profileFields: number
  wasEnvelope: boolean
  error: string | null
}

const preview = computed<ImportPreview | null>(() => {
  if (props.raw === null || props.raw === undefined) return null
  try {
    const result = parseMemoryExport(props.raw, { now: Date.now() })
    const profileFields = Object.values(result.memory.profile).filter((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    ).length
    return {
      facts: result.memory.facts.length,
      profileFields,
      wasEnvelope: result.wasEnvelope,
      error: null,
    }
  } catch (e) {
    return {
      facts: 0,
      profileFields: 0,
      wasEnvelope: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      mode.value = 'merge'
      errorMessage.value = ''
      importing.value = false
      document.addEventListener('keydown', onKeydown)
    } else {
      document.removeEventListener('keydown', onKeydown)
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

function close() {
  if (importing.value) return
  emit('close')
}

async function confirmImport() {
  if (importing.value) return
  const current = preview.value
  if (!current || current.error) return
  importing.value = true
  errorMessage.value = ''
  try {
    const result = await memoryStore.importMemory(props.raw, mode.value)
    emit('imported', result)
    emit('close')
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    importing.value = false
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="visible" class="modal-overlay" @pointerdown.self="close">
    <div class="import-dialog" role="dialog" aria-modal="true" aria-label="导入 AI 记忆">
      <header class="dialog-header">
        <span class="dialog-title">导入 AI 记忆</span>
        <button type="button" class="icon-close" title="关闭" @click="close">
          <X :size="16" />
        </button>
      </header>

      <div class="dialog-body">
        <div class="file-row">
          <FileJson :size="15" class="file-icon" />
          <span class="file-name">{{ fileName || '记忆文件' }}</span>
        </div>

        <div v-if="preview?.error" class="error-tip">
          <AlertTriangle :size="13" class="tip-icon" />
          <span>无法识别该文件：{{ preview.error }}</span>
        </div>

        <template v-else-if="preview">
          <div class="preview-grid">
            <div class="preview-item">
              <span class="preview-value">{{ preview.facts }}</span>
              <span class="preview-label">条记忆</span>
            </div>
            <div class="preview-item">
              <span class="preview-value">{{ preview.profileFields }}</span>
              <span class="preview-label">个画像字段</span>
            </div>
            <div class="preview-item">
              <span class="preview-value">{{ memoryStore.stats.total }}</span>
              <span class="preview-label">当前已有记忆</span>
            </div>
          </div>

          <div class="mode-options">
            <label class="mode-option" :class="{ active: mode === 'merge' }">
              <input v-model="mode" type="radio" value="merge" class="mode-radio" />
              <span class="mode-body">
                <span class="mode-title">合并（推荐）</span>
                <span class="mode-desc">
                  保留现有记忆；相同 id 的条目更新并合并标签，内容重复的条目跳过。
                </span>
              </span>
            </label>
            <label class="mode-option" :class="{ active: mode === 'replace' }">
              <input v-model="mode" type="radio" value="replace" class="mode-radio" />
              <span class="mode-body">
                <span class="mode-title">替换</span>
                <span class="mode-desc">
                  用文件内容覆盖现有记忆、画像与设置（导入前会自动备份到本机）。
                </span>
              </span>
            </label>
          </div>

          <div v-if="mode === 'replace'" class="warning-tip">
            <AlertTriangle :size="13" class="tip-icon" />
            <span>
              替换会清空当前 {{ memoryStore.stats.total }} 条记忆与用户画像，请确认已导出备份。
            </span>
          </div>
        </template>

        <div v-if="errorMessage" class="error-tip">
          <AlertTriangle :size="13" class="tip-icon" />
          <span>{{ errorMessage }}</span>
        </div>
      </div>

      <footer class="dialog-actions">
        <button type="button" class="btn btn-ghost" :disabled="importing" @click="close">
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="importing || !preview || !!preview.error"
          @click="confirmImport"
        >
          <Loader2 v-if="importing" :size="14" class="spin" />
          <FileUp v-else :size="14" />
          <span>{{ importing ? '导入中…' : '开始导入' }}</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.4);
  animation: mask-fade 0.15s ease;
}
@keyframes mask-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.import-dialog {
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--card);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: dialog-pop 0.16s ease;
}
@keyframes dialog-pop {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.dialog-title {
  font-size: 14px;
  font-weight: 600;
}
.icon-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.icon-close:hover {
  background: var(--muted);
  color: var(--foreground);
}
.dialog-body {
  padding: 16px 18px;
  overflow-y: auto;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--muted);
  margin-bottom: 14px;
}
.file-icon {
  flex-shrink: 0;
  color: var(--primary);
}
.file-name {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--foreground);
  word-break: break-all;
}
.preview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.preview-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
}
.preview-value {
  font-size: 18px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--foreground);
}
.preview-label {
  font-size: 11px;
  color: var(--muted-foreground);
}
.mode-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  cursor: pointer;
  transition: border-color 0.15s;
}
.mode-option.active {
  border-color: var(--primary);
}
.mode-radio {
  margin-top: 3px;
  accent-color: var(--primary);
  flex-shrink: 0;
}
.mode-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mode-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
}
.mode-desc {
  font-size: 12px;
  line-height: 1.55;
  color: var(--muted-foreground);
}
.warning-tip,
.error-tip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.55;
  word-break: break-word;
}
.warning-tip {
  background: var(--muted);
  color: var(--warning, #f59e0b);
}
.error-tip {
  background: var(--muted);
  color: var(--destructive);
}
.tip-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    opacity 0.15s,
    background 0.15s;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--foreground);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--muted);
}
.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
