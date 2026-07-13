<script setup lang="ts">
/**
 * 设置页
 * 参考 PRD §4.4(深色/浅色主题)和设计稿设置页面
 * M1 提供:主题切换、关于信息、快捷键说明
 * M3 将补充 AI 配置面板
 */
import { onMounted, ref } from 'vue'
import { ArrowLeft, Sun, Moon, Info, Keyboard, Code, Eye, EyeOff, Sparkles, Loader2 } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import { useRouter } from 'vue-router'

const theme = useThemeStore()
const settings = useSettingsStore()
const router = useRouter()

function backToEditor() {
  router.push('/editor')
}

// AI 配置
type ProviderKey = 'openai' | 'deepseek' | 'qwen' | 'zhipu' | 'ollama' | 'custom'
const showApiKey = ref(false)
const testing = ref(false)
const toast = ref<{ type: 'success' | 'error'; msg: string } | null>(null)

function onProviderChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value as ProviderKey
  settings.applyPreset(value)
}

async function testConnection() {
  testing.value = true
  try {
    const r = await settings.testConnection()
    toast.value = { type: r.ok ? 'success' : 'error', msg: r.message }
  } catch (e) {
    toast.value = { type: 'error', msg: (e as Error).message }
  } finally {
    testing.value = false
    setTimeout(() => { toast.value = null }, 3000)
  }
}

onMounted(() => {
  settings.load()
})

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

      <!-- AI 配置 -->
      <section class="card">
        <div class="card-header">
          <Sparkles :size="18" class="card-icon" />
          <h2 class="card-title">AI 配置</h2>
        </div>
        <p class="card-desc">配置 AI 服务商、密钥与模型参数,修改后自动保存到本地。</p>

        <div class="form-row">
          <label class="form-label">服务商</label>
          <select
            class="form-select"
            :value="settings.provider"
            @change="onProviderChange"
          >
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="qwen">通义千问</option>
            <option value="zhipu">智谱清言</option>
            <option value="ollama">Ollama (本地)</option>
            <option value="custom">自定义</option>
          </select>
          <span class="form-hint">选择预设将自动填入地址与模型</span>
        </div>

        <div class="form-row">
          <label class="form-label">API Key</label>
          <div class="password-wrapper">
            <input
              :type="showApiKey ? 'text' : 'password'"
              v-model="settings.apiKey"
              @input="settings.save()"
              class="form-input"
              placeholder="sk-..."
            />
            <button
              type="button"
              class="toggle-btn"
              :title="showApiKey ? '隐藏' : '显示'"
              @click="showApiKey = !showApiKey"
            >
              <Eye v-if="!showApiKey" :size="16" />
              <EyeOff v-else :size="16" />
            </button>
          </div>
          <span class="form-hint">仅保存在本地,用于请求鉴权</span>
        </div>

        <div class="form-row">
          <label class="form-label">API URL</label>
          <input
            type="text"
            v-model="settings.apiUrl"
            @input="settings.save()"
            class="form-input"
            placeholder="https://api.example.com/v1"
          />
          <span class="form-hint">OpenAI 兼容接口地址</span>
        </div>

        <div class="form-row">
          <label class="form-label">模型</label>
          <input
            type="text"
            v-model="settings.model"
            @input="settings.save()"
            class="form-input"
            placeholder="gpt-4o-mini"
          />
          <span class="form-hint">模型标识符</span>
        </div>

        <div class="form-row">
          <label class="form-label">温度</label>
          <div class="slider-wrapper">
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              v-model.number="settings.temperature"
              @input="settings.save()"
              class="form-slider"
            />
            <span class="slider-value">{{ settings.temperature.toFixed(1) }}</span>
          </div>
          <span class="form-hint">越高越发散,越低越稳定</span>
        </div>

        <div class="form-row">
          <label class="form-label">最大 Tokens</label>
          <input
            type="number"
            min="100"
            max="32768"
            v-model.number="settings.maxTokens"
            @change="settings.save()"
            class="form-input"
          />
          <span class="form-hint">单次回复长度上限</span>
        </div>

        <div class="form-actions">
          <button class="test-btn" :disabled="testing" @click="testConnection">
            <Loader2 v-if="testing" :size="14" class="spin" />
            <span>{{ testing ? '测试中...' : '测试连接' }}</span>
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

    <div v-if="toast" class="toast" :class="toast.type">
      {{ toast.msg }}
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
.form-row {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 6px 12px;
  align-items: center;
  margin-bottom: 14px;
}
.form-label {
  font-size: 13px;
  color: var(--muted-foreground);
}
.form-input,
.form-select {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--foreground);
  background: var(--secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.form-input:focus,
.form-select:focus {
  border-color: var(--primary);
}
.form-hint {
  grid-column: 2;
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.4;
}
.password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.password-wrapper .form-input {
  padding-right: 36px;
}
.toggle-btn {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--muted-foreground);
}
.toggle-btn:hover {
  color: var(--foreground);
  background: var(--muted);
}
.slider-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
}
.form-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border);
  border-radius: 2px;
  outline: none;
}
.form-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
}
.form-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
}
.slider-value {
  min-width: 32px;
  text-align: right;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--foreground);
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
.test-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  background: var(--primary);
  color: var(--primary-foreground);
  transition: opacity 0.15s;
}
.test-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.test-btn:not(:disabled):hover {
  opacity: 0.9;
}
.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 100;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  color: #fff;
  box-shadow: var(--shadow-sm);
  max-width: 320px;
  word-break: break-word;
}
.toast.success {
  background: #16a34a;
}
.toast.error {
  background: #dc2626;
}
</style>
