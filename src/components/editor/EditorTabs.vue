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
  isSettling: boolean
  draggingId: string | null
  draggingIndex: number
  overIndex: number | null
  startX: number
  startY: number
  currentX: number
  currentY: number
  originLeft: number
  justDragged: boolean
  settleTargetOffset: number
}>({
  isDragging: false,
  isSettling: false,
  draggingId: null,
  draggingIndex: -1,
  overIndex: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  originLeft: 0,
  justDragged: false,
  settleTargetOffset: 0,
})

const tabWidths = ref<Map<string, number>>(new Map())
const tabInitialLefts = ref<Map<string, number>>(new Map())

const tabBarRef = ref<HTMLElement | null>(null)
const tabRefs = ref<Map<string, HTMLElement>>(new Map())

let settleTimer: ReturnType<typeof setTimeout> | null = null
let justDraggedTimer: ReturnType<typeof setTimeout> | null = null

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
  const barRect = tabBarRef.value?.getBoundingClientRect()
  const scrollLeft = tabBarRef.value?.scrollLeft ?? 0
  const relX = barRect ? x - barRect.left + scrollLeft : x
  let insertIndex = tabs.value.length
  for (let i = 0; i < tabs.value.length; i++) {
    const tab = tabs.value[i]
    if (tab.id === dragState.value.draggingId) continue
    const left = tabInitialLefts.value.get(tab.id)
    const width = tabWidths.value.get(tab.id)
    if (left === undefined || width === undefined) continue
    const threshold = left + width / 2
    if (relX < threshold) {
      insertIndex = i
      break
    }
  }
  return insertIndex
}

function getTabOffset(index: number): number {
  const ds = dragState.value
  if ((!ds.isDragging && !ds.isSettling) || ds.overIndex === null || ds.draggingIndex < 0) return 0
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
  if (!ds.isDragging && !ds.isSettling) return {}

  if (tabId === ds.draggingId) {
    if (ds.isSettling) {
      return {
        position: 'relative' as const,
        zIndex: 10,
        transform: `translateX(${ds.settleTargetOffset}px)`,
        transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s ease',
        boxShadow: 'none',
      }
    }
    const offsetX = ds.currentX - ds.startX
    return {
      position: 'relative' as const,
      zIndex: 10,
      transform: `translateX(${offsetX}px) scale(1.02)`,
      transition: 'transform 0s, box-shadow 0.15s ease',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }
  }

  const offset = getTabOffset(index)
  if (offset === 0) return {}
  return {
    transform: `translateX(${offset}px)`,
    transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
  }
}

function onMouseDown(e: MouseEvent, id: string) {
  if (e.button !== 0) return
  if (dragState.value.isSettling) return
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx < 0) return

  const barRect = tabBarRef.value?.getBoundingClientRect()
  const scrollLeft = tabBarRef.value?.scrollLeft ?? 0

  tabWidths.value.clear()
  tabInitialLefts.value.clear()
  for (const t of tabs.value) {
    const el = tabRefs.value.get(t.id)
    if (el) {
      const rect = el.getBoundingClientRect()
      tabWidths.value.set(t.id, rect.width)
      tabInitialLefts.value.set(t.id, barRect ? rect.left - barRect.left + scrollLeft : rect.left)
    }
  }

  const draggingEl = tabRefs.value.get(id)
  const originLeft = draggingEl
    ? barRect
      ? draggingEl.getBoundingClientRect().left - barRect.left + scrollLeft
      : draggingEl.getBoundingClientRect().left
    : 0

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
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    } else {
      return
    }
  }

  e.preventDefault()
  const overIdx = findTabIndexAt(e.clientX)
  dragState.value.overIndex = overIdx
}

function onMouseUp() {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)

  const ds = dragState.value
  const draggingTabStillExists = ds.draggingId
    ? tabs.value.some((t) => t.id === ds.draggingId)
    : false

  if (
    ds.isDragging &&
    draggingTabStillExists &&
    ds.overIndex !== null &&
    ds.overIndex !== ds.draggingIndex
  ) {
    const from = ds.draggingIndex
    const to = ds.overIndex
    const tabCount = tabs.value.length

    let targetOffset = 0
    if (from < to) {
      for (let i = from + 1; i <= to && i < tabCount; i++) {
        const tab = tabs.value[i]
        if (tab) targetOffset += tabWidths.value.get(tab.id) ?? 0
      }
    } else if (from > to) {
      for (let i = to; i < from && i < tabCount; i++) {
        const tab = tabs.value[i]
        if (tab) targetOffset -= tabWidths.value.get(tab.id) ?? 0
      }
    }

    ds.isSettling = true
    ds.isDragging = false
    ds.settleTargetOffset = targetOffset

    const movedId = ds.draggingId
    const movedTo = to
    settleTimer = setTimeout(() => {
      const stillExists = movedId ? tabs.value.some((t) => t.id === movedId) : false
      if (stillExists) {
        doc.moveTab(movedId, movedTo)
        dragState.value.justDragged = true
        justDraggedTimer = setTimeout(() => {
          dragState.value.justDragged = false
        }, 0)
      }
      dragState.value.isSettling = false
      dragState.value.draggingId = null
      dragState.value.draggingIndex = -1
      dragState.value.overIndex = null
      dragState.value.settleTargetOffset = 0
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      settleTimer = null
    }, 200)
    return
  }

  ds.isDragging = false
  ds.draggingId = null
  ds.draggingIndex = -1
  ds.overIndex = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  if (justDraggedTimer) {
    clearTimeout(justDraggedTimer)
    justDraggedTimer = null
  }
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
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
  align-items: flex-end;
  height: var(--tabbar-height);
  padding: 0 8px 0 8px;
  background: var(--sidebar);
  border-bottom: 1px solid var(--sidebar-border);
  overflow-x: auto;
  overflow-y: hidden;
  gap: 2px;
  z-index: 5;
  flex-shrink: 0;
  min-width: 0;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: calc(100% - 4px);
  flex: 0 0 160px;
  min-width: 120px;
  max-width: 200px;
  padding: 0 10px 0 12px;
  border-radius: 10px 10px 0 0;
  font-size: 12.5px;
  color: var(--text-700);
  background: var(--background-200);
  cursor: pointer;
  position: relative;
  user-select: none;
}
.dark .tab {
  color: var(--muted-foreground);
  background: var(--background-100);
}
.dark .tab:hover {
  background: var(--background-200);
}
.dark .tab.is-active {
  background: var(--background-300);
}
.tab::after {
  content: '';
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 16px;
  background: var(--glass-border);
}
.tab:last-child::after,
.tab:hover::after,
.tab.is-active::after {
  display: none;
}
.tab:hover {
  background: var(--sidebar-accent);
  color: var(--foreground);
}
.tab.is-active {
  color: var(--foreground);
  background: var(--card);
}
.dark .tab.is-active {
  background: var(--background-300);
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
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-ext {
  font-size: 11px;
  color: var(--muted-foreground);
  flex-shrink: 0;
}
.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-tag);
  color: var(--muted-foreground);
  opacity: 0;
  transition: all var(--transition-fast);
  flex-shrink: 0;
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
