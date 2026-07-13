/**
 * UniDoc AI Agent 模块类型定义
 * 参考 PRD AI Agent 模块设计，定义聊天消息、工具调用、模型配置、上下文等核心类型
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: ChatRole
  content: string
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
