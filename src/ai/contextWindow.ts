/**
 * 模型上下文窗口自动推断
 * 按 provider + model 名推断,用户可在设置中覆盖
 * 维护常见模型的窗口大小映射表
 */

/** 已知模型的上下文窗口大小(token) */
const CONTEXT_WINDOW_MAP: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'o1': 200000,
  'o1-mini': 128000,
  'o3-mini': 200000,
  // DeepSeek
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
  // 通义千问
  'qwen-plus': 131072,
  'qwen-turbo': 131072,
  'qwen-max': 32768,
  'qwen-long': 1000000,
  // 智谱
  'glm-4': 131072,
  'glm-4-flash': 131072,
  'glm-4-air': 131072,
  // Ollama 常见本地模型
  'llama3': 8192,
  'llama3.1': 131072,
  'qwen2': 32768,
  'mistral': 32768,
}

/** 默认上下文窗口(未知模型兜底) */
const DEFAULT_CONTEXT_WINDOW = 32768

/**
 * 按 provider + model 名推断上下文窗口大小
 * @param provider 提供商标识(openai/deepseek/qwen/zhipu/ollama/custom)
 * @param model 模型名
 * @returns 上下文窗口 token 数
 */
export function inferContextWindow(provider?: string, model?: string): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW

  // 1. 精确匹配
  if (CONTEXT_WINDOW_MAP[model]) return CONTEXT_WINDOW_MAP[model]

  // 2. 模糊匹配(模型名包含 key,如 "deepseek-chat-v3" 匹配 "deepseek-chat")
  for (const [key, size] of Object.entries(CONTEXT_WINDOW_MAP)) {
    if (model.includes(key)) return size
  }

  // 3. 按 provider 兜底(给一个保守值)
  switch (provider) {
    case 'openai': return 128000
    case 'deepseek': return 64000
    case 'qwen': return 131072
    case 'zhipu': return 131072
    case 'ollama': return 8192 // 本地模型通常较小,保守取 8k
    default: return DEFAULT_CONTEXT_WINDOW
  }
}

/**
 * 获取有效上下文窗口:优先用用户配置,其次自动推断
 * @param userOverride 用户在设置中手动填写的值(可选)
 * @param provider 提供商
 * @param model 模型名
 */
export function getEffectiveContextWindow(
  userOverride?: number,
  provider?: string,
  model?: string,
): number {
  if (typeof userOverride === 'number' && userOverride > 0) return userOverride
  return inferContextWindow(provider, model)
}
