/**
 * UniDoc AI Agent 模块类型定义
 * 参考 PRD AI Agent 模块设计，定义聊天消息、工具调用、模型配置、上下文等核心类型
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

/** 多模态内容块（用于图片理解等场景） */
export interface TextContent {
  type: 'text'
  text: string
}
export interface ImageUrlContent {
  type: 'image_url'
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' }
}
export type MessageContent = TextContent | ImageUrlContent

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: ChatRole
  content: string | MessageContent[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
  /**
   * DeepSeek thinking 模式的思考内容(chain-of-thought)。
   * 官方要求:带 tools 参数的请求中,后续请求必须把每条历史 assistant 消息的
   * reasoning_content 原样回传,缺失会返回 400 invalid_request_error。
   */
  reasoning_content?: string
}

export interface ToolParameterSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: string
      description?: string
      enum?: string[]
      items?: { type: string }
      default?: unknown
    }
  >
  required?: string[]
}

export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: ToolParameterSchema
  execute: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>
}

export interface ModelConfig {
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  maxTokens: number
  /** 提供商标识，用于决定原生联网参数格式 */
  provider?: string
  /** 模型是否支持原生联网搜索（优先使用，不走 function calling） */
  nativeSearch?: boolean
  /** 模型是否支持图片理解（vision） */
  vision?: boolean
  /** 是否启用流式输出（默认 true） */
  stream?: boolean
  /** 模型上下文窗口大小(token)，undefined 时自动推断 */
  contextWindow?: number
}

export interface OpenTabInfo {
  id: string
  title: string
  path: string | null
  blockCount: number
}

export interface AgentContextBlock {
  id: string
  type: string
  preview: string
}

export interface AgentContext {
  documentName: string
  /** 文档在 vault 中的相对路径(如 "folder/文档.md"),无活动文档时为 null */
  documentPath: string | null
  visibleBlocks: AgentContextBlock[]
  selectedBlock: AgentContextBlock | null
  selectedText: string
  /** 所有已打开的 tab 列表(供 AI 感知多文档) */
  openTabs: OpenTabInfo[]
}

export interface StreamCallbacks {
  onDelta?: (text: string) => void
  onToolCall?: (toolName: string, args: Record<string, unknown>, result: ToolResult) => void
  onError?: (error: string) => void
  onComplete?: () => void
}

// ============ AI 记忆系统类型 ============

/** 当前记忆数据 schema 版本。v2 起新增 settings / updatedAt / pinned / enabled / origin */
export const MEMORY_VERSION = 2

export interface UserProfile {
  name?: string
  aliases?: string[]
  writingStyle?: string
  formatPreferences?: string[]
  themes?: string[]
  techStack?: string[]
  notes?: string
}

export type MemoryCategory = 'personal' | 'project' | 'knowledge' | 'preference' | 'other'

/** 记忆来源语义（source 字符串保留兼容旧数据） */
export type MemoryOrigin = 'manual' | 'agent' | 'auto-extract' | 'import'

export interface MemoryFact {
  id: string
  category: MemoryCategory
  content: string
  tags: string[]
  source: string
  createdAt: number
  lastAccessedAt: number
  accessCount: number
  confidence: number
  importance: number
  /** 最后修改时间（v2 起必填） */
  updatedAt?: number
  /** 置顶：注入排序优先、清理与超限淘汰时受保护 */
  pinned?: boolean
  /** 单条停用：不参与注入与检索（数据保留） */
  enabled?: boolean
  /** 来源语义；旧数据可由 source 推导 */
  origin?: MemoryOrigin
  /** 自动提取时的来源会话 id */
  sourceConversationId?: string
}

/** 记忆行为设置（存放在 ai_memory.json 内，随记忆一起导入导出） */
export interface MemorySettings {
  /** 总开关：关闭后不再注入、不再注册记忆工具、不再自动提取（数据保留） */
  enabled: boolean
  /** 会话结束后从对话中自动提取记忆 */
  autoExtract: boolean
  /** 每次提问最多注入几条相关记忆（1-10） */
  maxInjectFacts: number
  /** 单条记忆注入时的最大长度（100-2000） */
  maxFactChars: number
  /** 加载时自动清理低价值记忆（置顶项永不清理） */
  autoCleanup: boolean
}

export interface GlobalMemory {
  version: number
  profile: UserProfile
  facts: MemoryFact[]
  settings: MemorySettings
  updatedAt: number
}

/** 记忆导出文件信封（设置页导出/导入共用） */
export interface MemoryExport {
  format: 'unidoc-ai-memory'
  formatVersion: number
  exportedAt: number
  memory: GlobalMemory
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  autoExtract: true,
  maxInjectFacts: 5,
  maxFactChars: 500,
  autoCleanup: true,
}

export const DEFAULT_MEMORY: GlobalMemory = {
  version: MEMORY_VERSION,
  profile: {},
  facts: [],
  settings: { ...DEFAULT_MEMORY_SETTINGS },
  updatedAt: 0,
}

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  personal: '个人信息',
  project: '项目背景',
  knowledge: '知识储备',
  preference: '偏好设置',
  other: '其他',
}
