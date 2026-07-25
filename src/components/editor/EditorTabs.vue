<script setup lang="ts">
/**
 * 编辑器标签栏(改造版)
 * 参考 UI 改造方案 §3.2.C 和设计稿 editor-light.html
 * 32px 高,显示所有 openTabs,支持切换/关闭/新建/右键/拖拽排序
 * 拖拽使用纯鼠标事件实现,避免 Tauri WebView2 对 HTML5 DnD 的兼容性问题
 * 支持丝滑动画:非拖拽元素用 transform+transition 让位,拖拽元素实时跟随鼠标
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import ContextMenu, { type MenuItem } from '@/components/common/ContextMenu.vue'

const doc = useDocumentStore()

const menu = ref<{ visible: boolean; x: number; y: number; tabId: string | null }>({
  visible: false,
  x: 0,
  y: 0,
  tabId: null,
})

const dragState = ref<{
  isDragging: boolean
  draggingId: string | null
  draggingIndex: number
  overIndex: number | null
  startX: number
  startY: number
  currentX: number
  currentY: number
  originLeft: number
  justDragged: boolean
}>({
  isDragging: false,
  draggingId: null,
  draggingIndex: -1,
  overIndex: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  originLeft: 0,
  justDragged: false,
})

const tabWidths = ref<Map<string, number>>(new Map())

const tabBarRef = ref<HTMLElement | null>(null)
const tabRefs = ref<Map<string, HTMLElement>>(new Map())

const tabs = computed(() => doc.openTabs)
const activeTabId = computed(() => doc.activeTabId)

const DRAG_THRESHOLD = 5

function setTabRef(id: string, el: HTMLElement | null) {
  if (el) {
    tabRefs.value.set(id, el)
  } else {
    tabRefs.value.delete(id)
  }
}

function tabTitle(path: string | null, title: string): string {
  if (path) {
    return path.split('/').pop()?.replace(/\.md$/i, '') ?? title
  }
  return title
}

function switchTo(id: string) {
  if (dragState.value.justDragged) {
    dragState.value.justDragged = false
    return
  }
  doc.switchTab(id)
}

function closeTab(id: string) {
  doc.closeTab(id)
}

function onContextmenu(e: MouseEvent, id: string) {
  if (dragState.value.isDragging) return
  e.preventDefault()
  e.stopPropagation()
  menu.value = { visible: true, x: e.clientX, y: e.clientY, tabId: id }
}

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    { key: 'close', label: '关闭' },
    { key: 'close-others', label: '关闭其他' },
    { key: 'close-right', label: '关闭右侧' },
    { key: 'close-all', label: '关闭所有' },
  ]
  return items
})

function onMenuSelect(key: string) {
  const id = menu.value.tabId
  if (!id) return
  switch (key) {
    case 'close':
      closeTab(id)
      break
    case 'close-others':
      doc.closeOtherTabs(id)
      break
    case 'close-right':
      doc.closeTabsToRight(id)
      break
    case 'close-all':
      doc.closeAllTabs()
      break
  }
  menu.value.visible = false
}

function closeMenu() {
  menu.value.visible = false
}

function findTabIndexAt(x: number): number {
  let insertIndex = tabs.value.length
  for (let i = 0; i < tabs.value.length; i++) {
    const tab = tabs.value[i]
    if (tab.id === dragState.value.draggingId) continue
    const el = tabRefs.value.get(tab.id)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    const midpoint = rect.left + rect.width / 2
    if (x < midpoint) {
      insertIndex = i
      break
    }
  }
  return insertIndex
}

function getTabOffset(index: number): number {
  const ds = dragState.value
  if (!ds.isDragging || ds.overIndex === null || ds.draggingIndex < 0) return 0
  if (index === ds.draggingIndex) return 0

  const draggingWidth = tabWidths.value.get(ds.draggingId ?? '') ?? 0
  const from = ds.draggingIndex
  const to = ds.overIndex

  if (from < to) {
    if (index > from && index <= to) {
      return -draggingWidth
    }
  } else if (from > to) {
    if (index >= to && index < from) {
      return draggingWidth
    }
  }
  return 0
}

function getTabStyle(tabId: string, index: number) {
  const ds = dragState.value
  if (!ds.isDragging) return {}

  if (tabId === ds.draggingId) {
    const offsetX = ds.currentX - ds.startX
    return {
      position: 'relative' as const,
      zIndex: 10,
      transform: `translateX(${offsetX}px) scale(1.02)`,
      transition: 'transform 0s',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }
  }

  const offset = getTabOffset(index)
  if (offset === 0) return {}
  return {
    transform: `translateX(${offset}px)`,
    transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
  }
}

function onMouseDown(e: MouseEvent, id: string) {
  if (e.button !== 0) return
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx < 0) return

  tabWidths.value.clear()
  for (const t of tabs.value) {
    const el = tabRefs.value.get(t.id)
    if (el) {
      tabWidths.value.set(t.id, el.getBoundingClientRect().width)
    }
  }

  const draggingEl = tabRefs.value.get(id)
  const originLeft = draggingEl ? draggingEl.getBoundingClientRect().left : 0

  dragState.value.draggingId = id
  dragState.value.draggingIndex = idx
  dragState.value.startX = e.clientX
  dragState.value.startY = e.clientY
  dragState.value.currentX = e.clientX
  dragState.value.currentY = e.clientY
  dragState.value.originLeft = originLeft
  dragState.value.isDragging = false
  dragState.value.overIndex = null
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  const dx = e.clientX - dragState.value.startX
  const dy = e.clientY - dragState.value.startY

  dragState.value.currentX = e.clientX
  dragState.value.currentY = e.clientY

  if (!dragState.value.isDragging) {
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      dragState.value.isDragging = true
    } else {
      return
    }
  }

  const overIdx = findTabIndexAt(e.clientX)
  dragState.value.overIndex = overIdx
}

function onMouseUp() {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)

  if (dragState.value.isDragging && dragState.value.draggingId && dragState.value.overIndex !== null) {
    doc.moveTab(dragState.value.draggingId, dragState.value.overIndex)
    dragState.value.justDragged = true
    setTimeout(() => {
      dragState.value.justDragged = false
    }, 0)
  }

  dragState.value.isDragging = false
  dragState.value.draggingId = null
  dragState.value.draggingIndex = -1
  dragState.value.overIndex = null
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div ref="tabBarRef" class="tab-bar no-scrollbar">
    <div
      v-for="(tab, index) in tabs"
      :key="tab.id"
      :ref="(el) => setTabRef(tab.id, el as HTMLElement | null)"
      class="tab"
      :class="{
        'is-active': tab.id === activeTabId,
        'is-dragging': tab.id === dragState.draggingId && dragState.isDragging,
      }"
      :style="getTabStyle(tab.id, index)"
      @click="switchTo(tab.id)"
      @contextmenu="onContextmenu($event, tab.id)"
      @mousedown="onMouseDown($event, tab.id)"
    >
      <span class="tab-dot" :class="tab.savedStatus"></span>
      <span class="tab-title truncate">{{ tabTitle(tab.path, tab.meta.title) }}</span>
      <span class="tab-ext">.md</span>
      <button class="tab-close" title="关闭" @click.stop="closeTab(tab.id)">
        <X :size="12" />
      </button>
    </div>

    <ContextMenu
      v-if="menu.visible"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onMenuSelect"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: stretch;
  height: var(--tabbar-height);
  padding: 0 8px;
  background: var(--background);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 10px;
  border-radius: var(--radius-button) var(--radius-button) 0 0;
  font-size: 12px;
  color: var(--muted-foreground);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    opacity 0.15s ease,
    box-shadow 0.2s ease;
  flex-shrink: 0;
  position: relative;
  user-select: none;
  will-change: transform;
}
.tab:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.tab.is-active {
  color: var(--foreground);
  border-bottom-color: var(--brand-500);
}
.tab.is-dragging {
  cursor: grabbing;
}
.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted-foreground);
  flex-shrink: 0;
}
.tab-dot.saved {
  background: var(--state-success);
}
.tab-dot.unsaved {
  background: #f59e0b;
}
.tab-dot.saving {
  background: var(--brand-500);
  animation: tab-dot-pulse 1s ease-in-out infinite;
}
@keyframes tab-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
.tab-title {
  max-width: 140px;
}
.tab-ext {
  font-size: 11px;
  color: var(--muted-foreground);
}
.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-tag);
  color: var(--muted-foreground);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.tab:hover .tab-close,
.tab.is-active .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
