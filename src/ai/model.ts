/**
 * UniDoc AI Model 客户端
 * 纯 fetch 实现的 OpenAI 兼容客户端，零第三方依赖（~150 行）
 * 支持 SSE 流式解析与 Function Calling
 */
import type { ChatMessage, ModelConfig, ToolCall } from './types'

/** OpenAI 函数调用工具描述格式 */
interface ToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

/** 流式响应中的 delta 片段 */
interface StreamDelta {
  content?: string
  tool_calls?: Array<{
    index: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

/** 流式聊天完整结果 */
export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
  finishReason: string
}

/** 构造请求体：tools 为空数组时不传 tools 字段 */
function buildBody(
  messages: ChatMessage[],
  tools: ToolSpec[],
  config: ModelConfig,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  }
  if (stream) body.stream = true
  if (tools.length > 0) body.tools = tools
  return body
}

/**
 * 流式聊天：POST /chat/completions，逐 chunk 解析 SSE，返回聚合后的内容与工具调用
 */
export async function streamChat(
  messages: ChatMessage[],
  tools: ToolSpec[],
  config: ModelConfig,
  onDelta?: (text: string) => void
): Promise<StreamResult> {
  let response: Response
  try {
    response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildBody(messages, tools, config, true)),
    })
  } catch (err) {
    throw new Error(`网络错误: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let content = ''
  const toolCalls: ToolCall[] = []
  let finishReason = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // 按 SSE 事件分隔（\n\n），逐 event 处理
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const eventBlock = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)

      for (const line of eventBlock.split('\n')) {
        const clean = line.replace(/\r/g, '')
        if (!clean.startsWith('data: ')) continue
        const data = clean.slice(6)
        if (data === '[DONE]') return { content, toolCalls, finishReason }

        try {
          const json = JSON.parse(data) as { choices?: Array<{ delta?: StreamDelta; finish_reason?: string }> }
          const choice = json.choices?.[0]
          const delta = choice?.delta
          if (choice?.finish_reason) finishReason = choice.finish_reason
          if (!delta) continue

          if (delta.content) {
            content += delta.content
            onDelta?.(delta.content)
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                }
              }
              const slot = toolCalls[tc.index]!
              if (tc.id) slot.id = tc.id
              if (tc.function?.name) slot.function.name = tc.function.name
              if (tc.function?.arguments) slot.function.arguments += tc.function.arguments
            }
          }
        } catch {
          // 忽略无法解析的 chunk
        }
      }
    }
  }

  return { content, toolCalls, finishReason }
}

/**
 * 非流式聊天：POST /chat/completions，一次性返回，供测试连接使用
 */
export async function chat(
  messages: ChatMessage[],
  tools: ToolSpec[],
  config: ModelConfig
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  let response: Response
  try {
    response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildBody(messages, tools, config, false)),
    })
  } catch (err) {
    throw new Error(`网络错误: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string
        tool_calls?: Array<{
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }>
      }
    }>
  }
  const message = json.choices?.[0]?.message
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }))

  return { content: message?.content ?? '', toolCalls }
}
