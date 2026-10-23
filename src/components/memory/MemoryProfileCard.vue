<script setup lang="ts">
/**
 * 用户画像卡片：默认折叠，展开后可展示/编辑 UserProfile 字段
 */
import { computed, reactive, ref } from 'vue'
import { ChevronRight, Pencil, Plus, Trash2, User } from 'lucide-vue-next'
import { useAiMemoryStore } from '@/stores/aiMemory'
import { normalizeTagList } from '@/ai/memoryCore'
import { confirmDialog } from '@/composables/useDialog'
import TagInput from '@/components/common/TagInput.vue'
import type { MemoryNotifyPayload } from './memorySupport'

interface DisplayField {
  label: string
  text?: string
  tags?: string[]
}

const emit = defineEmits<{
  (e: 'notify', payload: MemoryNotifyPayload): void
}>()

const memoryStore = useAiMemoryStore()

const expanded = ref(false)
const editing = ref(false)
const draft = reactive({
  name: '',
  aliases: [] as string[],
  writingStyle: '',
  formatPreferences: [] as string[],
  themes: [] as string[],
  techStack: [] as string[],
  notes: '',
})

const hasProfile = computed(() => memoryStore.stats.profileFields > 0)
const summary = computed(() => {
  const fields = memoryStore.stats.profileFields
  if (fields === 0) return '尚未填写'
  const name = memoryStore.profile.name?.trim()
  return name ? `${name} · ${fields} 个字段` : `${fields} 个字段已填写`
})
const displayFields = computed<DisplayField[]>(() => {
  const profile = memoryStore.profile
  const fields: DisplayField[] = []
  if (profile.name) fields.push({ label: '姓名', text: profile.name })
  if (profile.aliases && profile.aliases.length > 0) {
    fields.push({ label: '别称', tags: profile.aliases })
  }
  if (profile.writingStyle) fields.push({ label: '写作风格', text: profile.writingStyle })
  if (profile.formatPreferences && profile.formatPreferences.length > 0) {
    fields.push({ label: '格式偏好', tags: profile.formatPreferences })
  }
  if (profile.themes && profile.themes.length > 0) {
    fields.push({ label: '关注主题', tags: profile.themes })
  }
  if (profile.techStack && profile.techStack.length > 0) {
    fields.push({ label: '技术栈', tags: profile.techStack })
  }
  if (profile.notes) fields.push({ label: '备注', text: profile.notes })
  return fields
})

function toggle() {
  expanded.value = !expanded.value
}

function startEdit() {
  const profile = memoryStore.profile
  draft.name = profile.name ?? ''
  draft.aliases = [...(profile.aliases ?? [])]
  draft.writingStyle = profile.writingStyle ?? ''
  draft.formatPreferences = [...(profile.formatPreferences ?? [])]
  draft.themes = [...(profile.themes ?? [])]
  draft.techStack = [...(profile.techStack ?? [])]
  draft.notes = profile.notes ?? ''
  expanded.value = true
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function saveProfile() {
  memoryStore.updateProfile({
    name: draft.name.trim(),
    aliases: normalizeTagList(draft.aliases),
    writingStyle: draft.writingStyle.trim(),
    formatPreferences: normalizeTagList(draft.formatPreferences),
    themes: normalizeTagList(draft.themes),
    techStack: normalizeTagList(draft.techStack),
    notes: draft.notes.trim(),
  })
  void memoryStore.flushSave()
  editing.value = false
  emit('notify', { type: 'success', message: '用户画像已保存' })
}

async function clearProfile() {
  const ok = await confirmDialog('确定清空用户画像吗？记忆条目不受影响。', '清空用户画像')
  if (!ok) return
  memoryStore.clearProfile()
  void memoryStore.flushSave()
  editing.value = false
  emit('notify', { type: 'success', message: '用户画像已清空' })
}
</script>

<template>
  <div class="profile-card">
    <button type="button" class="profile-toggle" @click="toggle">
      <User :size="14" class="toggle-icon" />
      <span class="profile-title">用户画像（可选）</span>
      <span class="profile-summary">{{ summary }}</span>
      <ChevronRight :size="14" class="profile-chevron" :class="{ open: expanded }" />
    </button>

    <div v-if="expanded" class="profile-body">
      <template v-if="!editing">
        <div v-if="!hasProfile" class="empty-state">
          <span class="empty-hint">填写姓名、写作风格等信息，让回答更贴合你。</span>
          <button type="button" class="btn btn-primary" @click="startEdit">
            <Plus :size="13" />
            <span>填写画像</span>
          </button>
        </div>
        <template v-else>
          <div class="body-toolbar">
            <span class="body-hint">画像会随对话注入给 AI。</span>
            <div class="body-actions">
              <button type="button" class="text-btn" @click="startEdit">
                <Pencil :size="12" />
                <span>编辑</span>
              </button>
              <button type="button" class="text-btn danger" @click="clearProfile">
                <Trash2 :size="12" />
                <span>清空</span>
              </button>
            </div>
          </div>
          <dl class="profile-view">
            <div v-for="field in displayFields" :key="field.label" class="profile-row">
              <dt class="profile-label">{{ field.label }}</dt>
              <dd class="profile-value">
                <template v-if="field.tags">
                  <span v-for="tag in field.tags" :key="tag" class="tag-chip">{{ tag }}</span>
                </template>
                <template v-else>{{ field.text }}</template>
              </dd>
            </div>
          </dl>
        </template>
      </template>

      <div v-else class="profile-form">
        <div class="form-grid">
          <div class="form-field">
            <label class="form-label">姓名</label>
            <input v-model="draft.name" type="text" class="form-input" placeholder="例如：张三" />
          </div>
          <div class="form-field">
            <label class="form-label">别称 / 称呼</label>
            <TagInput v-model="draft.aliases" placeholder="AI 可以怎么称呼你" />
          </div>
          <div class="form-field full">
            <label class="form-label">写作风格</label>
            <input
              v-model="draft.writingStyle"
              type="text"
              class="form-input"
              placeholder="例如：简洁直接、多用列表"
            />
          </div>
          <div class="form-field">
            <label class="form-label">格式偏好</label>
            <TagInput v-model="draft.formatPreferences" placeholder="例如：Markdown 表格" />
          </div>
          <div class="form-field">
            <label class="form-label">关注主题</label>
            <TagInput v-model="draft.themes" placeholder="例如：产品设计" />
          </div>
          <div class="form-field full">
            <label class="form-label">技术栈</label>
            <TagInput v-model="draft.techStack" placeholder="例如：Vue 3、TypeScript" />
          </div>
          <div class="form-field full">
            <label class="form-label">备注</label>
            <textarea
              v-model="draft.notes"
              class="form-textarea"
              rows="3"
              placeholder="其他希望 AI 了解的信息"
            ></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" @click="cancelEdit">取消</button>
          <button type="button" class="btn btn-primary" @click="saveProfile">保存画像</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.profile-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  border-radius: 8px;
}
.profile-toggle:hover .profile-title {
  color: var(--primary);
}
.toggle-icon {
  flex-shrink: 0;
  color: var(--muted-foreground);
}
.profile-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  white-space: nowrap;
  transition: color 0.15s;
}
.profile-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted-foreground);
}
.profile-chevron {
  flex-shrink: 0;
  color: var(--muted-foreground);
  transition: transform 0.18s ease;
}
.profile-chevron.open {
  transform: rotate(90deg);
}
.profile-body {
  padding: 0 16px 16px;
  border-top: 1px solid var(--border);
}
.body-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 8px;
}
.body-hint {
  font-size: 11px;
  color: var(--muted-foreground);
}
.body-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.text-btn:hover {
  background: var(--muted);
  color: var(--foreground);
}
.text-btn.danger:hover {
  color: var(--destructive);
  border-color: var(--destructive);
}
.empty-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
}
.empty-hint {
  font-size: 12px;
  color: var(--muted-foreground);
}
.profile-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.profile-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.profile-label {
  flex-shrink: 0;
  width: 68px;
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 22px;
}
.profile-value {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 0;
  min-width: 0;
  font-size: 13px;
  line-height: 22px;
  color: var(--foreground);
  word-break: break-word;
  white-space: pre-wrap;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--muted);
  color: var(--foreground);
  font-size: 12px;
}
.profile-form {
  padding-top: 14px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 14px;
}
.form-field.full {
  grid-column: 1 / -1;
}
.form-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  margin-bottom: 5px;
}
.form-input,
.form-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  color: var(--foreground);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.form-input {
  height: 34px;
}
.form-textarea {
  padding: 8px 10px;
  line-height: 1.6;
  resize: vertical;
  min-height: 68px;
}
.form-input:focus,
.form-textarea:focus {
  border-color: var(--primary);
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
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
.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.btn-primary:hover {
  opacity: 0.9;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--foreground);
}
.btn-ghost:hover {
  background: var(--muted);
}
</style>
