<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const props = defineProps<{ fallback?: string }>()

const hasError = ref(false)
const errorMsg = ref('')

onErrorCaptured((err, _instance, info) => {
  hasError.value = true
  errorMsg.value = `${err} (${info})`
  console.error('[ErrorBoundary] 捕获到组件错误:', err, info)
  return false
})
</script>

<template>
  <div v-if="hasError" class="error-boundary" title="组件渲染出错，已隔离">
    <span class="error-icon">⚠</span>
    <span class="error-text">
      <slot name="error" :msg="errorMsg">
        {{ props.fallback || '渲染失败' }}
      </slot>
    </span>
  </div>
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin: 4px 0;
  background: rgba(255, 59, 48, 0.08);
  border: 1px solid rgba(255, 59, 48, 0.3);
  border-radius: 6px;
  color: var(--color-text, #ff3b30);
  font-size: 13px;
  font-family: inherit;
}
.error-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
