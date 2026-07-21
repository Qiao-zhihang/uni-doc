/**
 * AI 配置 store
 * 管理多个 AI 配置 Profile（提供商预设、API Key、模型、温度等）
 * 配置持久化:Tauri 环境走 Rust command;Web 环境走 localStorage
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isTauri } from '@/core/serializer/markdownFile'
import type { ModelConfig } from '@/ai/types'

/** AI 提供商预设类型 */
export type ProviderPreset = 'openai' | 'deepseek' | 'qwen' | 'zhipu' | 'ollama' | 'custom'

/** 单个 API 配置 Profile */
export interface ApiProfile {
  id: string          // crypto.randomUUID()
  name: string        // 用户自定义名称
  provider: ProviderPreset
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  maxTokens: number
  /** 是否启用流式输出（默认 true） */
  stream?: boolean
  /** 探针检测结果（测试连接时自动检测） */
  vision?: boolean
  webSearch?: boolean
  nativeSearch?: boolean
}

/** 各预设的默认 apiUrl / model / 显示名 */
const PRESETS: Record<Exclude<ProviderPreset, 'custom'>, { apiUrl: string; model: string; label: string }> = {
  openai: { apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  deepseek: { apiUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  qwen: { apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '通义千问' },
  zhipu: { apiUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', label: '智谱清言' },
  ollama: { apiUrl: 'http://localhost:11434/v1', model: 'llama3', label: 'Ollama (本地)' }
}

/** 持久化的配置结构 */
interface SettingsPayload {
  profiles: ApiProfile[]
  activeProfileId: string
}

/** 动态导入 Tauri invoke,避免 Web 环境下打包报错 */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** 创建一个默认 Profile */
function createDefaultProfile(): ApiProfile {
  return {
    id: crypto.randomUUID(),
    name: '默认配置',
    provider: 'custom',
    apiKey: '',
    apiUrl: '',
    model: '',
    temperature: 0.7,
    maxTokens: 4096,
    stream: true,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const initial = createDefaultProfile()
  const profiles = ref<ApiProfile[]>([initial])
  const activeProfileId = ref<string>(initial.id)

  /** 当前激活的 Profile；找不到时回退到第一个 */
  const activeProfile = computed<ApiProfile>(() => {
    return profiles.value.find((p) => p.id === activeProfileId.value) ?? profiles.value[0]
  })

  /** 模型能力（读取探针检测结果，需先在设置页测试连接） */
  const modelCapabilities = computed(() => ({
    vision: !!activeProfile.value.vision,
    webSearch: !!activeProfile.value.webSearch,
    nativeSearch: !!activeProfile.value.nativeSearch,
  }))
  /** 是否已从磁盘加载 */
  const loaded = ref(false)

  // save 防抖句柄
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // ===== 兼容旧引用:代理到 activeProfile =====
  const provider = computed<ProviderPreset>({
    get: () => activeProfile.value.provider,
    set: (v) => { activeProfile.value.provider = v }
  })
  const apiKey = computed<string>({
    get: () => activeProfile.value.apiKey,
    set: (v) => { activeProfile.value.apiKey = v }
  })
  const apiUrl = computed<string>({
    get: () => activeProfile.value.apiUrl,
    set: (v) => { activeProfile.value.apiUrl = v }
  })
  const model = computed<string>({
    get: () => activeProfile.value.model,
    set: (v) => { activeProfile.value.model = v }
  })
  const temperature = computed<number>({
    get: () => activeProfile.value.temperature,
    set: (v) => { activeProfile.value.temperature = v }
  })
  const maxTokens = computed<number>({
    get: () => activeProfile.value.maxTokens,
    set: (v) => { activeProfile.value.maxTokens = v }
  })

  /** 新增 Profile 并设为激活 */
  function addProfile(profile: ApiProfile): void {
    profiles.value.push(profile)
    activeProfileId.value = profile.id
    save()
  }

  /** 局部更新某个 Profile */
  function updateProfile(id: string, patch: Partial<ApiProfile>): void {
    const p = profiles.value.find((p) => p.id === id)
    if (!p) return
    Object.assign(p, patch)
    save()
  }

  /** 删除 Profile；最后一个不允许删除 */
  function deleteProfile(id: string): void {
    if (profiles.value.length <= 1) return
    const idx = profiles.value.findIndex((p) => p.id === id)
    if (idx === -1) return
    profiles.value.splice(idx, 1)
    if (activeProfileId.value === id) {
      activeProfileId.value = profiles.value[Math.min(idx, profiles.value.length - 1)].id
    }
    save()
  }

  /** 切换激活 Profile */
  function setActiveProfile(id: string): void {
    if (profiles.value.some((p) => p.id === id)) {
      activeProfileId.value = id
      save()
    }
  }

  /** 应用预设:非 custom 时自动填入 apiUrl/model（作用于 activeProfile） */
  function applyPreset(p: ProviderPreset) {
    activeProfile.value.provider = p
    if (p !== 'custom') {
      activeProfile.value.apiUrl = PRESETS[p].apiUrl
      activeProfile.value.model = PRESETS[p].model
    }
    // custom 时保留用户填的 apiUrl/model
    save()
  }

  /** 返回当前激活 Profile 的配置快照,供 model.ts 使用 */
  function getModelConfig(): ModelConfig {
    const p = activeProfile.value
    return {
      apiKey: p.apiKey,
      apiUrl: p.apiUrl,
      model: p.model,
      temperature: p.temperature,
      maxTokens: p.maxTokens,
      provider: p.provider,
      nativeSearch: !!p.nativeSearch,
      stream: p.stream !== false,
    }
  }

  /** 持久化保存(300ms 防抖) */
  function save() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(async () => {
      saveTimer = null
      const config: SettingsPayload = {
        profiles: profiles.value,
        activeProfileId: activeProfileId.value
      }
      const json = JSON.stringify(config)
      try {
        if (isTauri()) {
          await tauriInvoke('save_settings', { json })
        } else {
          localStorage.setItem('unidoc-settings', json)
        }
      } catch (e) {
        console.error('保存设置失败:', e)
      }
    }, 300)
  }

  /** 从磁盘加载配置（兼容旧扁平格式，自动迁移为单 Profile） */
  async function load() {
    try {
      let json: string | null = null
      if (isTauri()) {
        const raw = await tauriInvoke<string>('load_settings')
        json = raw && raw.length > 0 ? raw : null
      } else {
        json = localStorage.getItem('unidoc-settings')
      }

      if (json) {
        const parsed = JSON.parse(json) as Partial<SettingsPayload> & {
          provider?: ProviderPreset
          apiKey?: string
          apiUrl?: string
          model?: string
          temperature?: number
          maxTokens?: number
        }

        if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
          // 新格式
          // 数据迁移：修正非 qwen provider 的 nativeSearch（旧版名字匹配可能误存为 true）
          for (const p of parsed.profiles) {
            if (p.provider !== 'qwen') {
              p.nativeSearch = false
            }
          }
          profiles.value = parsed.profiles
          const id = parsed.activeProfileId
          activeProfileId.value =
            id && profiles.value.some((p) => p.id === id) ? id : profiles.value[0].id
          // 迁移后立即保存覆盖旧数据
          save()
        } else if (parsed.provider !== undefined) {
          // 旧扁平格式 → 迁移为单 Profile
          const profile: ApiProfile = {
            id: crypto.randomUUID(),
            name: '默认配置',
            provider: parsed.provider,
            apiKey: parsed.apiKey ?? '',
            apiUrl: parsed.apiUrl ?? '',
            model: parsed.model ?? '',
            temperature: parsed.temperature ?? 0.7,
            maxTokens: parsed.maxTokens ?? 4096
          }
          profiles.value = [profile]
          activeProfileId.value = profile.id
        }
      }
    } catch (e) {
      console.error('加载设置失败:', e)
    } finally {
      loaded.value = true
    }
  }

  /** 测试当前激活 Profile 是否能连通 AI 服务，并探针检测能力 */
  async function testConnection(): Promise<{ ok: boolean; message: string }> {
    const p = activeProfile.value
    if (!p.apiKey || !p.apiUrl || !p.model) {
      return { ok: false, message: 'API Key、API URL、模型名 不能为空' }
    }
    try {
      const { chat, probeCapabilities } = await import('@/ai/model')
      // 基本连通性测试
      const messages = [{ role: 'user' as const, content: 'ping' }]
      await chat(messages, [], getModelConfig())
      // 探针检测能力
      const caps = await probeCapabilities(getModelConfig())
      p.vision = caps.vision
      p.webSearch = caps.webSearch
      p.nativeSearch = caps.nativeSearch
      save()
      const tags: string[] = []
      if (caps.vision) tags.push('图片')
      if (caps.nativeSearch) tags.push('原生联网')
      else if (caps.webSearch) tags.push('工具联网')
      const errs: string[] = []
      if (!caps.vision && caps.visionError) errs.push(`图片: ${caps.visionError.slice(0, 60)}`)
      if (!caps.webSearch && !caps.nativeSearch && caps.webSearchError) errs.push(`联网: ${caps.webSearchError.slice(0, 60)}`)
      if (!caps.nativeSearch && caps.nativeSearchError) errs.push(`原生联网: ${caps.nativeSearchError.slice(0, 60)}`)
      const note = errs.length ? ` [检测失败: ${errs.join(' | ')}]` : ''
      return { ok: true, message: `连接成功${tags.length ? '（支持: ' + tags.join('、') + '）' : ''}${note}` }
    } catch (e) {
      const err = e as Error
      return { ok: false, message: err.message }
    }
  }

  return {
    profiles,
    activeProfileId,
    activeProfile,
    modelCapabilities,
    // 兼容代理
    provider,
    apiKey,
    apiUrl,
    model,
    temperature,
    maxTokens,
    loaded,
    addProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    applyPreset,
    getModelConfig,
    save,
    load,
    testConnection
  }
})
