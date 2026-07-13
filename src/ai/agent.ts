/**
 * UniDoc AI Agent 编排模块（~200 行）
 *
 * 负责多轮对话循环：构建上下文 → 调用模型 → 解析工具调用 → 执行工具 → 把结果回灌给模型，
 * 直至模型不再请求工具或达到最大轮次（5 次）。对外暴露 createAgent 工厂，返回 chat / clear 两个方法。
 * 参考 PRD AI Agent 模块设计。
 */
import type { ChatMessage, ModelConfig, StreamCallbacks, ToolCall } from './types'
import { streamChat, type StreamResult } from './model'
import { createTools, getToolDefinitions, executeTool } from './tools'
import { buildContext, buildSystemPrompt } from './context'
import type { useDocumentStore } from '@/stores/document'
import type { useEditorStore } from '@/stores/editor'
import { isTauri } from '@/core/serializer/markdownFile'

/** 单轮生成最大续推次数（防无限续推） */
const MAX_CONTINUE = 3

/** 历史消息持久化 key */
const HISTORY_KEY = 'unidoc-ai-history'

/** 动态导入 Tauri invoke,避免 Web 环境下打包报错 */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** 持久化保存对话历史 */
async function saveHistoryToStorage(messages: ChatMessage[]): Promise<void> {
  // 不保存 system 消息，因为每次都会重建
  const toSave = messages.filter((m) => m.role !== 'system')
  const json = JSON.stringify(toSave)
  try {
    if (isTauri()) {
      await tauriInvoke('save_ai_history', { json })
    } else {
      localStorage.setItem(HISTORY_KEY, json)
    }
  } catch (e) {
    console.error('保存AI对话历史失败:', e)
  }
}

/** 从持久化加载对话历史 */
async function loadHistoryFromStorage(): Promise<ChatMessage[]> {
  try {
    let json: string | null = null
    if (isTauri()) {
      const raw = await tauriInvoke<string>('load_ai_history')
      json = raw && raw.length > 0 ? raw : null
    } else {
      json = localStorage.getItem(HISTORY_KEY)
    }
    if (json) {
      return JSON.parse(json) as ChatMessage[]
    }
  } catch (e) {
    console.error('加载AI对话历史失败:', e)
  }
  return []
}

/** 清除持久化的对话历史 */
async function clearHistoryFromStorage(): Promise<void> {
  try {
    if (isTauri()) {
      await tauriInvoke('clear_ai_history')
    } else {
      localStorage.removeItem(HISTORY_KEY)
    }
  } catch (e) {
    console.error('清除AI对话历史失败:', e)
  }
}

/** OpenAI 函数调用工具描述格式（与 model.ts 中的 ToolSpec 一致） */
type ToolSpec = Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>

const TOOL_LABELS: Record<string, string> = {
  get_document: '获取文档',
  get_outline: '获取大纲',
  list_blocks: '列出区块',
  insert_block: '插入区块',
  update_block: '更新区块',
  delete_block: '删除区块',
  move_block: '移动区块',
  convert_block: '转换类型',
  batch_edit: '批量编辑',
  replace_document: '替换文档',
  search_files: '搜索文件',
  read_file: '读取文件',
  create_file: '创建文件',
  open_file: '打开文件',
  get_vault_tree: '获取文件树',
  switch_tab: '切换标签'
}

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
    default:
      return `【执行完成】${label}`
  }
}

/**
 * 流式聊天 + 自动续写（检测到 finish_reason=length 时自动续推）
 * 返回最终聚合结果
 */
async function streamChatWithContinue(
  messages: ChatMessage[],
  tools: ToolSpec,
  config: ModelConfig,
  onDelta?: (text: string) => void
): Promise<StreamResult> {
  // 用临时消息数组保存状态，避免修改原 messages
  const tempMessages = [...messages]
  let fullContent = ''
  let finalToolCalls: ToolCall[] = []
  let finalFinishReason = ''

  for (let i = 0; i < MAX_CONTINUE; i++) {
    const result = await streamChat(tempMessages, tools, config, onDelta)
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
}

export interface Agent {
  chat: (userInput: string, callbacks?: StreamCallbacks) => Promise<void>
  clear: () => Promise<void>
  loadHistory: () => Promise<ChatMessage[]>
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
 * 内部维护 messages 闭包，跨多轮对话持久；clear() 可清空。
 */
export function createAgent(deps: AgentDeps): Agent {
  const { doc, editor, getConfig, canvasEl } = deps
  let messages: ChatMessage[] = []

  async function chat(userInput: string, callbacks?: StreamCallbacks): Promise<void> {
    try {
      // 每次对话都重新构建 system prompt，确保 AI 看到最新文档状态
      // system prompt 始终是 messages[0]，旧的 system 被替换掉
      const context = buildContext(doc, editor, canvasEl())
      const systemPrompt = buildSystemPrompt(context)
      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0] = { role: 'system', content: systemPrompt }
      } else {
        messages.unshift({ role: 'system', content: systemPrompt })
      }

      // 推入用户消息
      messages.push({ role: 'user', content: userInput })

      // 准备工具：内部 ToolDefinition[] 与 OpenAI Function Calling 格式
      const tools = createTools(doc, editor)
      const toolDefs = getToolDefinitions(tools)

      // 多轮工具调用循环
      let lastCallKey = ''
      let consecutiveSame = 0

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // a. 调用模型流式接口（自动处理截断续写）
        const streamResult = await streamChatWithContinue(
          messages,
          toolDefs,
          getConfig(),
          callbacks?.onDelta
        )

        // b. 推入 assistant 消息（含工具调用）
        messages.push({
          role: 'assistant',
          content: streamResult.content,
          tool_calls: streamResult.toolCalls?.length ? streamResult.toolCalls : undefined,
        })

        // c. 无工具调用则结束循环
        if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) {
          break
        }

        // d. 死循环检测：连续调用完全相同的工具+参数，直接终止
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

        // e. 遍历执行所有工具调用
        for (const toolCall of streamResult.toolCalls) {
          const toolName = toolCall.function.name

          // 解析参数（失败用空对象）
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(toolCall.function.arguments)
          } catch {
            args = {}
          }

          // 先回调一次表示"开始调用工具"，UI 可据此先显示"调用工具: xxx"
          callbacks?.onToolCall?.(toolName, args, { ok: true, data: '__calling__' })

          // 执行工具
          const toolResult = await executeTool(tools, toolName, args)

          // 文档修改类工具执行成功后,递增 renderTick 强制 contenteditable DOM 重新同步
          if (toolResult.ok && DOC_MODIFYING_TOOLS.has(toolName)) {
            doc.renderTick++
          }

          // 再回调一次表示"工具执行完成"，UI 据此显示"结果: {摘要}"
          callbacks?.onToolCall?.(toolName, args, toolResult)

          // 把结果回灌给模型（格式化后 AI 更容易理解）
          const resultText = formatToolResultForAI(toolName, toolResult)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultText,
          })
        }

        // f. 最后一轮了，还有工具调用 → 强制模型生成最终回复（不带 tool_calls）
        if (round === MAX_TOOL_ROUNDS - 1) {
          const finalResult = await streamChatWithContinue(
            messages,
            [], // 不传工具定义，强制模型输出文本回复
            getConfig(),
            callbacks?.onDelta
          )
          messages.push({
            role: 'assistant',
            content: finalResult.content,
          })
        }
      }
    } catch (e) {
      // 6. 任何异常都通过 onError 回调，不向外抛
      callbacks?.onError?.(e instanceof Error ? e.message : String(e))
    } finally {
      // 对话结束后自动保存历史
      saveHistoryToStorage(messages)
    }
  }

  /** 从持久化加载历史消息，返回加载的消息数 */
  async function loadHistory(): Promise<ChatMessage[]> {
    const history = await loadHistoryFromStorage()
    if (history.length > 0) {
      messages = history
    }
    return history
  }

  /** 清空内部消息历史 + 清除持久化数据 */
  async function clear(): Promise<void> {
    messages = []
    await clearHistoryFromStorage()
  }

  return { chat, clear, loadHistory }
}
