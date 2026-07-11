<script setup lang="ts">
/**
 * 通用右键菜单
 * 参考 UI 改造方案 §3.3(交互规范)
 *
 * 用法:
 *   <ContextMenu
 *     v-if="menu.visible"
 *     :x="menu.x" :y="menu.y"
 *     :items="menu.items"
 *     @select="onMenuSelect"
 *     @close="menu.visible = false"
 *   />
 *
 * items 中 type='separator' 渲染分隔线,其余渲染可点击项
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'

export interface MenuItem {
  type?: 'item' | 'separator'
  key?: string
  label?: string
  icon?: unknown
  disabled?: boolean
  danger?: boolean
}

const props = defineProps<{
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
  (e: 'close'): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const adjustedPos = ref({ x: 0, y: 0 })

/** 调整位置避免溢出视窗 */
function adjustPosition() {
  if (!rootRef.value) return
  const rect = rootRef.value.getBoundingClientRect()
  let x = props.x
  let y = props.y
  if (x + rect.width > window.innerWidth - 8) {
    x = Math.max(8, window.innerWidth - rect.width - 8)
  }
  if (y + rect.height > window.innerHeight - 8) {
    y = Math.max(8, window.innerHeight - rect.height - 8)
  }
  adjustedPos.value = { x, y }
}

onMounted(() => {
  // 先以原始位置渲染,再调整
  adjustedPos.value = { x: props.x, y: props.y }
  requestAnimationFrame(adjustPosition)
  window.addEventListener('pointerdown', onOutsidePointerDown, true)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('blur', onClose)
  window.addEventListener('resize', onClose)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', onOutsidePointerDown, true)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('blur', onClose)
  window.removeEventListener('resize', onClose)
})

watch(() => [props.x, props.y], () => {
  adjustedPos.value = { x: props.x, y: props.y }
  requestAnimationFrame(adjustPosition)
})

function onOutsidePointerDown(e: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    onClose()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  }
}

function onClose() {
  emit('close')
}

function onSelect(item: MenuItem) {
  if (item.disabled || item.type === 'separator') return
  if (item.key) emit('select', item.key)
  onClose()
}
</script>

<template>
  <div
    ref="rootRef"
    class="context-menu"
    :style="{ left: adjustedPos.x + 'px', top: adjustedPos.y + 'px' }"
    @pointerdown.stop
    @click.stop
  >
    <template v-for="(item, i) in items" :key="i">
      <div v-if="item.type === 'separator'" class="sep"></div>
      <button
        v-else
        class="menu-item"
        :class="{ danger: item.danger, disabled: item.disabled }"
        :disabled="item.disabled"
        @click="onSelect(item)"
      >
        <component v-if="item.icon" :is="item.icon" :size="14" class="icon" />
        <span v-else class="icon-placeholder"></span>
        <span class="label">{{ item.label }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  max-width: 240px;
  padding: 4px;
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  box-shadow: var(--shadow-lg);
  user-select: none;
}
.sep {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-button);
  font-size: 12px;
  color: var(--popover-foreground);
  text-align: left;
}
.menu-item:hover:not(.disabled):not(:disabled) {
  background: var(--accent);
}
.menu-item.danger {
  color: var(--destructive);
}
.menu-item.danger:hover:not(.disabled):not(:disabled) {
  background: var(--destructive);
  color: var(--destructive-foreground);
}
.menu-item.disabled,
.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.icon {
  flex-shrink: 0;
  color: var(--muted-foreground);
}
.menu-item.danger .icon {
  color: var(--destructive);
}
.icon-placeholder {
  width: 14px;
  flex-shrink: 0;
}
.label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
