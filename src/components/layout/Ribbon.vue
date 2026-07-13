<script setup lang="ts">
/**
 * Ribbon 最左侧图标栏
 * 参考 UI 改造方案 §3.2.A 和设计稿 editor-light.html
 * 48px 宽,顶部功能切换 + 底部系统操作
 */
import { computed } from 'vue'
import {
  FileText,
  Search,
  List,
  Sun,
  Moon,
  Settings
} from 'lucide-vue-next'
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
      <button
        class="ribbon-btn"
        title="搜索 (Ctrl+P)"
        @click=""
      >
        <Search :size="20" />
      </button>
      <button
        class="ribbon-btn"
        :class="{ 'is-active': editor.outlinePanelOpen }"
        title="大纲 (Ctrl+Shift+\\)"
        @click="editor.toggleOutlinePanel()"
      >
        <List :size="20" />
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
      <button
        class="ribbon-btn"
        :title="isDark ? '切换浅色' : '切换深色'"
        @click="theme.toggle()"
      >
        <Moon v-if="!isDark" :size="20" />
        <Sun v-else :size="20" />
      </button>
      <button
        class="ribbon-btn"
        title="设置"
        @click="goToSettings"
      >
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
  padding: 8px 0;
  background: var(--sidebar);
  border-right: 1px solid var(--sidebar-border);
}
.top,
.bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.ribbon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-button);
  color: var(--muted-foreground);
  transition: background 0.15s ease, color 0.15s ease;
}
.ribbon-btn:hover {
  background: var(--sidebar-accent);
  color: var(--sidebar-foreground);
}
.ribbon-btn.is-active {
  color: var(--brand-500);
}
.ribbon-btn.is-active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 18px;
  border-radius: 1px;
  background: var(--brand-500);
}
.ai-btn-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  pointer-events: none;
}
</style>
