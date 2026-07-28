<script setup lang="ts">
/**
 * Ribbon 最左侧图标栏
 * 参考 UI 改造方案 §3.2.A 和设计稿 editor-light.html
 * 48px 宽,顶部功能切换 + 底部系统操作
 */
import { computed } from 'vue'
import { FileText, Search, List, Bell, Sun, Moon, Settings } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useThemeStore } from '@/stores/theme'
import { useRouter } from 'vue-router'
import AiIconUrl from '@/assets/UUshark/icon.svg'

const editor = useEditorStore()
const theme = useThemeStore()
const router = useRouter()

const isDark = computed(() => theme.mode === 'dark')

function goToSettings() {
  router.push('/settings')
}
function goToReminders() {
  router.push('/reminders')
}
</script>

<template>
  <aside class="ribbon">
    <!-- 顶部功能 -->
    <div class="top">
      <button
        class="ribbon-btn"
        :class="{ 'is-active': editor.fileExplorerOpen }"
        title="文件浏览器 (Ctrl+\\)"
        @click="editor.toggleFileExplorer()"
      >
        <FileText :size="20" />
      </button>
      <button class="ribbon-btn" title="搜索 (Ctrl+P)" @click="">
        <Search :size="20" />
      </button>
      <button
        class="ribbon-btn"
        :class="{ 'is-active': editor.outlinePanelOpen }"
        title="大纲 (Ctrl+Shift+\)"
        @click="editor.toggleOutlinePanel()"
      >
        <List :size="20" />
      </button>
      <button
        class="ribbon-btn"
        title="提醒"
        @click="goToReminders()"
      >
        <Bell :size="20" />
      </button>
    </div>

    <!-- 底部系统 -->
    <div class="bottom">
      <button
        class="ribbon-btn"
        :class="{ 'is-active': editor.aiFloatingState !== 'closed' }"
        title="AI 助手 (Ctrl+K)"
        @click="editor.toggleAiFloating()"
      >
        <img :src="AiIconUrl" class="ai-btn-icon" alt="UU鲨" />
      </button>
      <button class="ribbon-btn" :title="isDark ? '切换浅色' : '切换深色'" @click="theme.toggle()">
        <Moon v-if="!isDark" :size="20" />
        <Sun v-else :size="20" />
      </button>
      <button class="ribbon-btn" title="设置" @click="goToSettings">
        <Settings :size="20" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.ribbon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: var(--ribbon-width);
  flex-shrink: 0;
  padding: 10px 0;
  background: var(--sidebar);
  border-right: 1px solid var(--sidebar-border);
  z-index: 10;
}
.top,
.bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.ribbon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--muted-foreground);
  transition:
    background var(--transition-base),
    color var(--transition-base),
    transform var(--transition-fast),
    box-shadow var(--transition-base);
}
.ribbon-btn:hover {
  background: var(--sidebar-accent);
  color: var(--sidebar-foreground);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
}
.ribbon-btn:active {
  transform: scale(0.94);
}
.ribbon-btn.is-active {
  color: var(--brand-500);
  background: var(--brand-50);
}
.dark .ribbon-btn.is-active {
  background: rgba(79, 157, 255, 0.15);
}
.ai-btn-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  pointer-events: none;
}
</style>
