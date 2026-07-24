<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ArrowLeft, Sun, Moon, Info, Keyboard, Eye, EyeOff,
  Loader2, Plus, Pencil, Trash2, AlertTriangle, Search, Download,
  Brain, Check, Coffee, RefreshCw, Github, ExternalLink,
  Download as DownloadIcon, CheckCircle2, XCircle
} from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore, type ApiProfile, type ProviderPreset } from '@/stores/settings'
import { useRouter } from 'vue-router'
import type { ModelConfig } from '@/ai/types'

import deepseekIcon from '@/assets/settings-icons/deepseek.svg'
import openaiIcon from '@/assets/settings-icons/openai.svg'
import qwenIcon from '@/assets/settings-icons/qwen.svg'
import zhipuIcon from '@/assets/settings-icons/zhipu.svg'
import ollamaIcon from '@/assets/settings-icons/ollama.svg'
import uusharkIcon from '@/assets/settings-icons/uushark-icon.png'
import alipayQr from '@/assets/settings-icons/alipay-qr.png'

const theme = useThemeStore()
const settings = useSettingsStore()
const router = useRouter()

function backToEditor() {
  router.push('/editor')
}

type SectionKey = 'appearance' | 'ai' | 'shortcuts' | 'about'
const activeSection = ref<SectionKey>('appearance')

const navItems: { key: SectionKey; label: string; icon: typeof Sun | string; isImg?: boolean }[] = [
  { key: 'appearance', label: '外观', icon: Sun },
  { key: 'ai', label: 'AI 配置', icon: uusharkIcon, isImg: true },
  { key: 'shortcuts', label: '快捷键', icon: Keyboard },
  { key: 'about', label: '关于', icon: Info },
]

const PROVIDER_BRAND: Record<ProviderPreset | 'custom', { color: string; icon: string; label: string }> = {
  deepseek: { color: '#5786FE', icon: deepseekIcon, label: 'DeepSeek' },
  openai: { color: '#000000', icon: openaiIcon, label: 'OpenAI' },
  qwen: { color: '#614FF0', icon: qwenIcon, label: '通义千问' },
  zhipu: { color: '#2D2D2D', icon: zhipuIcon, label: '智谱清言' },
  ollama: { color: '#000000', icon: ollamaIcon, label: 'Ollama (本地)' },
  custom: { color: '#8e8e93', icon: '', label: '自定义' },
}

const showApiKey = ref(false)
const testing = ref(false)
const toast = ref<{ type: 'success' | 'error'; msg: string } | null>(null)

const editing = ref(false)
const editingId = ref<string | null>(null)
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

const deleteTargetId = ref<string | null>(null)
const deleteTargetName = computed(
  () => settings.profiles.find((p) => p.id === deleteTargetId.value)?.name ?? ''
)

function capsFor(p: ApiProfile) {
  return {
    vision: !!p.vision,
    webSearch: !!p.webSearch,
    nativeSearch: !!p.nativeSearch,
  }
}

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
  showToast('success', '已保存到本地')
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
    showToast('error', '至少保留一个配置')
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
    showToast('success', '配置已删除')
  }
}

function cancelDelete() {
  deleteTargetId.value = null
}

function showToast(type: 'success' | 'error', msg: string) {
  toast.value = { type, msg }
  setTimeout(() => { toast.value = null }, 3000)
}

async function testConnection() {
  testing.value = true
  try {
    if (!draft.apiKey.trim() || !draft.apiUrl.trim() || !draft.model.trim()) {
      showToast('error', 'API Key、API URL、模型名 不能为空')
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
    const messages = [{ role: 'user' as const, content: 'ping' }]
    await chat(messages, [], config)
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
    showToast('success', `连接成功${tags.length ? '（支持: ' + tags.join('、') + '）' : ''}${note}`)
  } catch (e) {
    showToast('error', (e as Error).message)
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  settings.load()
})

const shortcuts = [
  { keys: ['Ctrl', 'Z'], desc: '撤销' },
  { keys: ['Ctrl', 'Shift', 'Z'], desc: '重做' },
  { keys: ['Ctrl', 'S'], desc: '保存为 .md' },
  { keys: ['Ctrl', 'F'], desc: '查找替换' },
  { keys: ['Ctrl', 'K'], desc: '唤起 AI 指令栏' },
  { keys: ['Ctrl', 'Shift', '.'], desc: 'AI 对话浮窗' },
  { keys: ['Enter'], desc: '新建同类型区块' },
  { keys: ['Backspace'], desc: '删除空区块' },
  { keys: ['Ctrl', 'E'], desc: '导出 PDF' },
]

const CURRENT_VERSION = __APP_VERSION__
const GITHUB_REPO = 'Qiao-zhihang/uni-doc'

const aboutRows = [
  { label: '版本', value: `v${CURRENT_VERSION} (Milestone 1)` },
  { label: '技术栈', value: 'Vite + Vue 3 + TypeScript + Pinia' },
  { label: '文件格式', value: '.md (Markdown)' },
  { label: 'Tauri 后端', value: '已集成' },
  { label: 'GitHub', value: 'github.com/unidoc/unidoc', isLink: true },
]

type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'error'
const updateStatus = ref<UpdateStatus>('idle')
const latestVersion = ref<string>('')
const latestReleaseUrl = ref<string>('')
const updateError = ref<string>('')

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

async function checkForUpdates() {
  updateStatus.value = 'checking'
  updateError.value = ''
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const data = await res.json()
    const tag = (data.tag_name || '') as string
    latestVersion.value = tag.replace(/^v/, '')
    latestReleaseUrl.value = (data.html_url || '') as string
    const cmp = compareVersions(latestVersion.value, CURRENT_VERSION)
    updateStatus.value = cmp > 0 ? 'available' : 'latest'
  } catch (e) {
    updateError.value = (e as Error).message
    updateStatus.value = 'error'
  }
}

const updateStatusText = computed(() => {
  switch (updateStatus.value) {
    case 'idle': return '点击右侧按钮检查更新'
    case 'checking': return '正在检查更新…'
    case 'latest': return `已是最新版本 (v${CURRENT_VERSION})`
    case 'available': return `发现新版本 v${latestVersion.value}`
    case 'error': return `检查失败: ${updateError.value}`
  }
})
</script>

<template>
  <main class="settings-page">
    <!-- ===== 顶栏 ===== -->
    <header class="topbar">
      <div class="topbar-left">
        <button class="icon-btn" title="返回编辑器" @click="backToEditor">
          <ArrowLeft :size="18" />
        </button>
        <h1 class="page-title">设置</h1>
      </div>
      <button class="icon-btn" title="搜索设置">
        <Search :size="16" />
      </button>
    </header>

    <div class="main-body">
      <!-- ===== 侧边栏 ===== -->
      <nav class="sidebar">
        <a
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeSection === item.key }"
          @click="activeSection = item.key"
        >
          <img v-if="item.isImg" :src="item.icon" class="nav-img" />
          <component v-else :is="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </a>
      </nav>

      <!-- ===== 内容区 ===== -->
      <div class="content">

        <!-- 外观 -->
        <section v-show="activeSection === 'appearance'" class="section">
          <h2 class="section-title-plain">外观</h2>
          <p class="section-desc">切换深色或浅色主题，偏好将保存到本地。</p>

          <div class="card-wrap">
            <label class="card-label">主题模式</label>
            <div class="segmented-control">
              <button
                class="seg-btn"
                :class="{ active: theme.mode === 'light' }"
                @click="theme.setMode('light')"
              >
                <Sun :size="14" />
                <span>浅色</span>
              </button>
              <button
                class="seg-btn"
                :class="{ active: theme.mode === 'dark' }"
                @click="theme.setMode('dark')"
              >
                <Moon :size="14" />
                <span>深色</span>
              </button>
            </div>
          </div>
        </section>

        <!-- AI 配置 -->
        <section v-show="activeSection === 'ai'" class="section">
          <header class="section-header">
            <h2 class="section-title-plain">AI 配置</h2>
            <button class="icon-btn-solid" title="导出/导入">
              <Download :size="14" />
            </button>
          </header>
          <p class="section-desc">管理多个 AI 服务配置，点击列表项切换激活配置，修改后自动保存到本地。</p>

          <!-- Profile 列表 -->
          <div v-if="!editing" class="profile-list">
            <div
              v-for="p in settings.profiles"
              :key="p.id"
              class="profile-card"
              :class="{ active: p.id === settings.activeProfileId }"
            >
              <div class="profile-main" @click="settings.setActiveProfile(p.id)">
                <div
                  class="provider-icon"
                  :style="{ background: PROVIDER_BRAND[p.provider]?.color || '#8e8e93' }"
                >
                  <img v-if="PROVIDER_BRAND[p.provider]?.icon" :src="PROVIDER_BRAND[p.provider].icon" />
                </div>
                <div class="profile-info">
                  <div class="profile-name-row">
                    <span class="profile-name">{{ p.name }}</span>
                  </div>
                  <span class="profile-model">{{ p.model || '未设置模型' }}</span>
                  <div class="cap-tags">
                    <span
                      class="cap-tag"
                      :class="capsFor(p).webSearch || capsFor(p).nativeSearch ? 'on' : 'off'"
                    >联网</span>
                    <span class="cap-tag" :class="capsFor(p).vision ? 'on' : 'off'">图片</span>
                    <span
                      class="cap-tag"
                      :class="p.provider === 'qwen' || p.provider === 'zhipu' || p.provider === 'deepseek' ? 'on' : 'off'"
                    >代码</span>
                  </div>
                </div>
              </div>
              <div class="profile-actions">
                <span v-if="p.id === settings.activeProfileId" class="active-badge">已激活</span>
                <button class="icon-btn" title="编辑" @click.stop="startEditProfile(p.id)">
                  <Pencil :size="14" />
                </button>
                <button
                  class="icon-btn delete"
                  title="删除"
                  :disabled="settings.profiles.length <= 1"
                  @click.stop="askDelete(p.id)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>

            <button class="btn-add" @click="startAddProfile">
              <Plus :size="14" />
              <span>添加配置</span>
            </button>
          </div>

          <!-- 编辑表单 -->
          <div v-if="editing" class="edit-panel">
            <div class="edit-header">
              <h3 class="edit-title">{{ editingId ? '编辑配置' : '新增配置' }}</h3>
            </div>

            <div class="form-grid">
              <div class="form-field">
                <label class="form-label">名称</label>
                <input type="text" v-model="draft.name" class="form-input" placeholder="例如：我的 OpenAI" />
              </div>

              <div class="form-field">
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

              <div class="form-field">
                <label class="form-label">API Key</label>
                <div class="password-wrap">
                  <input
                    :type="showApiKey ? 'text' : 'password'"
                    v-model="draft.apiKey"
                    class="form-input"
                    placeholder="sk-..."
                  />
                  <button type="button" class="toggle-visibility" @click="showApiKey = !showApiKey">
                    <Eye v-if="!showApiKey" :size="16" />
                    <EyeOff v-else :size="16" />
                  </button>
                </div>
              </div>

              <div class="form-field">
                <label class="form-label">API URL</label>
                <input type="text" v-model="draft.apiUrl" class="form-input" placeholder="https://api.example.com/v1" />
              </div>

              <div class="form-field">
                <label class="form-label">模型</label>
                <input type="text" v-model="draft.model" class="form-input" placeholder="gpt-4o-mini" />
              </div>

              <div class="form-field">
                <label class="form-label">温度 <span class="temp-val">{{ draft.temperature.toFixed(1) }}</span></label>
                <input type="range" min="0" max="2" step="0.1" v-model.number="draft.temperature" class="form-slider" />
              </div>

              <div class="form-field">
                <label class="form-label">Max Tokens</label>
                <input type="number" min="100" max="32768" v-model.number="draft.maxTokens" class="form-input" />
              </div>

              <div class="form-field">
                <label class="form-label">流式输出</label>
                <div class="switch-row">
                  <button
                    type="button"
                    class="switch"
                    :class="{ on: draft.stream }"
                    @click="draft.stream = !draft.stream"
                  >
                    <span class="switch-knob"></span>
                  </button>
                  <span class="switch-label">{{ draft.stream ? '启用流式响应' : '禁用流式响应' }}</span>
                </div>
              </div>

              <div class="form-field full">
                <label class="form-label">模型能力</label>
                <div class="cap-toggle-row">
                  <button
                    type="button"
                    class="cap-toggle"
                    :class="{ on: draft.webSearch || draft.nativeSearch }"
                    @click="draft.webSearch = !draft.webSearch; draft.nativeSearch = false"
                  >
                    <Check v-if="draft.webSearch || draft.nativeSearch" :size="12" />
                    联网
                  </button>
                  <button
                    type="button"
                    class="cap-toggle"
                    :class="{ on: draft.vision }"
                    @click="draft.vision = !draft.vision"
                  >
                    <Check v-if="draft.vision" :size="12" />
                    图片
                  </button>
                  <button
                    type="button"
                    class="cap-toggle"
                    :class="{ on: draft.provider === 'qwen' || draft.provider === 'zhipu' || draft.provider === 'deepseek' }"
                  >
                    <Check v-if="draft.provider === 'qwen' || draft.provider === 'zhipu' || draft.provider === 'deepseek'" :size="12" />
                    代码
                  </button>
                  <span class="cap-hint">自动检测，可手动调整</span>
                </div>
              </div>
            </div>

            <div class="form-actions">
              <button class="btn btn-ghost" :disabled="testing" @click="testConnection">
                <Loader2 v-if="testing" :size="14" class="spin" />
                <span>{{ testing ? '测试中…' : '测试连接' }}</span>
              </button>
              <div class="form-actions-right">
                <button class="btn btn-ghost" @click="cancelEdit">取消</button>
                <button class="btn btn-primary" @click="saveDraft">保存</button>
              </div>
            </div>
          </div>

          <!-- 记忆管理 -->
          <div class="subsection">
            <header class="subsection-header">
              <Brain :size="16" class="subsection-icon" />
              <h3 class="subsection-title">记忆管理</h3>
            </header>
            <div class="placeholder-card">
              <div class="placeholder-icon">
                <Brain :size="32" />
              </div>
              <div class="placeholder-text">敬请期待</div>
              <div class="placeholder-hint">AI 将记住你的偏好和历史对话，提供更个性化的回答。</div>
            </div>
          </div>
        </section>

        <!-- 快捷键 -->
        <section v-show="activeSection === 'shortcuts'" class="section">
          <header class="section-header">
            <h2 class="section-title">
              <Keyboard :size="18" class="section-icon" />
              快捷键
            </h2>
          </header>

          <table class="data-table">
            <thead>
              <tr>
                <th>操作</th>
                <th>快捷键</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in shortcuts" :key="s.desc">
                <td>{{ s.desc }}</td>
                <td class="kbd-cell">
                  <kbd v-for="(k, i) in s.keys" :key="i">{{ k }}</kbd>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 关于 -->
        <section v-show="activeSection === 'about'" class="section">
          <header class="section-header">
            <h2 class="section-title">
              <Info :size="18" class="section-icon" />
              关于 UniDoc
            </h2>
          </header>

          <table class="data-table">
            <tbody>
              <tr v-for="row in aboutRows" :key="row.label">
                <td>{{ row.label }}</td>
                <td>
                  <span v-if="!row.isLink">{{ row.value }}</span>
                  <a v-else class="external-link" :href="'https://' + row.value" target="_blank" rel="noopener">
                    <Github :size="14" />
                    {{ row.value }}
                    <ExternalLink :size="12" />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 检查更新 -->
          <div class="subsection">
            <header class="subsection-header">
              <RefreshCw :size="16" class="subsection-icon" />
              <h3 class="subsection-title">检查更新</h3>
            </header>
            <div class="update-card">
              <div class="update-info">
                <div class="update-version">当前版本：v{{ CURRENT_VERSION }}</div>
                <div class="update-build">构建代号：M1 Initial Release</div>
                <div class="update-status" :class="updateStatus">
                  <RefreshCw v-if="updateStatus === 'checking'" :size="12" class="spin" />
                  <CheckCircle2 v-else-if="updateStatus === 'latest'" :size="12" class="ok" />
                  <DownloadIcon v-else-if="updateStatus === 'available'" :size="12" class="new" />
                  <XCircle v-else-if="updateStatus === 'error'" :size="12" class="err" />
                  {{ updateStatusText }}
                </div>
              </div>
              <button
                v-if="updateStatus !== 'available'"
                class="btn btn-ghost"
                :disabled="updateStatus === 'checking'"
                @click="checkForUpdates"
              >
                <RefreshCw :size="14" :class="{ spin: updateStatus === 'checking' }" />
                {{ updateStatus === 'checking' ? '检查中' : '检查更新' }}
              </button>
              <a
                v-else
                class="btn btn-primary"
                :href="latestReleaseUrl"
                target="_blank"
                rel="noopener"
              >
                <DownloadIcon :size="14" />
                前往下载
              </a>
            </div>
          </div>

          <!-- 打赏作者 -->
          <div class="subsection">
            <header class="subsection-header">
              <Coffee :size="16" class="subsection-icon" />
              <h3 class="subsection-title">打赏作者</h3>
            </header>
            <div class="donate-card">
              <img class="donate-qr" :src="alipayQr" alt="支付宝收款码" />
              <div class="donate-info">
                <div class="donate-qr-label">支付宝</div>
                <div class="donate-title">请作者喝杯咖啡 ☕</div>
                <div class="donate-desc">你的支持是 UniDoc 持续更新的动力</div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="deleteTargetId" class="modal-overlay" @click.self="cancelDelete">
      <div class="modal-dialog">
        <div class="modal-icon-danger">
          <AlertTriangle :size="24" />
        </div>
        <div class="modal-title">删除配置</div>
        <div class="modal-desc">确定要删除「{{ deleteTargetName }}」吗？此操作无法撤销。</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="cancelDelete">取消</button>
          <button class="btn btn-danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="toast" :class="toast.type">
      {{ toast.msg }}
    </div>
  </main>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--muted);
  overflow: hidden;
}

/* ===== 顶栏 ===== */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  flex-shrink: 0;
  background: var(--background);
  border-bottom: 1px solid var(--border);
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  letter-spacing: -0.01em;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background 0.15s;
}
.icon-btn:hover {
  background: var(--muted);
  color: var(--foreground);
}
.icon-btn.delete:hover {
  color: var(--destructive);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.icon-btn-solid {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background 0.15s;
}
.icon-btn-solid:hover {
  background: var(--muted);
}

/* ===== 主体 ===== */
.main-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ===== 侧边栏 ===== */
.sidebar {
  width: 200px;
  min-width: 200px;
  flex-shrink: 0;
  padding: 8px;
  border-right: 1px solid var(--border);
  background: var(--background);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--foreground);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  user-select: none;
}
.nav-img {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  object-fit: contain;
}
.nav-item:hover {
  background: var(--muted);
}
.nav-item.active {
  background: var(--accent);
  color: var(--primary);
  font-weight: 500;
}

/* ===== 内容区 ===== */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  background: var(--background);
}
.section {
  max-width: 720px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.section-title-plain {
  font-size: 18px;
  font-weight: 600;
  color: var(--foreground);
  margin: 0 0 4px 0;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 600;
  color: var(--foreground);
}
.section-icon {
  color: var(--primary);
}
.section-desc {
  font-size: 13px;
  color: var(--muted-foreground);
  line-height: 1.6;
  margin: 0 0 20px 0;
}

.card-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  background: var(--card);
}
.card-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  display: block;
  margin-bottom: 12px;
}

/* ===== 分段控件（主题切换） ===== */
.segmented-control {
  display: inline-flex;
  padding: 3px;
  background: var(--muted);
  border-radius: 8px;
  gap: 2px;
}
.seg-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 20px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted-foreground);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.seg-btn.active {
  background: var(--card);
  color: var(--foreground);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* ===== Profile 卡片 ===== */
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.profile-card {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  transition: border-color 0.15s;
}
.profile-card.active {
  border-color: var(--primary);
}
.profile-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.provider-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.provider-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: brightness(0) invert(1);
}
.profile-info {
  flex: 1;
  min-width: 0;
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
.profile-model {
  display: block;
  font-size: 12px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  margin-top: 2px;
}
.cap-tags {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.cap-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--muted);
  color: var(--muted-foreground);
}
.cap-tag.on {
  background: var(--primary);
  color: var(--primary-foreground);
}
.profile-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.active-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--primary);
  color: var(--primary-foreground);
  font-weight: 500;
}

.btn-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 48px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.btn-add:hover {
  background: var(--card);
  border-color: var(--primary);
  color: var(--primary);
}

/* ===== 编辑面板 ===== */
.edit-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  animation: fadeInUp 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.edit-header {
  margin-bottom: 16px;
}
.edit-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--foreground);
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 16px;
}
.form-field.full {
  grid-column: 1 / -1;
}
.form-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  margin-bottom: 6px;
}
.temp-val {
  color: var(--primary);
  font-family: var(--font-mono);
  font-weight: 400;
}
.form-input,
.form-select {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
  font-family: inherit;
}
.form-input:focus,
.form-select:focus {
  border-color: var(--primary);
}
.password-wrap {
  position: relative;
}
.password-wrap .form-input {
  padding-right: 36px;
}
.toggle-visibility {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--muted-foreground);
  cursor: pointer;
}
.toggle-visibility:hover {
  color: var(--foreground);
}
.form-slider {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border);
  border-radius: 2px;
  outline: none;
  accent-color: var(--primary);
  cursor: pointer;
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
.slider-val {
  min-width: 32px;
  text-align: right;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--foreground);
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
}
.switch {
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
.switch.on {
  background: var(--primary);
}
.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
}
.switch.on .switch-knob {
  transform: translateX(18px);
}
.switch-label {
  font-size: 12px;
  color: var(--muted-foreground);
}
.cap-toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cap-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.cap-toggle.on {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.cap-hint {
  font-size: 11px;
  color: var(--muted-foreground);
  margin-left: 4px;
}
.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.form-actions-right {
  display: flex;
  gap: 8px;
}

/* ===== 按钮 ===== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: opacity 0.15s, background 0.15s;
}
.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.btn-primary:hover {
  opacity: 0.9;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--foreground);
}
.btn-ghost:hover {
  background: var(--muted);
}
.btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-danger {
  background: var(--destructive);
  color: var(--destructive-foreground);
}
.btn-danger:hover {
  opacity: 0.9;
}
.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== 子板块 ===== */
.subsection {
  margin-top: 28px;
}
.subsection-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.subsection-icon {
  color: var(--muted-foreground);
}
.subsection-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--foreground);
}

.placeholder-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 40px 24px;
  text-align: center;
}
.placeholder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--muted);
  color: var(--muted-foreground);
  margin-bottom: 16px;
}
.placeholder-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  margin-bottom: 6px;
}
.placeholder-hint {
  font-size: 13px;
  color: var(--muted-foreground);
  line-height: 1.6;
}

/* ===== 数据表格 ===== */
.data-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.data-table th,
.data-table td {
  padding: 12px 16px;
  text-align: left;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}
.data-table th {
  background: var(--muted);
  font-weight: 500;
  color: var(--muted-foreground);
  font-size: 12px;
}
.data-table tr:last-child td {
  border-bottom: none;
}
.data-table td:first-child {
  color: var(--muted-foreground);
  width: 140px;
}
.kbd-cell {
  display: flex;
  gap: 4px;
}
kbd {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--foreground);
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.external-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary);
  text-decoration: none;
  font-size: 13px;
}
.external-link:hover {
  text-decoration: underline;
}

/* ===== 更新卡片 ===== */
.update-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
}
.update-version {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  margin-bottom: 4px;
}
.update-build {
  font-size: 12px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  margin-bottom: 8px;
}
.update-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-foreground);
}
.update-status.latest,
.update-status.latest .ok {
  color: var(--success, #10b981);
}
.update-status.available,
.update-status.available .new {
  color: var(--primary, #3b82f6);
}
.update-status.error,
.update-status.error .err {
  color: var(--destructive, #ef4444);
}

/* ===== 打赏卡片 ===== */
.donate-card {
  display: flex;
  align-items: center;
  gap: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
}
.donate-qr {
  width: 100px;
  height: 100px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}
.donate-qr-label {
  display: inline-block;
  font-size: 11px;
  color: var(--muted-foreground);
  font-weight: 500;
  padding: 2px 8px;
  background: var(--muted);
  border-radius: 4px;
  margin-bottom: 8px;
}
.donate-info {
  flex: 1;
}
.donate-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--foreground);
  margin-bottom: 6px;
}
.donate-desc {
  font-size: 12px;
  color: var(--muted-foreground);
  margin-bottom: 12px;
}

/* ===== 弹窗 ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.15s;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.modal-dialog {
  width: 340px;
  max-width: calc(100vw - 32px);
  padding: 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  text-align: center;
  animation: popIn 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes popIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.modal-icon-danger {
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

/* ===== Toast ===== */
.toast {
  position: fixed;
  top: 72px;
  right: 24px;
  z-index: 300;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-width: 360px;
  word-break: break-word;
  animation: slideIn 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes slideIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
.toast.success {
  background: var(--success);
  color: var(--success-foreground);
}
.toast.error {
  background: var(--destructive);
  color: var(--destructive-foreground);
}
</style>
