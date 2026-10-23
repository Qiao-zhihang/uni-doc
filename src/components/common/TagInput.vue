<script setup lang="ts">
/**
 * 受控标签输入框
 *
 * 用法:
 *   <TagInput v-model="tags" placeholder="输入后按回车添加" :disabled="saving" />
 *
 * 交互:Enter / 逗号添加标签, × 删除标签, 空输入时 Backspace 删除最后一个,
 * 粘贴含逗号/换行的文本会批量拆分添加。自动 trim 并按不区分大小写去重。
 */
import { ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    placeholder: '输入后按回车添加',
    disabled: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

/** 合并新标签:trim + 忽略大小写去重 */
function mergeTags(existing: string[], incoming: string[]): string[] {
  const next = [...existing]
  const seen = new Set(next.map((tag) => tag.toLowerCase()))
  for (const raw of incoming) {
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(tag)
  }
  return next
}

function addTag() {
  if (props.disabled) return
  const raw = draft.value
  draft.value = ''
  const trimmed = raw.trim()
  if (!trimmed) return
  const next = mergeTags(props.modelValue, [trimmed])
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
}

function removeTag(index: number) {
  if (props.disabled) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault()
    addTag()
    return
  }
  if (e.key === 'Backspace' && !draft.value && props.modelValue.length > 0) {
    e.preventDefault()
    removeTag(props.modelValue.length - 1)
  }
}

/** 粘贴 "a, b，c" 或换行分隔的文本时批量添加 */
function onPaste(e: ClipboardEvent) {
  if (props.disabled) return
  const text = e.clipboardData?.getData('text') ?? ''
  if (!/[,，\n]/.test(text)) return
  e.preventDefault()
  const parts = text.split(/[,，\n]/)
  const next = mergeTags(props.modelValue, parts)
  draft.value = ''
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
}

function focusInput() {
  if (props.disabled) return
  inputRef.value?.focus()
}
</script>

<template>
  <div class="tag-input" :class="{ disabled }" @click="focusInput">
    <span v-for="(tag, index) in modelValue" :key="`${tag}-${index}`" class="tag-chip">
      <span class="tag-text">{{ tag }}</span>
      <button
        v-if="!disabled"
        type="button"
        class="tag-remove"
        title="移除标签"
        @mousedown.prevent
        @click.stop="removeTag(index)"
      >
        <X :size="11" />
      </button>
    </span>
    <input
      ref="inputRef"
      v-model="draft"
      type="text"
      class="tag-field"
      :placeholder="modelValue.length === 0 ? placeholder : ''"
      :disabled="disabled"
      @keydown="onKeydown"
      @blur="addTag"
      @paste="onPaste"
    />
  </div>
</template>

<style scoped>
.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 4px 8px;
  box-sizing: border-box;
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: text;
  transition: border-color 0.15s;
}
.tag-input:focus-within {
  border-color: var(--primary);
}
.tag-input.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 4px 0 8px;
  border-radius: 4px;
  background: var(--muted);
  color: var(--foreground);
  font-size: 12px;
  max-width: 100%;
}
.tag-text {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  flex-shrink: 0;
}
.tag-remove:hover {
  background: var(--border);
  color: var(--foreground);
}
.tag-field {
  flex: 1;
  min-width: 120px;
  height: 26px;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--foreground);
  font-size: 13px;
  font-family: inherit;
}
.tag-field::placeholder {
  color: var(--muted-foreground);
}
.tag-field:disabled {
  cursor: not-allowed;
}
</style>
