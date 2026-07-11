<script setup lang="ts">
/**
 * 对话框宿主组件
 * 挂载在根,渲染 confirmDialog / promptDialog 触发的 modal
 * 无原生对话框依赖,Web/Tauri 通用
 */
import { nextTick, ref, watch } from 'vue'
import { useDialog } from '@/composables/useDialog'

const { confirmState, promptState, resolveConfirm, resolvePrompt } = useDialog()

const promptInputRef = ref<HTMLInputElement | null>(null)

// prompt 弹出时自动聚焦输入框
watch(
  () => promptState.visible,
  (v) => {
    if (v) {
      nextTick(() => {
        promptInputRef.value?.focus()
        promptInputRef.value?.select()
      })
    }
  }
)

function onPromptKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    const v = promptState.inputValue.trim()
    if (v) resolvePrompt(v)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    resolvePrompt(null)
  }
}
</script>

<template>
  <!-- 确认对话框 -->
  <div v-if="confirmState.visible" class="dialog-mask" @pointerdown.self="resolveConfirm(false)">
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <span class="dialog-title">{{ confirmState.title }}</span>
      </div>
      <div class="dialog-body">{{ confirmState.message }}</div>
      <div class="dialog-actions">
        <button class="btn btn-cancel" @click="resolveConfirm(false)">取消</button>
        <button class="btn btn-confirm" @click="resolveConfirm(true)">确认</button>
      </div>
    </div>
  </div>

  <!-- 输入对话框 -->
  <div v-if="promptState.visible" class="dialog-mask" @pointerdown.self="resolvePrompt(null)">
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <span class="dialog-title">{{ promptState.title }}</span>
      </div>
      <div class="dialog-body">
        <label class="prompt-label">{{ promptState.message }}</label>
        <input
          ref="promptInputRef"
          v-model="promptState.inputValue"
          class="prompt-input"
          type="text"
          @keydown="onPromptKeydown"
        />
      </div>
      <div class="dialog-actions">
        <button class="btn btn-cancel" @click="resolvePrompt(null)">取消</button>
        <button
          class="btn btn-confirm"
          :disabled="!promptState.inputValue.trim()"
          @click="resolvePrompt(promptState.inputValue.trim())"
        >
          确认
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  animation: mask-fade 0.12s ease;
}
@keyframes mask-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.dialog {
  width: 360px;
  max-width: calc(100vw - 32px);
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: dialog-pop 0.15s ease;
}
@keyframes dialog-pop {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.dialog-header {
  padding: 12px 16px 4px;
}
.dialog-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--popover-foreground);
}
.dialog-body {
  padding: 4px 16px 16px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-foreground);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.prompt-label {
  white-space: pre-wrap;
}
.prompt-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-button);
  background: var(--secondary);
  font-size: 12px;
  font-family: var(--font-sans);
  color: var(--foreground);
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.prompt-input:focus {
  border-color: var(--ring);
  box-shadow: 0 0 0 2px var(--ring);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 16px 12px;
}
.btn {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-button);
  font-size: 12px;
  transition: background 0.12s ease, filter 0.12s ease;
}
.btn-cancel {
  background: var(--secondary);
  color: var(--foreground);
}
.btn-cancel:hover {
  background: var(--accent);
}
.btn-confirm {
  background: var(--brand-500);
  color: var(--primary-foreground);
}
.btn-confirm:hover:not(:disabled) {
  filter: brightness(0.96);
}
.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
