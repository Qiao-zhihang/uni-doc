<script setup lang="ts">
/**
 * 编辑器标签栏(改造版)
 * 参考 UI 改造方案 §3.2.C 和设计稿 editor-light.html
 * 32px 高,显示所有 openTabs,支持切换/关闭/新建/右键
 */
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import ContextMenu, { type MenuItem } from '@/components/common/ContextMenu.vue'

const doc = useDocumentStore()

const menu = ref<{ visible: boolean; x: number; y: number; tabId: string | null }>({
  visible: false,
  x: 0,
  y: 0,
  tabId: null
})

const tabs = computed(() => doc.openTabs)
const activeTabId = computed(() => doc.activeTabId)

function tabTitle(path: string | null, title: string): string {
  if (path) {
    return path.split('/').pop()?.replace(/\.md$/i, '') ?? title
  }
  return title
}

function switchTo(id: string) {
  doc.switchTab(id)
}

// 已启用热保存,关闭 tab 无需 confirm
function closeTab(id: string) {
  doc.closeTab(id)
}

function onContextmenu(e: MouseEvent, id: string) {
  e.preventDefault()
  e.stopPropagation()
  menu.value = { visible: true, x: e.clientX, y: e.clientY, tabId: id }
}

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    { key: 'close', label: '关闭' },
    { key: 'close-others', label: '关闭其他' },
    { key: 'close-right', label: '关闭右侧' },
    { key: 'close-all', label: '关闭所有' }
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
</script>

<template>
  <div class="tab-bar no-scrollbar">
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="tab"
      :class="{ 'is-active': tab.id === activeTabId }"
      @click="switchTo(tab.id)"
      @contextmenu="onContextmenu($event, tab.id)"
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
  user-select: none;
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
  transition: background 0.12s ease, color 0.12s ease;
  flex-shrink: 0;
}
.tab:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.tab.is-active {
  color: var(--foreground);
  border-bottom-color: var(--brand-500);
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
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
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
