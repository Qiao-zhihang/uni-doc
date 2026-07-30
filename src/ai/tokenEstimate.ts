/**
 * Token 估算工具
 * 用字符数估算 token,避免引入 tiktoken 依赖(零依赖,~30 行核心逻辑)
 * 估算规则: 中文 1 字 ≈ 1.5 token, 英文 1 词 ≈ 1.3 token, 数字/标点/空白按 0.5 token
 * 误差 ±15%,对预算管理足够(不需要精确到单 token)
 */

import type { ChatMessage, MessageContent } from './types'

/** 估算单段文本的 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  // 中日韩字符(每个 ≈ 1.5 token)
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  // 英文单词(每个 ≈ 1.3 token)
  const enWords = (text.match(/[a-zA-Z]+/g) || []).length
  // 数字串(每个 ≈ 0.5 token)
  const digits = (text.match(/\d+/g) || []).length
  // 其他字符(标点/空白/符号,每个 ≈ 0.5 token)
  const others = text.length - cjkCount - enWords - digits

  return Math.ceil(cjkCount * 1.5 + enWords * 1.3 + digits * 0.5 + others * 0.5)
}

/** 估算消息内容的 token 数(支持 string 和多模态) */
function estimateContentTokens(content: string | MessageContent[]): number {
  if (typeof content === 'string') return estimateTokens(content)
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (part.type === 'text') return sum + estimateTokens(part.text)
      if (part.type === 'image_url') return sum + 85 // low detail 图片固定 ~85 token
      return sum
    }, 0)
  }
  return 0
}

/** 估算单条消息的 token 数(含 role 标记 + tool_call 元数据开销) */
export function estimateMessageTokens(msg: ChatMessage): number {
  const contentTokens = estimateContentTokens(msg.content)
  // tool_calls 每个约 50 token(函数名+参数 JSON)
  const toolCallOverhead = msg.tool_calls ? msg.tool_calls.length * 50 : 0
  // role 标记固定 ~4 token
  return contentTokens + toolCallOverhead + 4
}

/** 估算消息数组的总 token 数 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}
