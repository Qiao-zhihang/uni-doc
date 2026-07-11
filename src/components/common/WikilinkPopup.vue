/**
 * Wikilink 自动补全浮动选择框
 * 通过 Teleport 渲染到 body,跟随光标位置
 */
<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="wikilink-popup no-scrollbar"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @click.stop
      @mousedown.prevent
    >
      <div v-if="items.length === 0" class="empty-hint">无匹配文件</div>
      <div
        v-for="(item, idx) in items"
        :key="item.path"
        class="item"
        :class="{ active: idx === selectedIndex }"
        @mouseenter="onHover(idx)"
        @mousedown.prevent="onSelect(item)"
      >
        <span class="item-name">{{ item.name }}</span>
        <span class="item-path">{{ item.path }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { AutocompleteItem } from '@/composables/useWikilinkAutocomplete'

defineProps<{
  visible: boolean
  items: AutocompleteItem[]
  selectedIndex: number
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'select', item: AutocompleteItem): void
  (e: 'hover', idx: number): void
}>()

function onHover(idx: number) {
  emit('hover', idx)
}

function onSelect(item: AutocompleteItem) {
  emit('select', item)
}
</script>

<style scoped>
.wikilink-popup {
  position: fixed;
  z-index: 10000;
  max-height: 280px;
  width: 320px;
  overflow-y: auto;
  background: var(--popover, #fff);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  font-family: var(--font-sans, system-ui);
  font-size: 13px;
  padding: 4px 0;
}

.empty-hint {
  padding: 12px 16px;
  color: var(--muted-foreground, #999);
  text-align: center;
}

.item {
  display: flex;
  flex-direction: column;
  padding: 6px 14px;
  cursor: pointer;
  gap: 2px;
}

.item.active {
  background: var(--secondary, #f5f5f5);
}

.item-name {
  color: var(--foreground, #333);
  font-weight: 500;
}

.item-path {
  color: var(--muted-foreground, #aaa);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
