/**
 * UniDoc AI Agent 编排模块
 *
 * 负责多轮对话循环：构建上下文 → 调用模型 → 解析工具调用 → 执行工具 → 把结果回灌给模型，
 * 直至模型不再请求工具或达到最大轮次。
 *
 * Agent 不再自己维护 messages 闭包，改为接收外部传入的 messages 数组（由 conversation store 管理）。
 */

import type { ChatMessage, MessageContent, ModelConfig, StreamCallbacks, ToolCall } from './types'
import { streamChat, type StreamResult } from './model'
import { createTools, getToolDefinitions, executeTool, TOOL_LABELS } from './tools'
import { buildContext, buildSystemPrompt } from './context'
import type { useDocumentStore } from '@/stores/document'
import type { useEditorStore } from '@/stores/editor'

/** 单轮生成最大续推次数（防无限续推） */
const MAX_CONTINUE = 3

/** OpenAI 函数调用工具描述格式（与 model.ts 中的 ToolSpec 一致） */
type ToolSpec = Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>

function formatToolResultForAI(toolName: string, result: { ok: boolean; data?: unknown; error?: string; total?: number }): string {
  if (!result.ok) {
    return `【工具失败】${TOOL_LABELS[toolName] ?? toolName}: ${result.error ?? '未知错误'}`
  }
  const label = TOOL_LABELS[toolName] ?? toolName
  switch (toolName) {
    case 'insert_block': {
      const d = result.data as { blockId: string; type: string; index: number; preview: string }
      return `【插入成功】${label} 类型=${d.type} ID=${d.blockId} 位置=${d.index} 内容预览="${d.preview ?? ''}"`
    }
    case 'update_block': {
      const d = result.data as { blockId: string; type: string; preview: string }
      return `【更新成功】${label} ID=${d.blockId} 类型=${d.type} 修改后预览="${d.preview ?? ''}"`
    }
    case 'delete_block': {
      const d = result.data as { blockId: string }
      return `【删除成功】${label} ID=${d.blockId}`
    }
    case 'move_block': {
      const d = result.data as { blockId: string; direction: string }
      return `【移动成功】${label} ID=${d.blockId} 方向=${d.direction}`
    }
    case 'convert_block': {
      const d = result.data as { blockId: string; type: string }
      return `【转换成功】${label} ID=${d.blockId} 新类型=${d.type}`
    }
    case 'batch_edit': {
      const d = result.data as { total: number; success: number; failed: number }
      return `【批量操作完成】${label} 总计=${d.total} 成功=${d.success} 失败=${d.failed}`
    }
    case 'replace_document': {
      const d = result.data as { blockCount: number }
      return `【替换成功】${label} 区块数=${d.blockCount}`
    }
    case 'list_blocks': {
      const items = (result.data ?? []) as Array<{ id: string; type: string; preview?: string }>
      const total = result.total ?? items.length
      return `【列出区块】共 ${total} 个区块:\n${items.map((b, i) => `${i + 1}. id=${b.id} [${b.type}] ${b.preview ?? ''}`).join('\n')}`
    }
    case 'search_files': {
      const files = (result.data ?? []) as string[]
      return `【搜索结果】找到 ${files.length} 个文件:\n${files.join('\n')}`
    }
    case 'get_document': {
      const text = String(result.data ?? '').slice(0, 5000)
      return `【文档内容】\n${text}`
    }
    case 'get_outline': {
      const items = (result.data ?? []) as Array<{ level: number; text: string }>
      return `【大纲】共 ${items.length} 个条目:\n${items.map((o) => `${'#'.repeat(o.level)} ${o.text}`).join('\n')}`
    }
    case 'read_file': {
      const text = String(result.data ?? '').slice(0, 5000)
      return `【文件内容】\n${text}`
    }
    case 'create_file': {
      const d = result.data as { path: string }
      return `【创建成功】${label} 路径=${d.path}`
    }
    case 'open_file':
      return `【打开成功】${label}`
    case 'switch_tab': {
      const d = result.data as { activeTabId: string }
      return `【切换成功】${label} TabID=${d.activeTabId}`
    }
    case 'get_vault_tree': {
      const items = (result.data ?? []) as Array<{ name: string; path: string; isDir: boolean }>
      return `【文件树】共 ${items.length} 个节点:\n${items.map((n) => `${n.isDir ? '[文件夹]' : '[文件]'} ${n.path}`).join('\n')}`
    }
    case 'web_search': {
      const text = String(result.data ?? '').slice(0, 3000)
      return `【搜索结果】\n${text}`
    }
    default:
      return `【执行完成】${label}`
  }
}

/**
 * 流式聊天 + 自动续写（检测到 finish_reason=length 时自动续推）
 * 返回最终聚合结果
 * 支持通过 signal 参数取消请求
 */
async function streamChatWithContinue(
  messages: ChatMessage[],
  tools: ToolSpec,
  config: ModelConfig,
  onDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<StreamResult> {
  // 用临时消息数组保存状态，避免修改原 messages
  const tempMessages = [...messages]
  let fullContent = ''
  let finalToolCalls: ToolCall[] = []
  let finalFinishReason = ''

  for (let i = 0; i < MAX_CONTINUE; i++) {
    if (signal?.aborted) break
    const result = await streamChat(tempMessages, tools, config, onDelta, signal)
    fullContent += result.content
    finalToolCalls = result.toolCalls
    finalFinishReason = result.finishReason

    // 如果不是因为长度截断，直接返回
    if (result.finishReason !== 'length') break

    // 如果有工具调用且被截断，不续推（工具调用参数不完整）
    if (result.toolCalls.length > 0) break

    // 续推：把当前生成的内容作为 assistant 消息，再请求一次
    tempMessages.push({ role: 'assistant', content: result.content })
    tempMessages.push({ role: 'user', content: '请继续' })
  }

  return { content: fullContent, toolCalls: finalToolCalls, finishReason: finalFinishReason }
}

export interface AgentDeps {
  doc: ReturnType<typeof useDocumentStore>
  editor: ReturnType<typeof useEditorStore>
  /** 返回当前 settings store 的 ModelConfig */
  getConfig: () => ModelConfig
  /** 获取当前画布 DOM 引用的函数 */
  canvasEl: () => HTMLElement | null
  /** 是否启用联网搜索 */
  enableWebSearch: () => boolean
}

export interface Agent {
  /**
   * 执行一轮对话，直接修改传入的 messages 数组（push 消息）
   * 调用方负责持久化
   * 返回一个 AbortController，可用于取消对话
   */
  chat: (messages: ChatMessage[], userInput: string | MessageContent[], callbacks?: StreamCallbacks) => AbortController
}

/** 工具调用最大轮次，超过则强制生成最终回复 */
const MAX_TOOL_ROUNDS = 10

/** 连续相同工具调用的最大次数（防死循环） */
const MAX_CONSECUTIVE_SAME_CALLS = 3

/** 修改文档内容的工具集合,执行后需递增 renderTick 强制 DOM 重新同步 */
const DOC_MODIFYING_TOOLS = new Set([
  'insert_block',
  'update_block',
  'delete_block',
  'move_block',
  'convert_block',
  'batch_edit',
  'replace_document',
])

/**
 * 创建 Agent 实例
 * 不再维护内部 messages 闭包，chat 方法接收外部 messages 数组
 */
export function createAgent(deps: AgentDeps): Agent {
  const { doc, editor, getConfig, canvasEl, enableWebSearch } = deps

  const MAX_CONTEXT_ROUNDS = 30

  function chat(messages: ChatMessage[], userInput: string | MessageContent[], callbacks?: StreamCallbacks): AbortController {
    const abortController = new AbortController()
    const signal = abortController.signal

    ;(async () => {
      try {
        const config = getConfig()
        // 联网搜索总开关由 enableWebSearch 控制（浮窗的「联网」按钮）
        // 开启时：qwen 走原生联网（enable_search），其他模型走 function calling 工具
        const webSearchOn = enableWebSearch()
        const useNativeSearch = webSearchOn && !!config.nativeSearch
        const useToolSearch = webSearchOn && !useNativeSearch
        // 构造运行时配置:把 useNativeSearch 注入到 config,覆盖持久化的探针结果
        // 这样 buildBody 是否注入 enable_search 取决于用户开关,而非仅看探针结果
        // useToolSearch 由 createTools 的工具数组控制,不需要进 ModelConfig
        const runtimeConfig: ModelConfig = { ...config, nativeSearch: useNativeSearch }

        const context = buildContext(doc, editor, canvasEl())
        const systemPrompt = buildSystemPrompt(context, useToolSearch, useNativeSearch)

        // 保留 tool 角色消息，确保 tool_calls 序列完整
        const historyMessages = messages.filter((m) => m.role !== 'system')
        // 截断时不能从 tool 消息中间切断，回退到最近的 user 消息边界
        let truncatedHistory = historyMessages
        if (historyMessages.length > MAX_CONTEXT_ROUNDS * 2) {
          const sliced = historyMessages.slice(-MAX_CONTEXT_ROUNDS * 2)
          // 如果截断后第一条是 tool/assistant(with tool_calls) 消息，向前找到 user 消息边界
          let startIdx = 0
          for (let i = 0; i < sliced.length; i++) {
            if (sliced[i].role === 'user') {
              startIdx = i
              break
            }
          }
          truncatedHistory = sliced.slice(startIdx)
        }

        const contextMessages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...truncatedHistory,
          { role: 'user', content: userInput },
        ]

        messages.push({ role: 'user', content: userInput })

        // 准备工具：内部 ToolDefinition[] 与 OpenAI Function Calling 格式
        const tools = createTools(doc, editor, useToolSearch)
        const toolDefs = getToolDefinitions(tools)

        // 多轮工具调用循环
        let lastCallKey = ''
        let consecutiveSame = 0

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (signal.aborted) break

          // a. 先推入空 assistant 消息到两个数组
          contextMessages.push({ role: 'assistant', content: '', tool_calls: undefined })
          messages.push({ role: 'assistant', content: '', tool_calls: undefined })

          // b. 调用模型流式接口（使用 contextMessages）
          let streamResult: StreamResult
          try {
            streamResult = await streamChatWithContinue(
              contextMessages,
              toolDefs,
              runtimeConfig,
              callbacks?.onDelta,
              signal
            )
          } catch (e) {
            if ((e as Error).name === 'AbortError') {
              break
            }
            throw e
          }

          if (signal.aborted) break

          // c. 用最终结果更新两个数组中的 assistant 消息
          const lastCtxMsg = contextMessages[contextMessages.length - 1]
          lastCtxMsg.content = streamResult.content
          lastCtxMsg.tool_calls = streamResult.toolCalls?.length ? streamResult.toolCalls : undefined

          const lastMsg = messages[messages.length - 1]
          lastMsg.content = streamResult.content
          lastMsg.tool_calls = streamResult.toolCalls?.length ? streamResult.toolCalls : undefined

          // d. 无工具调用则结束循环
          if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) {
            break
          }

          // e. 死循环检测：连续调用完全相同的工具+参数，直接终止
          const callKey = streamResult.toolCalls
            .map((tc) => `${tc.function.name}:${tc.function.arguments}`)
            .join('|')
          if (callKey === lastCallKey) {
            consecutiveSame++
            if (consecutiveSame >= MAX_CONSECUTIVE_SAME_CALLS) {
              callbacks?.onError?.(`检测到工具调用循环 (${streamResult.toolCalls[0].function.name})，已终止`)
              break
            }
          } else {
            consecutiveSame = 0
            lastCallKey = callKey
          }

          // g. 遍历执行所有工具调用
          for (const toolCall of streamResult.toolCalls) {
            if (signal.aborted) break

            const toolName = toolCall.function.name

            // 解析参数（失败用空对象）
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(toolCall.function.arguments)
            } catch {
              args = {}
            }

            // 先回调一次表示"开始调用工具"
            callbacks?.onToolCall?.(toolName, args, { ok: true, data: '__calling__' })

            // 执行工具
            const toolResult = await executeTool(tools, toolName, args)

            // 文档修改类工具执行成功后,递增 renderTick 强制 DOM 重新同步
            if (toolResult.ok && DOC_MODIFYING_TOOLS.has(toolName)) {
              doc.renderTick++
            }

            // 再回调一次表示"工具执行完成"
            callbacks?.onToolCall?.(toolName, args, toolResult)

            // 把结果回灌给模型（同时推入 contextMessages 和 messages）
            const resultText = formatToolResultForAI(toolName, toolResult)
            const toolMsg: ChatMessage = {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: resultText,
            }
            contextMessages.push(toolMsg)
            messages.push(toolMsg)
          }

          if (signal.aborted) break

          // h. 最后一轮了，还有工具调用 → 强制模型生成最终回复（不带 tool_calls）
          if (round === MAX_TOOL_ROUNDS - 1) {
            try {
              const finalResult = await streamChatWithContinue(
                contextMessages,
                [],
                runtimeConfig,
                callbacks?.onDelta,
                signal
              )
              messages.push({
                role: 'assistant',
                content: finalResult.content,
              })
            } catch (e) {
              if ((e as Error).name === 'AbortError') {
                break
              }
              throw e
            }
          }
        }
      } catch (e) {
        // AbortError 不算错误，直接返回
        if ((e as Error).name === 'AbortError') {
          return
        }
        // 任何异常都通过 onError 回调，不向外抛
        callbacks?.onError?.(e instanceof Error ? e.message : String(e))
      } finally {
        callbacks?.onComplete?.()
      }
    })()

    return abortController
  }

  return { chat }
}
