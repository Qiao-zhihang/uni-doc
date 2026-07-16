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
}

export interface AgentContextBlock {
  id: string
  type: string
  preview: string
}

export interface AgentContext {
  documentName: string
  visibleBlocks: AgentContextBlock[]
  selectedBlock: AgentContextBlock | null
  selectedText: string
}

export interface StreamCallbacks {
  onDelta?: (text: string) => void
  onToolCall?: (toolName: string, args: Record<string, unknown>, result: ToolResult) => void
  onError?: (error: string) => void
}
