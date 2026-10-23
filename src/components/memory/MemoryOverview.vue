<script setup lang="ts">
/**
 * 记忆概览：单行摘要（条数 / 置顶 / 停用 / 容量 / 最近更新）
 * 不渲染任何告警或提示。
 */
import { computed } from 'vue'
import { formatRelativeTime } from '@/ai/memoryCore'
import { useAiMemoryStore } from '@/stores/aiMemory'

const memoryStore = useAiMemoryStore()

const stats = computed(() => memoryStore.stats)
const disabledCount = computed(() => Math.max(0, stats.value.total - stats.value.enabled))
const capacityPercent = computed(() =>
  Math.min(100, Math.round((stats.value.total / Math.max(1, stats.value.capacity)) * 100)),
)
const updatedLabel = computed(() => formatRelativeTime(memoryStore.memory.updatedAt))
</script>

<template>
  <div class="overview-line">
    <span class="overview-item">
      <strong class="overview-num">{{ stats.total }}</strong>
      <span>条记忆</span>
    </span>
    <span class="overview-dot">·</span>
    <span class="overview-item">{{ stats.pinned }} 置顶</span>
    <span class="overview-dot">·</span>
    <span class="overview-item">{{ disabledCount }} 停用</span>

    <span class="capacity" :title="`容量 ${stats.total} / ${stats.capacity}`">
      <span class="capacity-bar">
        <span class="capacity-fill" :style="{ width: capacityPercent + '%' }"></span>
      </span>
      <span class="capacity-text">{{ stats.total }} / {{ stats.capacity }}</span>
    </span>

    <span class="overview-dot">·</span>
    <span class="overview-item muted">更新于 {{ updatedLabel }}</span>

    <span class="enabled-chip" :class="{ off: !memoryStore.enabled }">
      {{ memoryStore.enabled ? '已启用' : '已关闭' }}
    </span>
  </div>
</template>

<style scoped>
.overview-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--muted-foreground);
}
.overview-item {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  white-space: nowrap;
}
.overview-num {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  font-family: var(--font-mono);
  line-height: 1;
}
.overview-dot {
  color: var(--border);
  user-select: none;
}
.capacity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.capacity-bar {
  width: 46px;
  height: 4px;
  border-radius: 2px;
  background: var(--muted);
  overflow: hidden;
}
.capacity-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--primary);
  transition: width 0.3s ease;
}
.capacity-text {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted-foreground);
}
.overview-item.muted {
  color: var(--muted-foreground);
}
.enabled-chip {
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--primary);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.enabled-chip.off {
  background: var(--muted);
  color: var(--muted-foreground);
}
</style>
