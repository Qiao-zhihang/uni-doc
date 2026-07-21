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

/** 构造请求体：tools 为空数组时不传 tools 字段；支持原生联网搜索参数 */
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

  // 原生联网搜索参数（优先于 function calling 工具方式）
  if (config.nativeSearch) {
    if (config.provider === 'qwen') {
      // 通义千问：enable_search 开启内置搜索
      body.enable_search = true
    }
    // DeepSeek / OpenAI 搜索模型 / 智谱 等不需要额外参数，模型自带搜索能力
    // 或参数由服务端根据模型自动处理
  }

  return body
}

/**
 * 流式聊天：POST /chat/completions，逐 chunk 解析 SSE，返回聚合后的内容与工具调用
 * 如果 stream 配置为 false 或流式解析失败，自动降级为非流式
 * 支持通过 signal 参数取消请求
 */
export async function streamChat(
  messages: ChatMessage[],
  tools: ToolSpec[],
  config: ModelConfig,
  onDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<StreamResult> {
  const useStream = config.stream !== false

  if (!useStream) {
    const result = await chat(messages, tools, config, signal)
    return { content: result.content, toolCalls: result.toolCalls, finishReason: 'stop' }
  }

  let response: Response
  try {
    response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildBody(messages, tools, config, true)),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw err
    }
    throw new Error(`网络错误: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  // 检查响应是否为 SSE 流
  const contentType = response.headers.get('content-type') || ''
  const isStreamResponse = contentType.includes('text/event-stream') || !!response.body

  if (!isStreamResponse || !response.body) {
    // 非流式响应，直接解析 JSON
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
        finish_reason?: string
      }>
    }
    const message = json.choices?.[0]?.message
    const finishReason = json.choices?.[0]?.finish_reason ?? 'stop'
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }))
    const content = message?.content ?? ''
    if (content && onDelta) onDelta(content)
    return { content, toolCalls, finishReason }
  }

  const reader = response.body.getReader()
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

  // 处理 buffer 中剩余的内容（某些实现可能没有正确的 \n\n 结尾）
  if (buffer.trim().length > 0) {
    for (const line of buffer.split('\n')) {
      const clean = line.replace(/\r/g, '')
      if (!clean.startsWith('data: ')) continue
      const data = clean.slice(6)
      if (data === '[DONE]') break
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

  return { content, toolCalls, finishReason }
}

/**
 * 非流式聊天：POST /chat/completions，一次性返回，供测试连接使用
 * 支持通过 signal 参数取消请求
 */
export async function chat(
  messages: ChatMessage[],
  tools: ToolSpec[],
  config: ModelConfig,
  signal?: AbortSignal
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
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw err
    }
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

/** 公开测试图片 URL（1x1 透明 GIF，体积小加载快），用于 vision 探针 */
const PROBE_IMAGE_URL = 'https://www.baidu.com/img/PCtm_d9c8750bed0b3c7d089fa7d55720d6cf.png'

/** 探针用的 dummy tool，检测 function calling 支持 */
const PROBE_TOOL: ToolSpec = {
  type: 'function',
  function: {
    name: 'echo_test',
    description: 'Echo test for capability detection',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo' } },
      required: ['text'],
    },
  },
}

/**
 * 探针检测模型能力（vision / function calling / nativeSearch）
 * 通过发送真实 API 请求判断，不依赖模型名猜测
 */
export async function probeCapabilities(
  config: ModelConfig
): Promise<{ vision: boolean; webSearch: boolean; nativeSearch: boolean; visionError?: string; webSearchError?: string; nativeSearchError?: string }> {
  // ===== Vision 探针：发送带图片的消息 =====
  let vision = false
  let visionError: string | undefined
  try {
    await chat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图里有什么？用一个词回答' },
            { type: 'image_url', image_url: { url: PROBE_IMAGE_URL, detail: 'low' } },
          ],
        },
      ],
      [],
      config
    )
    vision = true
  } catch (e) {
    visionError = (e as Error).message
    vision = false
  }

  // ===== Function calling 探针：发送带 tools 的请求 =====
  let webSearch = false
  let webSearchError: string | undefined
  try {
    await chat([{ role: 'user', content: 'ping' }], [PROBE_TOOL], config)
    webSearch = true
  } catch (e) {
    webSearchError = (e as Error).message
    webSearch = false
  }

  // ===== 原生联网搜索探针：发送带 enable_search 的请求 =====
  let nativeSearch = false
  let nativeSearchError: string | undefined
  if (config.provider === 'qwen') {
    try {
      await chat([{ role: 'user', content: 'ping' }], [], { ...config, nativeSearch: true })
      nativeSearch = true
    } catch (e) {
      nativeSearchError = (e as Error).message
      nativeSearch = false
    }
  }

  return { vision, webSearch, nativeSearch, visionError, webSearchError, nativeSearchError }
}
