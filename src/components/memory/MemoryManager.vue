<script setup lang="ts">
/**
 * AI 记忆管理容器
 *
 * 负责：store 加载/错误恢复编排、导入导出、清空、轻提示（含删除撤销），
 * 以及摘要 / 开关 / 事实 / 画像（折叠）/ 存储行 的组装。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-vue-next'
import { MEMORY_STORAGE_KEY, useAiMemoryStore, type ImportMemoryResult } from '@/stores/aiMemory'
import { isTauri } from '@/core/serializer/markdownFile'
import { confirmDialog, promptDialog } from '@/composables/useDialog'
import MemoryOverview from './MemoryOverview.vue'
import MemorySettingsCard from './MemorySettingsCard.vue'
import MemoryProfileCard from './MemoryProfileCard.vue'
import MemoryFactList from './MemoryFactList.vue'
import MemoryImportDialog from './MemoryImportDialog.vue'
import {
  describeFileError,
  openMemoryFile,
  saveMemoryExport,
  type MemoryNotifyPayload,
} from './memorySupport'

const memoryStore = useAiMemoryStore()

const loading = computed(() => !memoryStore.loaded && !memoryStore.loadError)
const retrying = ref(false)
const resetting = ref(false)
const exporting = ref(false)
const importing = ref(false)
const clearing = ref(false)
const importVisible = ref(false)
const importRaw = ref<unknown>(null)
const importFileName = ref('')

/** 「清空全部记忆」仅在确有数据时可用 */
const canClearAll = computed(
  () => memoryStore.stats.total > 0 || memoryStore.stats.profileFields > 0,
)

const storagePath = computed(() =>
  isTauri() ? '~/.unidoc/ai_memory.json' : `localStorage · ${MEMORY_STORAGE_KEY}`,
)
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyStoragePath() {
  try {
    if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板')
    await navigator.clipboard.writeText(storagePath.value)
    copied.value = true
    if (copyTimer !== null) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
      copyTimer = null
    }, 2000)
  } catch {
    notify({ type: 'error', message: '复制失败，请手动记录存储路径' })
  }
}

const toast = ref<MemoryNotifyPayload | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

const TOAST_DURATION_MS = 5000

function notify(payload: MemoryNotifyPayload) {
  if (toastTimer !== null) clearTimeout(toastTimer)
  toast.value = payload
  toastTimer = setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, TOAST_DURATION_MS)
}

function runUndo() {
  const action = toast.value?.undo
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
  toast.value = null
  if (action) action()
}

function errorMessageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

onMounted(() => {
  void memoryStore.load()
})

onBeforeUnmount(() => {
  if (toastTimer !== null) clearTimeout(toastTimer)
  if (copyTimer !== null) clearTimeout(copyTimer)
  void memoryStore.flushSave()
})

async function retryLoad() {
  if (retrying.value || resetting.value) return
  retrying.value = true
  try {
    await memoryStore.reload()
  } finally {
    retrying.value = false
  }
}

async function recoverFromCorrupt() {
  if (retrying.value || resetting.value) return
  const ok = await confirmDialog(
    `记忆文件读取失败：\n${memoryStore.loadError ?? '未知错误'}\n\n` +
      '「恢复」将放弃损坏的文件并以空记忆重新开始（原文件会被覆盖），确定继续吗？',
    '恢复记忆数据',
  )
  if (!ok) return
  resetting.value = true
  try {
    await memoryStore.forceReset()
    notify({ type: 'success', message: '已重置记忆数据，可以重新开始使用' })
  } catch (e) {
    notify({ type: 'error', message: `重置失败：${errorMessageOf(e)}` })
  } finally {
    resetting.value = false
  }
}

async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    const done = await saveMemoryExport(memoryStore.exportMemory())
    if (done) notify({ type: 'success', message: '记忆已导出到 JSON 文件' })
  } catch (e) {
    notify({ type: 'error', message: `导出失败：${errorMessageOf(e)}` })
  } finally {
    exporting.value = false
  }
}

async function handleImport() {
  if (importing.value) return
  importing.value = true
  try {
    const picked = await openMemoryFile()
    if (!picked) return
    importRaw.value = picked.raw
    importFileName.value = picked.fileName
    importVisible.value = true
  } catch (e) {
    notify({ type: 'error', message: `导入失败：${describeFileError(e)}` })
  } finally {
    importing.value = false
  }
}

function onImported(result: ImportMemoryResult) {
  importVisible.value = false
  notify({
    type: 'success',
    message: `导入完成：新增 ${result.added} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`,
  })
}

function closeImport() {
  importVisible.value = false
}

/**
 * 清空全部记忆（记忆条目 + 用户画像，保留记忆设置）
 * 需输入「清除」二次确认；清空前自动备份（备份失败不阻塞清空）。
 */
async function clearAllMemory() {
  if (clearing.value || !canClearAll.value) return
  const total = memoryStore.stats.total
  const answer = await promptDialog(
    `将删除全部 ${total} 条记忆和用户画像，且无法撤销。\n请输入「清除」确认：`,
    '',
    '清空全部记忆',
  )
  if (answer === null) return
  if (answer !== '清除') {
    notify({ type: 'info', message: '输入不匹配，已取消清空' })
    return
  }
  clearing.value = true
  try {
    await memoryStore.backupMemory()
    memoryStore.clearAll()
    await memoryStore.flushSave()
    notify({ type: 'success', message: '记忆已清空（已创建备份）' })
  } catch (e) {
    notify({ type: 'error', message: `清空失败：${errorMessageOf(e)}` })
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="memory-manager">
    <!-- 加载中 -->
    <div v-if="loading" class="state-panel">
      <Loader2 :size="20" class="state-icon spin" />
      <div class="state-title">正在加载记忆数据…</div>
    </div>

    <!-- 加载失败 / 文件损坏 -->
    <div v-else-if="memoryStore.loadError" class="state-panel error-panel">
      <AlertTriangle :size="22" class="state-icon error-icon" />
      <div class="state-title">记忆数据加载失败</div>
      <div class="state-desc">{{ memoryStore.loadError }}</div>
      <div class="state-hint">
        可先重试；若仍失败，可选择恢复：放弃损坏的文件并以空记忆重新开始。
      </div>
      <div class="state-actions">
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="retrying || resetting"
          @click="retryLoad"
        >
          <Loader2 v-if="retrying" :size="14" class="spin" />
          <RefreshCw v-else :size="14" />
          <span>{{ retrying ? '重试中…' : '重试' }}</span>
        </button>
        <button
          type="button"
          class="btn btn-danger"
          :disabled="retrying || resetting"
          @click="recoverFromCorrupt"
        >
          <Loader2 v-if="resetting" :size="14" class="spin" />
          <RotateCcw v-else :size="14" />
          <span>{{ resetting ? '恢复中…' : '恢复（重置记忆）' }}</span>
        </button>
      </div>
    </div>

    <template v-else>
      <!-- 摘要行 + 操作 -->
      <div class="summary-row">
        <MemoryOverview />
        <div class="summary-actions">
          <button
            type="button"
            class="text-action"
            :disabled="importing"
            title="从 JSON 文件导入记忆"
            @click="handleImport"
          >
            <Loader2 v-if="importing" :size="13" class="spin" />
            <Upload v-else :size="13" />
            <span>{{ importing ? '选择中…' : '导入' }}</span>
          </button>
          <button
            type="button"
            class="text-action"
            :disabled="exporting"
            title="导出记忆到 JSON 文件"
            @click="handleExport"
          >
            <Loader2 v-if="exporting" :size="13" class="spin" />
            <Download v-else :size="13" />
            <span>{{ exporting ? '导出中…' : '导出' }}</span>
          </button>
          <button
            type="button"
            class="text-action danger"
            :disabled="clearing || !canClearAll"
            title="删除全部记忆与用户画像（会先自动备份）"
            @click="clearAllMemory"
          >
            <Loader2 v-if="clearing" :size="13" class="spin" />
            <Trash2 v-else :size="13" />
            <span>{{ clearing ? '清空中…' : '清空' }}</span>
          </button>
        </div>
      </div>

      <MemorySettingsCard />
      <MemoryFactList @notify="notify" />
      <MemoryProfileCard @notify="notify" />

      <!-- 存储位置 -->
      <div class="storage-footer">
        <span class="storage-prefix">数据仅保存在本机：</span>
        <code class="storage-path">{{ storagePath }}</code>
        <button type="button" class="storage-copy" @click="copyStoragePath">
          <Check v-if="copied" :size="11" />
          <Copy v-else :size="11" />
          <span>{{ copied ? '已复制' : '复制' }}</span>
        </button>
      </div>
    </template>

    <MemoryImportDialog
      :visible="importVisible"
      :raw="importRaw"
      :file-name="importFileName"
      @close="closeImport"
      @imported="onImported"
    />

    <!-- 轻提示（含撤销） -->
    <div v-if="toast" class="memory-toast" :class="toast.type">
      <span class="toast-message">{{ toast.message }}</span>
      <button v-if="toast.undo" type="button" class="toast-undo" @click="runUndo">撤销</button>
    </div>
  </div>
</template>

<style scoped>
.memory-manager {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 2px 2px;
}
.summary-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.text-action:hover:not(:disabled) {
  background: var(--muted);
  color: var(--foreground);
}
.text-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.text-action.danger {
  color: var(--destructive);
}
.text-action.danger:hover:not(:disabled) {
  background: var(--muted);
  color: var(--destructive);
}
.storage-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 2px;
  font-size: 11px;
  color: var(--muted-foreground);
}
.storage-prefix {
  white-space: nowrap;
}
.storage-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted-foreground);
  word-break: break-all;
}
.storage-copy {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 4px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.storage-copy:hover {
  color: var(--primary);
}
.state-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 24px;
  text-align: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.state-icon {
  color: var(--muted-foreground);
}
.error-panel {
  align-items: flex-start;
  text-align: left;
  border-left: 3px solid var(--destructive);
}
.error-icon {
  color: var(--destructive);
}
.state-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
}
.state-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--destructive);
  font-family: var(--font-mono);
  word-break: break-all;
  max-width: 100%;
}
.state-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-foreground);
  max-width: 560px;
}
.state-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    opacity 0.15s,
    background 0.15s;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--foreground);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--muted);
}
.btn-danger {
  background: var(--destructive);
  color: var(--destructive-foreground);
}
.btn-danger:hover:not(:disabled) {
  opacity: 0.9;
}
.memory-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: min(520px, calc(100vw - 48px));
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  animation: toast-in 0.2s var(--ease-out);
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
.memory-toast.success {
  background: var(--success);
  color: var(--success-foreground);
}
.memory-toast.error {
  background: var(--destructive);
  color: var(--destructive-foreground);
}
.memory-toast.info {
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
}
.toast-message {
  min-width: 0;
  word-break: break-word;
}
.toast-undo {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  opacity: 0.9;
}
.toast-undo:hover {
  opacity: 1;
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
