/**
 * AI 配置 store
 * 管理 AI 提供商预设、API Key、模型、温度等配置项
 * 配置持久化:Tauri 环境走 Rust command;Web 环境走 localStorage
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { isTauri } from '@/core/serializer/markdownFile'
import type { ModelConfig } from '@/ai/types'

/** AI 提供商预设类型 */
type ProviderPreset = 'openai' | 'deepseek' | 'qwen' | 'zhipu' | 'ollama' | 'custom'

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
  provider: ProviderPreset
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  maxTokens: number
}

/** 动态导入 Tauri invoke,避免 Web 环境下打包报错 */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export const useSettingsStore = defineStore('settings', () => {
  const provider = ref<ProviderPreset>('custom')
  const apiKey = ref('')
  const apiUrl = ref('')
  const model = ref('')
  const temperature = ref(0.7)
  const maxTokens = ref(4096)
  /** 是否已从磁盘加载 */
  const loaded = ref(false)

  // save 防抖句柄
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 应用预设:非 custom 时自动填入 apiUrl/model */
  function applyPreset(p: ProviderPreset) {
    provider.value = p
    if (p !== 'custom') {
      apiUrl.value = PRESETS[p].apiUrl
      model.value = PRESETS[p].model
    }
    // custom 时保留用户填的 apiUrl/model
    save()
  }

  /** 返回当前配置快照,供 model.ts 使用 */
  function getModelConfig(): ModelConfig {
    return {
      apiKey: apiKey.value,
      apiUrl: apiUrl.value,
      model: model.value,
      temperature: temperature.value,
      maxTokens: maxTokens.value
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
        provider: provider.value,
        apiKey: apiKey.value,
        apiUrl: apiUrl.value,
        model: model.value,
        temperature: temperature.value,
        maxTokens: maxTokens.value
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

  /** 从磁盘加载配置 */
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
        const parsed = JSON.parse(json) as Partial<SettingsPayload>
        provider.value = (parsed.provider ?? 'custom') as ProviderPreset
        apiKey.value = parsed.apiKey ?? ''
        apiUrl.value = parsed.apiUrl ?? ''
        model.value = parsed.model ?? ''
        temperature.value = parsed.temperature ?? 0.7
        maxTokens.value = parsed.maxTokens ?? 4096
      }
    } catch (e) {
      console.error('加载设置失败:', e)
    } finally {
      loaded.value = true
    }
  }

  /** 测试当前配置是否能连通 AI 服务 */
  async function testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!apiKey.value || !apiUrl.value || !model.value) {
      return { ok: false, message: 'API Key、API URL、模型名 不能为空' }
    }
    try {
      const { chat } = await import('@/ai/model')
      const messages = [{ role: 'user' as const, content: 'ping' }]
      await chat(messages, [], getModelConfig())
      return { ok: true, message: '连接成功' }
    } catch (e) {
      const err = e as Error
      return { ok: false, message: err.message }
    }
  }

  return {
    provider,
    apiKey,
    apiUrl,
    model,
    temperature,
    maxTokens,
    loaded,
    applyPreset,
    getModelConfig,
    save,
    load,
    testConnection
  }
})
