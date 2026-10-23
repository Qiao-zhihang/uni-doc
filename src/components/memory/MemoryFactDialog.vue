<script setup lang="ts">
/**
 * 新增 / 编辑记忆弹窗
 *
 * 校验内容非空与长度上限，保存前通过 findSimilarFact 查重并二次确认。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { AlertTriangle, Loader2, Plus, Save, X } from 'lucide-vue-next'
import { useAiMemoryStore } from '@/stores/aiMemory'
import { MAX_FACT_CONTENT_LENGTH, normalizeTagList } from '@/ai/memoryCore'
import type { MemoryCategory, MemoryFact } from '@/ai/types'
import { MEMORY_CATEGORY_LABELS } from '@/ai/types'
import { confirmDialog } from '@/composables/useDialog'
import { truncateText } from './memorySupport'
import TagInput from '@/components/common/TagInput.vue'

const props = defineProps<{
  visible: boolean
  fact: MemoryFact | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', mode: 'added' | 'updated'): void
}>()

const memoryStore = useAiMemoryStore()

const isEdit = computed(() => props.fact !== null)
const categoryOptions = (Object.entries(MEMORY_CATEGORY_LABELS) as [MemoryCategory, string][]).map(
  ([value, label]) => ({ value, label }),
)

const draft = reactive({
  content: '',
  category: 'knowledge' as MemoryCategory,
  tags: [] as string[],
  importance: 0.5,
  pinned: false,
  enabled: true,
})
const errorMessage = ref('')
const saving = ref(false)

const importanceLabel = computed(() => {
  if (draft.importance >= 0.75) return '高'
  if (draft.importance >= 0.4) return '中'
  return '低'
})

function initDraft() {
  const fact = props.fact
  if (fact) {
    draft.content = fact.content
    draft.category = fact.category
    draft.tags = [...fact.tags]
    draft.importance = fact.importance
    draft.pinned = fact.pinned === true
    draft.enabled = fact.enabled !== false
  } else {
    draft.content = ''
    draft.category = 'knowledge'
    draft.tags = []
    draft.importance = 0.5
    draft.pinned = false
    draft.enabled = true
  }
  errorMessage.value = ''
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      initDraft()
      document.addEventListener('keydown', onKeydown)
    } else {
      document.removeEventListener('keydown', onKeydown)
    }
  },
)

function close() {
  if (saving.value) return
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

async function save() {
  if (saving.value) return
  const content = draft.content.trim()
  if (!content) {
    errorMessage.value = '记忆内容不能为空'
    return
  }
  errorMessage.value = ''

  const similar = memoryStore.findSimilarFact(content)
  if (similar && similar.id !== props.fact?.id) {
    const ok = await confirmDialog(
      `检测到相似记忆：\n「${truncateText(similar.content, 100)}」\n\n仍要保存吗？`,
      '可能重复的记忆',
    )
    if (!ok) return
  }

  saving.value = true
  try {
    if (props.fact) {
      memoryStore.updateFact(props.fact.id, {
        content,
        category: draft.category,
        tags: normalizeTagList(draft.tags),
        importance: draft.importance,
        pinned: draft.pinned,
        enabled: draft.enabled,
      })
      emit('saved', 'updated')
    } else {
      memoryStore.addFact(content, draft.category, draft.tags, 'manual', draft.importance)
      emit('saved', 'added')
    }
    void memoryStore.flushSave()
    emit('close')
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="visible" class="modal-overlay" @pointerdown.self="close">
    <div class="fact-dialog" role="dialog" aria-modal="true" aria-label="编辑记忆">
      <header class="dialog-header">
        <span class="dialog-title">{{ isEdit ? '编辑记忆' : '新增记忆' }}</span>
        <button type="button" class="icon-close" title="关闭" @click="close">
          <X :size="16" />
        </button>
      </header>

      <div class="dialog-body">
        <div class="form-field">
          <div class="label-row">
            <label class="form-label">内容</label>
            <span
              class="char-counter"
              :class="{ limit: draft.content.length >= MAX_FACT_CONTENT_LENGTH }"
            >
              {{ draft.content.length }} / {{ MAX_FACT_CONTENT_LENGTH }}
            </span>
          </div>
          <textarea
            v-model="draft.content"
            class="fact-textarea"
            rows="5"
            :maxlength="MAX_FACT_CONTENT_LENGTH"
            placeholder="例如：我偏好用 Markdown 表格整理对比信息"
            @input="errorMessage = ''"
          ></textarea>
        </div>

        <div class="form-grid">
          <div class="form-field">
            <label class="form-label">分类</label>
            <select v-model="draft.category" class="form-select">
              <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <div class="form-field">
            <div class="label-row">
              <label class="form-label">重要度</label>
              <span class="importance-value">
                {{ importanceLabel }}（{{ draft.importance.toFixed(1) }}）
              </span>
            </div>
            <input
              v-model.number="draft.importance"
              type="range"
              min="0"
              max="1"
              step="0.05"
              class="form-slider"
            />
          </div>

          <div class="form-field full">
            <label class="form-label">标签</label>
            <TagInput v-model="draft.tags" placeholder="输入后按回车添加标签" />
          </div>

          <div v-if="isEdit" class="form-field full">
            <div class="flag-rows">
              <div class="switch-row">
                <button
                  type="button"
                  class="switch"
                  :class="{ on: draft.pinned }"
                  :aria-pressed="draft.pinned"
                  @click="draft.pinned = !draft.pinned"
                >
                  <span class="switch-knob"></span>
                </button>
                <span class="switch-label">置顶</span>
                <span class="switch-hint">注入与清理时优先保留</span>
              </div>
              <div class="switch-row">
                <button
                  type="button"
                  class="switch"
                  :class="{ on: draft.enabled }"
                  :aria-pressed="draft.enabled"
                  @click="draft.enabled = !draft.enabled"
                >
                  <span class="switch-knob"></span>
                </button>
                <span class="switch-label">启用此记忆</span>
                <span class="switch-hint">停用后不参与注入与检索</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="errorMessage" class="error-tip">
          <AlertTriangle :size="13" />
          <span>{{ errorMessage }}</span>
        </div>
      </div>

      <footer class="dialog-actions">
        <button type="button" class="btn btn-ghost" :disabled="saving" @click="close">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
          <Loader2 v-if="saving" :size="14" class="spin" />
          <Save v-else-if="isEdit" :size="14" />
          <Plus v-else :size="14" />
          <span>{{ saving ? '保存中…' : isEdit ? '保存修改' : '添加记忆' }}</span>
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
.fact-dialog {
  width: 560px;
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
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 16px;
  margin-top: 14px;
}
.form-field.full {
  grid-column: 1 / -1;
}
.form-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  margin-bottom: 6px;
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.label-row .form-label {
  margin-bottom: 0;
}
.char-counter {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted-foreground);
}
.char-counter.limit {
  color: var(--destructive);
}
.fact-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  resize: vertical;
  min-height: 110px;
  font-family: inherit;
  transition: border-color 0.15s;
}
.fact-textarea:focus {
  border-color: var(--primary);
}
.form-select {
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  padding: 0 10px;
  font-size: 13px;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  font-family: inherit;
}
.form-select:focus {
  border-color: var(--primary);
}
.importance-value {
  font-size: 11px;
  color: var(--primary);
  font-family: var(--font-mono);
}
.form-slider {
  width: 100%;
  height: 20px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.flag-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 11px;
  background: var(--muted);
  cursor: pointer;
  transition: background 0.2s;
}
.switch.on {
  background: var(--primary);
}
.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch.on .switch-knob {
  transform: translateX(18px);
}
.switch-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
}
.switch-hint {
  font-size: 11px;
  color: var(--muted-foreground);
}
.error-tip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 14px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--muted);
  color: var(--destructive);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.error-tip svg {
  flex-shrink: 0;
  margin-top: 1px;
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
