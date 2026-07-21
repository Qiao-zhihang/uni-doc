<script setup lang="ts">
/**
 * 设置页
 * 参考 PRD §4.4(深色/浅色主题)和设计稿设置页面
 * M1 提供:主题切换、关于信息、快捷键说明
 * M3 将补充 AI 配置面板
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowLeft, Sun, Moon, Info, Keyboard, Code, Eye, EyeOff, Sparkles, Loader2, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore, type ApiProfile, type ProviderPreset } from '@/stores/settings'
import { useRouter } from 'vue-router'
import type { ModelConfig } from '@/ai/types'

const theme = useThemeStore()
const settings = useSettingsStore()
const router = useRouter()

function backToEditor() {
  router.push('/editor')
}

// ===== AI 配置:多 Profile 管理 =====
const showApiKey = ref(false)
const testing = ref(false)
const toast = ref<{ type: 'success' | 'error'; msg: string } | null>(null)

// 编辑态草稿(添加/编辑共用)
const editing = ref(false)
const editingId = ref<string | null>(null) // 编辑现有时为该 Profile id;添加时为 null
const draft = reactive<ApiProfile>({
  id: '',
  name: '',
  provider: 'custom',
  apiKey: '',
  apiUrl: '',
  model: '',
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  vision: false,
  webSearch: false,
  nativeSearch: false,
})

// 删除确认浮层
const deleteTargetId = ref<string | null>(null)
const deleteTargetName = computed(
  () => settings.profiles.find((p) => p.id === deleteTargetId.value)?.name ?? ''
)

/** 读取 Profile 存储的探针检测结果 */
function capsFor(p: ApiProfile) {
  return {
    vision: !!p.vision,
    webSearch: !!p.webSearch,
    nativeSearch: !!p.nativeSearch,
  }
}
/** 草稿的能力（编辑时读取已存结果，新建时为空） */
const draftCaps = computed(() => capsFor(draft))

function startAddProfile() {
  editingId.value = null
  Object.assign(draft, {
    id: crypto.randomUUID(),
    name: '',
    provider: 'custom',
    apiKey: '',
    apiUrl: '',
    model: '',
    temperature: 0.7,
    maxTokens: 4096,
    stream: true,
  })
  showApiKey.value = false
  editing.value = true
}

function startEditProfile(id: string) {
  const p = settings.profiles.find((x) => x.id === id)
  if (!p) return
  editingId.value = id
  Object.assign(draft, p)
  showApiKey.value = false
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  editingId.value = null
}

function saveDraft() {
  const profile: ApiProfile = {
    id: draft.id,
    name: draft.name.trim() || '未命名配置',
    provider: draft.provider,
    apiKey: draft.apiKey.trim(),
    apiUrl: draft.apiUrl.trim(),
    model: draft.model.trim(),
    temperature: draft.temperature,
    maxTokens: draft.maxTokens,
    stream: draft.stream !== false,
    vision: draft.vision,
    webSearch: draft.webSearch,
    nativeSearch: draft.nativeSearch,
  }
  if (editingId.value) {
    settings.updateProfile(editingId.value, profile)
  } else {
    settings.addProfile(profile)
  }
  editing.value = false
  editingId.value = null
}

function onProviderChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value as ProviderPreset
  draft.provider = value
  if (value !== 'custom') {
    const presets: Record<Exclude<ProviderPreset, 'custom'>, { apiUrl: string; model: string }> = {
      openai: { apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      deepseek: { apiUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      qwen: { apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      zhipu: { apiUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
      ollama: { apiUrl: 'http://localhost:11434/v1', model: 'llama3' }
    }
    draft.apiUrl = presets[value].apiUrl
    draft.model = presets[value].model
  }
}

function askDelete(id: string) {
  if (settings.profiles.length <= 1) {
    toast.value = { type: 'error', msg: '至少保留一个配置' }
    setTimeout(() => { toast.value = null }, 3000)
    return
  }
  deleteTargetId.value = id
}

function confirmDelete() {
  const id = deleteTargetId.value
  if (id) {
    settings.deleteProfile(id)
    if (editingId.value === id) {
      editing.value = false
      editingId.value = null
    }
    deleteTargetId.value = null
  }
}

function cancelDelete() {
  deleteTargetId.value = null
}

async function testConnection() {
  testing.value = true
  try {
    if (!draft.apiKey.trim() || !draft.apiUrl.trim() || !draft.model.trim()) {
      toast.value = { type: 'error', msg: 'API Key、API URL、模型名 不能为空' }
      return
    }
    const { chat, probeCapabilities } = await import('@/ai/model')
    const config: ModelConfig = {
      apiKey: draft.apiKey.trim(),
      apiUrl: draft.apiUrl.trim(),
      model: draft.model.trim(),
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      provider: draft.provider,
    }
    // 基本连通性测试
    const messages = [{ role: 'user' as const, content: 'ping' }]
    await chat(messages, [], config)
    // 探针检测能力
    const caps = await probeCapabilities(config)
    draft.vision = caps.vision
    draft.webSearch = caps.webSearch
    draft.nativeSearch = caps.nativeSearch
    const tags: string[] = []
    if (caps.vision) tags.push('图片')
    if (caps.nativeSearch) tags.push('原生联网')
    else if (caps.webSearch) tags.push('工具联网')
    const errs: string[] = []
    if (!caps.vision && caps.visionError) errs.push(`图片: ${caps.visionError.slice(0, 60)}`)
    if (!caps.webSearch && !caps.nativeSearch && caps.webSearchError) errs.push(`联网: ${caps.webSearchError.slice(0, 60)}`)
    if (!caps.nativeSearch && caps.nativeSearchError) errs.push(`原生联网: ${caps.nativeSearchError.slice(0, 60)}`)
    const note = errs.length ? ` [检测失败: ${errs.join(' | ')}]` : ''
    toast.value = { type: 'success', msg: `连接成功${tags.length ? '（支持: ' + tags.join('、') + '）' : ''}${note}` }
  } catch (e) {
    toast.value = { type: 'error', msg: (e as Error).message }
  } finally {
    testing.value = false
    setTimeout(() => { toast.value = null }, 5000)
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
        <p class="card-desc">管理多个 AI 服务配置,点击列表项切换激活配置,修改后自动保存到本地。</p>

        <!-- Profile 列表 -->
        <div class="profile-list">
          <div
            v-for="p in settings.profiles"
            :key="p.id"
            class="profile-item"
            :class="{ active: p.id === settings.activeProfileId, editing: editingId === p.id }"
          >
            <div class="profile-info" @click="settings.setActiveProfile(p.id)">
              <div class="profile-name-row">
                <span class="profile-name">{{ p.name }}</span>
                <span v-if="p.id === settings.activeProfileId" class="profile-active-badge">已激活</span>
              </div>
              <div class="profile-meta">
                <span class="profile-model">{{ p.model || '未设置模型' }}</span>
                <span class="profile-tags">
                  <span class="cap-tag" :class="capsFor(p).webSearch ? 'on' : 'off'">
                    联网 {{ capsFor(p).webSearch ? '✓' : '✗' }}
                  </span>
                  <span class="cap-tag" :class="capsFor(p).vision ? 'on' : 'off'">
                    图片 {{ capsFor(p).vision ? '✓' : '✗' }}
                  </span>
                </span>
              </div>
            </div>
            <div class="profile-actions">
              <button class="profile-btn edit" title="编辑" @click="startEditProfile(p.id)">
                <Pencil :size="14" />
              </button>
              <button
                class="profile-btn delete"
                title="删除"
                :disabled="settings.profiles.length <= 1"
                @click="askDelete(p.id)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
        </div>

        <!-- 添加配置按钮 -->
        <button v-if="!editing" class="btn-add-profile" @click="startAddProfile">
          <Plus :size="14" />
          <span>添加配置</span>
        </button>

        <!-- 编辑表单 -->
        <div v-if="editing" class="edit-form">
          <div class="edit-form-title">{{ editingId ? '编辑配置' : '新增配置' }}</div>

          <div class="form-row">
            <label class="form-label">名称</label>
            <input type="text" v-model="draft.name" class="form-input" placeholder="例如:我的 OpenAI" />
          </div>

          <div class="form-row">
            <label class="form-label">服务商</label>
            <select class="form-select" :value="draft.provider" @change="onProviderChange">
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">通义千问</option>
              <option value="zhipu">智谱清言</option>
              <option value="ollama">Ollama (本地)</option>
              <option value="custom">自定义</option>
            </select>
          </div>

          <div class="form-row">
            <label class="form-label">API Key</label>
            <div class="password-wrapper">
              <input
                :type="showApiKey ? 'text' : 'password'"
                v-model="draft.apiKey"
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
          </div>

          <div class="form-row">
            <label class="form-label">API URL</label>
            <input type="text" v-model="draft.apiUrl" class="form-input" placeholder="https://api.example.com/v1" />
          </div>

          <div class="form-row">
            <label class="form-label">模型</label>
            <input type="text" v-model="draft.model" class="form-input" placeholder="gpt-4o-mini" />
          </div>

          <div class="form-row">
            <label class="form-label">温度</label>
            <div class="slider-wrapper">
              <input type="range" min="0" max="2" step="0.1" v-model.number="draft.temperature" class="form-slider" />
              <span class="slider-value">{{ draft.temperature.toFixed(1) }}</span>
            </div>
          </div>

          <div class="form-row">
            <label class="form-label">Max Tokens</label>
            <input type="number" min="100" max="32768" v-model.number="draft.maxTokens" class="form-input" />
          </div>

          <div class="form-row">
            <label class="form-label">流式输出</label>
            <div class="toggle-wrapper">
              <button
                type="button"
                class="toggle-switch"
                :class="{ on: draft.stream }"
                @click="draft.stream = !draft.stream"
                :title="draft.stream ? '已启用' : '已禁用'"
              >
                <span class="toggle-knob"></span>
              </button>
              <span class="toggle-label">{{ draft.stream ? '启用' : '禁用' }}</span>
            </div>
          </div>

          <div class="form-row">
            <label class="form-label">模型能力</label>
            <div class="capability-tags">
              <span class="cap-tag" :class="draftCaps.webSearch ? 'on' : 'off'">
                联网 {{ draftCaps.webSearch ? '✓' : '✗' }}
              </span>
              <span class="cap-tag" :class="draftCaps.vision ? 'on' : 'off'">
                图片 {{ draftCaps.vision ? '✓' : '✗' }}
              </span>
              <span class="cap-auto">自动检测</span>
            </div>
          </div>

          <div class="form-actions">
            <button class="btn-ghost" :disabled="testing" @click="testConnection">
              <Loader2 v-if="testing" :size="14" class="spin" />
              <span>{{ testing ? '测试中...' : '测试连接' }}</span>
            </button>
            <button class="btn-ghost" @click="cancelEdit">取消</button>
            <button class="btn-primary" @click="saveDraft">保存</button>
          </div>
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

    <!-- 删除确认浮层 -->
    <div v-if="deleteTargetId" class="modal-overlay" @click.self="cancelDelete">
      <div class="modal-dialog">
        <div class="modal-icon">
          <AlertTriangle :size="24" />
        </div>
        <div class="modal-title">删除配置</div>
        <div class="modal-desc">确定要删除「{{ deleteTargetName }}」吗?此操作无法撤销。</div>
        <div class="modal-actions">
          <button class="btn-ghost" @click="cancelDelete">取消</button>
          <button class="btn-danger" @click="confirmDelete">删除</button>
        </div>
      </div>
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
  border-radius: var(--radius-button);
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.form-input:focus,
.form-select:focus {
  border-color: var(--primary);
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
  border-radius: var(--radius-button);
  color: var(--muted-foreground);
}
.toggle-btn:hover {
  color: var(--foreground);
  background: var(--accent);
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
.toggle-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
}
.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border: none;
  border-radius: 11px;
  background: var(--muted);
  cursor: pointer;
  transition: background 0.2s;
  padding: 0;
}
.toggle-switch.on {
  background: var(--primary);
}
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
}
.toggle-switch.on .toggle-knob {
  transform: translateX(18px);
}
.toggle-label {
  font-size: 12px;
  color: var(--muted-foreground);
}
/* Profile 列表 */
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.profile-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  transition: border-color 0.15s, background 0.15s;
}
.profile-item.active {
  border-color: var(--primary);
  background: var(--accent);
}
.profile-item.editing {
  border-color: var(--primary);
}
.profile-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.profile-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.profile-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--foreground);
}
.profile-active-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: var(--radius-tag);
  background: var(--primary);
  color: var(--primary-foreground);
  font-weight: 500;
}
.profile-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.profile-model {
  font-size: 12px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
}
.profile-tags {
  display: inline-flex;
  gap: 6px;
}
.profile-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 12px;
}
.profile-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-button);
  color: var(--muted-foreground);
  transition: background 0.15s, color 0.15s;
}
.profile-btn:hover {
  background: var(--accent);
  color: var(--foreground);
}
.profile-btn.edit:hover {
  color: var(--primary);
}
.profile-btn.delete:hover {
  color: var(--destructive);
}
.profile-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.profile-btn:disabled:hover {
  background: transparent;
  color: var(--muted-foreground);
}
.btn-add-profile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 36px;
  border: 1px dashed var(--primary);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s;
}
.btn-add-profile:hover {
  background: var(--accent);
}
/* 编辑表单 */
.edit-form {
  margin-top: 16px;
  padding: 16px;
  background: var(--secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
}
.edit-form-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
  margin-bottom: 12px;
}
.cap-auto {
  font-size: 11px;
  color: var(--muted-foreground);
}
/* 表单操作按钮 */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border-radius: var(--radius-button);
  font-size: 13px;
  font-weight: 500;
  background: var(--primary);
  color: var(--primary-foreground);
  transition: opacity 0.15s;
}
.btn-primary:hover {
  opacity: 0.9;
}
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border-radius: var(--radius-button);
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--foreground);
  transition: background 0.15s;
}
.btn-ghost:hover {
  background: var(--accent);
}
.btn-ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border-radius: var(--radius-button);
  font-size: 13px;
  font-weight: 500;
  background: var(--destructive);
  color: var(--destructive-foreground);
  transition: opacity 0.15s;
}
.btn-danger:hover {
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
/* Toast */
.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 100;
  padding: 10px 16px;
  border-radius: var(--radius-compact);
  font-size: 13px;
  box-shadow: var(--shadow-sm);
  max-width: 320px;
  word-break: break-word;
}
.toast.success {
  background: var(--success);
  color: var(--success-foreground);
}
.toast.error {
  background: var(--destructive);
  color: var(--destructive-foreground);
}
/* 删除确认浮层 */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-dialog {
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  box-shadow: var(--shadow-lg);
  text-align: center;
}
.modal-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: var(--destructive);
  color: var(--destructive-foreground);
}
.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  margin-bottom: 8px;
}
.modal-desc {
  font-size: 13px;
  color: var(--muted-foreground);
  line-height: 1.6;
  margin-bottom: 20px;
}
.modal-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}
/* 能力标签 */
.capability-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.cap-tag {
  padding: 4px 10px;
  border-radius: var(--radius-tag);
  font-size: 12px;
  font-weight: 500;
}
.cap-tag.on {
  background: var(--success-surface);
  color: var(--success);
}
.cap-tag.off {
  background: var(--secondary);
  color: var(--muted-foreground);
  opacity: 0.6;
}
</style>
