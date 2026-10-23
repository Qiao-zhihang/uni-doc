<script setup lang="ts">
/**
 * 记忆行为设置：默认只展示两个开关，高级项折叠在「高级设置」中
 */
import { computed, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useAiMemoryStore } from '@/stores/aiMemory'

const memoryStore = useAiMemoryStore()
const settings = computed(() => memoryStore.settings)

const advancedOpen = ref(false)
const injectFacts = ref(settings.value.maxInjectFacts)
const factChars = ref(settings.value.maxFactChars)

watch(
  () => [memoryStore.settings.maxInjectFacts, memoryStore.settings.maxFactChars] as const,
  ([maxInjectFacts, maxFactChars]) => {
    injectFacts.value = maxInjectFacts
    factChars.value = maxFactChars
  },
  { immediate: true },
)

function patch(patchValue: Parameters<typeof memoryStore.updateMemorySettings>[0]) {
  memoryStore.updateMemorySettings(patchValue)
  void memoryStore.flushSave()
}

function toggleEnabled() {
  patch({ enabled: !settings.value.enabled })
}

function toggleAutoExtract() {
  if (!settings.value.enabled) return
  patch({ autoExtract: !settings.value.autoExtract })
}

function toggleAutoCleanup() {
  patch({ autoCleanup: !settings.value.autoCleanup })
}

function commitInjectFacts() {
  const current = memoryStore.settings.maxInjectFacts
  const parsed = Number(injectFacts.value)
  const next = Number.isFinite(parsed) ? Math.min(10, Math.max(1, Math.round(parsed))) : current
  injectFacts.value = next
  if (next !== current) patch({ maxInjectFacts: next })
}

function commitFactChars() {
  const current = memoryStore.settings.maxFactChars
  const parsed = Number(factChars.value)
  const next = Number.isFinite(parsed) ? Math.min(2000, Math.max(100, Math.round(parsed))) : current
  factChars.value = next
  if (next !== current) patch({ maxFactChars: next })
}
</script>

<template>
  <div class="settings-card">
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-title">启用 AI 记忆</div>
        <div class="setting-desc">关闭后不再注入记忆，已有数据会保留。</div>
      </div>
      <button
        type="button"
        class="switch"
        :class="{ on: settings.enabled }"
        :aria-pressed="settings.enabled"
        @click="toggleEnabled"
      >
        <span class="switch-knob"></span>
      </button>
    </div>

    <div class="setting-row" :class="{ disabled: !settings.enabled }">
      <div class="setting-info">
        <div class="setting-title">自动提取</div>
        <div class="setting-desc">对话结束后自动记住新信息。</div>
      </div>
      <button
        type="button"
        class="switch"
        :class="{ on: settings.autoExtract }"
        :disabled="!settings.enabled"
        :aria-pressed="settings.autoExtract"
        @click="toggleAutoExtract"
      >
        <span class="switch-knob"></span>
      </button>
    </div>

    <button type="button" class="advanced-toggle" @click="advancedOpen = !advancedOpen">
      <ChevronRight :size="13" class="advanced-chevron" :class="{ open: advancedOpen }" />
      <span>高级设置</span>
    </button>

    <div v-if="advancedOpen" class="advanced-panel">
      <div class="setting-row compact">
        <div class="setting-info">
          <div class="setting-title">自动清理低价值记忆</div>
          <div class="setting-desc">加载时清理过期低价值记忆，置顶项保留。</div>
        </div>
        <button
          type="button"
          class="switch"
          :class="{ on: settings.autoCleanup }"
          :aria-pressed="settings.autoCleanup"
          @click="toggleAutoCleanup"
        >
          <span class="switch-knob"></span>
        </button>
      </div>

      <div class="setting-row compact">
        <div class="setting-info">
          <div class="setting-title">每次注入条数</div>
          <div class="setting-desc">1-10 条，越大多轮上下文越丰富。</div>
        </div>
        <input
          v-model.number="injectFacts"
          type="number"
          min="1"
          max="10"
          step="1"
          class="form-input number-input"
          @change="commitInjectFacts"
          @blur="commitInjectFacts"
        />
      </div>

      <div class="setting-row compact last">
        <div class="setting-info">
          <div class="setting-title">单条注入长度</div>
          <div class="setting-desc">100-2000 字，超出会截断。</div>
        </div>
        <input
          v-model.number="factChars"
          type="number"
          min="100"
          max="2000"
          step="50"
          class="form-input number-input"
          @change="commitFactChars"
          @blur="commitFactChars"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 16px;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.setting-row.compact {
  padding: 10px 0;
}
.setting-row.last {
  border-bottom: none;
}
.setting-row.disabled {
  opacity: 0.55;
}
.setting-info {
  min-width: 0;
}
.setting-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
}
.setting-desc {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted-foreground);
}
.switch {
  position: relative;
  width: 38px;
  height: 21px;
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
.switch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch.on .switch-knob {
  transform: translateX(17px);
}
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 9px 0;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.advanced-toggle:hover {
  color: var(--foreground);
}
.advanced-chevron {
  transition: transform 0.18s ease;
}
.advanced-chevron.open {
  transform: rotate(90deg);
}
.advanced-panel {
  padding: 2px 0 4px;
}
.form-input {
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  color: var(--foreground);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.form-input:focus {
  border-color: var(--primary);
}
.form-input.number-input {
  width: 80px;
  height: 30px;
  flex-shrink: 0;
  padding: 0 8px;
  text-align: center;
}
</style>
