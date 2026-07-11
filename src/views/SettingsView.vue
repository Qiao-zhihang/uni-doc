<script setup lang="ts">
/**
 * 设置页
 * 参考 PRD §4.4(深色/浅色主题)和设计稿设置页面
 * M1 提供:主题切换、关于信息、快捷键说明
 * M3 将补充 AI 配置面板
 */
import { ArrowLeft, Sun, Moon, Info, Keyboard, Code } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import { useRouter } from 'vue-router'

const theme = useThemeStore()
const router = useRouter()

function backToEditor() {
  router.push('/editor')
}

const shortcuts = [
  { keys: 'Ctrl+Z', desc: '撤销' },
  { keys: 'Ctrl+Shift+Z', desc: '重做' },
  { keys: 'Ctrl+S', desc: '保存为 .md' },
  { keys: 'Ctrl+K', desc: '唤起 AI 指令栏' },
  { keys: 'Enter', desc: '新建同类型区块' },
  { keys: 'Backspace', desc: '删除空区块' }
]

const markdownSyntax = [
  { syntax: '**粗体**', desc: '粗体文本' },
  { syntax: '*斜体*', desc: '斜体文本' },
  { syntax: '~~删除线~~', desc: '删除线文本' },
  { syntax: '`代码`', desc: '行内代码' },
  { syntax: '<u>下划线</u>', desc: '下划线文本' }
]
</script>

<template>
  <main class="settings-layout">
    <header class="settings-header">
      <button class="back-btn" @click="backToEditor">
        <ArrowLeft :size="16" />
        <span>返回编辑器</span>
      </button>
      <h1 class="settings-title">设置</h1>
    </header>

    <div class="settings-body no-scrollbar">
      <!-- 主题设置 -->
      <section class="card">
        <div class="card-header">
          <Sun v-if="theme.mode === 'light'" :size="18" class="card-icon" />
          <Moon v-else :size="18" class="card-icon" />
          <h2 class="card-title">外观主题</h2>
        </div>
        <p class="card-desc">切换深色或浅色主题,偏好将保存到本地。</p>
        <div class="theme-options">
          <button
            class="theme-option"
            :class="{ active: theme.mode === 'light' }"
            @click="theme.setMode('light')"
          >
            <Sun :size="16" />
            <span>浅色</span>
          </button>
          <button
            class="theme-option"
            :class="{ active: theme.mode === 'dark' }"
            @click="theme.setMode('dark')"
          >
            <Moon :size="16" />
            <span>深色</span>
          </button>
        </div>
      </section>

      <!-- Markdown 语法 -->
      <section class="card">
        <div class="card-header">
          <Code :size="18" class="card-icon" />
          <h2 class="card-title">Markdown 语法</h2>
        </div>
        <p class="card-desc">在编辑器中直接输入以下语法，自动转换为格式化文本。</p>
        <div class="markdown-list">
          <div v-for="m in markdownSyntax" :key="m.syntax" class="markdown-item">
            <code>{{ m.syntax }}</code>
            <span class="markdown-arrow">→</span>
            <span class="markdown-desc">{{ m.desc }}</span>
          </div>
        </div>
      </section>

      <!-- 快捷键 -->
      <section class="card">
        <div class="card-header">
          <Keyboard :size="18" class="card-icon" />
          <h2 class="card-title">快捷键</h2>
        </div>
        <div class="shortcut-list">
          <div v-for="s in shortcuts" :key="s.keys" class="shortcut-item">
            <span class="shortcut-desc">{{ s.desc }}</span>
            <kbd>{{ s.keys }}</kbd>
          </div>
        </div>
      </section>

      <!-- 关于 -->
      <section class="card">
        <div class="card-header">
          <Info :size="18" class="card-icon" />
          <h2 class="card-title">关于 UniDoc</h2>
        </div>
        <div class="about-grid">
          <div class="about-row">
            <span class="about-label">版本</span>
            <span class="about-value">Milestone 1 (0.1.0)</span>
          </div>
          <div class="about-row">
            <span class="about-label">技术栈</span>
            <span class="about-value">Vite + Vue 3 + TypeScript + Pinia</span>
          </div>
          <div class="about-row">
            <span class="about-label">文件格式</span>
            <span class="about-value">.md (Markdown)</span>
          </div>
          <div class="about-row">
            <span class="about-label">Tauri 后端</span>
            <span class="about-value pending">待集成(需安装 Rust)</span>
          </div>
          <div class="about-row">
            <span class="about-label">AI 配置</span>
            <span class="about-value pending">M3 里程碑实现</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.settings-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--muted);
}
.settings-header {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  flex-shrink: 0;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--muted-foreground);
}
.back-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.settings-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--foreground);
}
.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.card {
  width: 100%;
  max-width: 640px;
  padding: 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.card-icon {
  color: var(--primary);
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
}
.card-desc {
  font-size: 13px;
  color: var(--muted-foreground);
  margin-bottom: 16px;
  line-height: 1.6;
}
.theme-options {
  display: flex;
  gap: 12px;
}
.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 20px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  background: var(--secondary);
  color: var(--foreground);
  border: 2px solid transparent;
}
.theme-option.active {
  background: var(--primary);
  color: var(--primary-foreground);
}
.theme-option:not(.active):hover {
  background: var(--muted);
}
.markdown-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.markdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.markdown-item code {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 6px;
  background: var(--secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--foreground);
}
.markdown-arrow {
  color: var(--muted-foreground);
}
.markdown-desc {
  color: var(--foreground);
}
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}
.shortcut-desc {
  color: var(--foreground);
}
kbd {
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--foreground);
  background: var(--secondary);
  border: 1px solid var(--border);
  border-radius: 5px;
}
.about-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.about-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.about-label {
  color: var(--muted-foreground);
}
.about-value {
  color: var(--foreground);
}
.about-value.pending {
  color: var(--chart-3);
}
</style>
