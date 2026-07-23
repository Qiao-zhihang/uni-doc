/**
 * UniDoc AI Agent 模块类型定义
 * 参考 PRD AI Agent 模块设计，定义聊天消息、工具调用、模型配置、上下文等核心类型
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

/** 多模态内容块（用于图片理解等场景） */
export interface TextContent { type: 'text'; text: string }
export interface ImageUrlContent { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
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
}

export interface ToolParameterSchema {
  type: 'object'
  properties: Record<string, {
    type: string
    description?: string
    enum?: string[]
    items?: { type: string }
    default?: unknown
  }>
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
  /** 是否启用流式输出（默认 true） */
  stream?: boolean
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
}

export interface StreamCallbacks {
  onDelta?: (text: string) => void
  onToolCall?: (toolName: string, args: Record<string, unknown>, result: ToolResult) => void
  onError?: (error: string) => void
  onComplete?: () => void
}

// ============ AI 记忆系统类型 ============

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
}

export interface GlobalMemory {
  version: number
  profile: UserProfile
  facts: MemoryFact[]
  updatedAt: number
}

export const DEFAULT_MEMORY: GlobalMemory = {
  version: 1,
  profile: {},
  facts: [],
  updatedAt: 0,
}

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  personal: '个人信息',
  project: '项目背景',
  knowledge: '知识储备',
  preference: '偏好设置',
  other: '其他',
}
