/**
 * 块级 Markdown 语法检测
 * 检测纯文本行是否包含块级 Markdown 语法，用于自动转换 Block 类型
 */

import type { BlockType } from '../blocks/types'

export interface BlockSyntaxMatch {
  type: BlockType
  strippedText: string
  props?: Record<string, any>
  /** 额外内容（如表格、代码块的多行数据） */
  extra?: Record<string, any>
}

/** 检测块级 Markdown 语法并返回转换信息 */
export function detectBlockSyntax(text: string): BlockSyntaxMatch | null {
  // 任务列表: - [ ] text / - [x] text / * [ ] text
  const taskMatch = text.match(/^[-*]\s+\[([ xX])\]\s+(.*)/)
  if (taskMatch) {
    return {
      type: 'list',
      strippedText: taskMatch[2],
      props: { listType: 'task' },
      extra: { checked: taskMatch[1].toLowerCase() === 'x' }
    }
  }

  // 标题: # text ~ ###### text
  const headingMatch = text.match(/^(#{1,6})\s+(.+)/)
  if (headingMatch) {
    return {
      type: 'heading',
      strippedText: headingMatch[2],
      props: { level: headingMatch[1].length }
    }
  }

  // 分隔线(CommonMark thematic break): 由 - * _ 中任一字符重复 3 次以上组成,字符必须相同
  if (/^([-*_])\1{2,}$/.test(text.trim())) {
    return { type: 'divider', strippedText: '' }
  }

  // 有序列表: 1. text
  const orderedMatch = text.match(/^(\d+)\.\s+(.+)/)
  if (orderedMatch) {
    return {
      type: 'list',
      strippedText: orderedMatch[2],
      props: { listType: 'ordered' }
    }
  }

  // 无序列表: - text / * text
  const bulletMatch = text.match(/^[-*]\s+(.+)/)
  if (bulletMatch) {
    return {
      type: 'list',
      strippedText: bulletMatch[1],
      props: { listType: 'bullet' }
    }
  }

  // 引用: > text
  const quoteMatch = text.match(/^>\s+(.*)/)
  if (quoteMatch) {
    return {
      type: 'quote',
      strippedText: quoteMatch[1]
    }
  }

  // 代码块开始: ```lang
  const codeFenceMatch = text.match(/^```(\w*)/)
  if (codeFenceMatch) {
    return {
      type: 'code_block',
      strippedText: '',
      props: { language: codeFenceMatch[1] || 'plaintext' }
    }
  }

  // 表格: | a | b | 或 | a | b | \n |---|---|
  const tableMatch = text.match(/^\|(.+)\|$/)
  if (tableMatch) {
    const cells = tableMatch[1].split('|').map((c) => c.trim())
    if (cells.length >= 1) {
      return {
        type: 'table',
        strippedText: '',
        extra: { headers: cells }
      }
    }
  }

  return null
}
