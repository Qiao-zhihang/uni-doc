/**
 * Markdown 序列化与反序列化
 * 参考 PRD §11.4(Markdown 序列化)和 §7.2(扩展 Markdown 规则)
 *
 * 扩展语法:`---page---` 为分页标记
 * 支持 Block 类型:paragraph / heading / list / divider / page_break / quote / code_block / table
 * 支持行内样式:粗体 / 斜体 / 删除线 / 代码 / 下划线 / 链接 / 图片 / 高亮
 */

import type {
  Block,
  CodeBlockContent,
  CodeBlockProps,
  ColumnAlign,
  DocumentMeta,
  HeadingProps,
  ImageContent,
  ImageProps,
  ListContent,
  ListItem,
  ListProps,
  ParagraphContent,
  QuoteContent,
  TableContent
} from '../blocks/types'
import {
  createParagraphBlock,
  createHeadingBlock,
  createListBlock,
  createDividerBlock,
  createPageBreakBlock,
  createQuoteBlock,
  createCodeBlockBlock,
  createTableBlock,
  createImageBlock
} from '../blocks/factory'
import { parseInlineMarkdown } from '../parser/inlineMarkdown'
import { marksToSource } from '@/components/blocks/marks'

/** 列表项前缀标记 */
const BULLET_RE = /^[-*+]\s+(.*)$/
const ORDERED_RE = /^\d+\.\s+(.*)$/
const TASK_RE = /^[-*+]\s+\[([ xX])\]\s+(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const PAGE_BREAK = '---page---'
const DIVIDER_RE = /^---+$/
const FRONTMATTER_DELIM = '---'

/* ============== 行内标记(Mark)处理 ============== */

/* ============== 序列化:blocks → markdown ============== */

/** 序列化单个 Block 为 Markdown 行(可能多行) */
function serializeBlock(block: Block): string {
  switch (block.type) {
    case 'heading': {
      const { text = '', marks = [] } = block.content as ParagraphContent
      const level = (block.props as HeadingProps).level
      const prefix = '#'.repeat(level)
      return `${prefix} ${marksToSource(text, marks)}`
    }
    case 'paragraph': {
      const { text = '', marks = [] } = block.content as ParagraphContent
      return marksToSource(text, marks)
    }
    case 'quote': {
      const { text = '', marks = [] } = block.content as QuoteContent
      return `> ${marksToSource(text, marks)}`
    }
    case 'code_block': {
      const { code = '' } = block.content as CodeBlockContent
      const lang = (block.props as CodeBlockProps).language ?? ''
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }
    case 'table': {
      const { headers = [], rows = [], aligns = [] } = block.content as TableContent
      if (!headers.length) return ''
      const headerLine = `| ${headers.map((c) => marksToSource(c.text, c.marks)).join(' | ')} |`
      const dividerLine = `| ${headers.map((_, i) => {
        const a = aligns[i]
        if (a === 'left') return ':---'
        if (a === 'center') return ':---:'
        if (a === 'right') return '---:'
        return '---'
      }).join(' | ')} |`
      const rowLines = rows.map(
        (r) => `| ${r.map((c) => marksToSource(c.text, c.marks)).join(' | ')} |`
      )
      return [headerLine, dividerLine, ...rowLines].join('\n')
    }
    case 'list': {
      const { items = [] } = block.content as ListContent
      const { listType } = block.props as ListProps
      return items
        .map((item, idx) => {
          const body = marksToSource(item.text, item.marks)
          if (listType === 'ordered') {
            return `${idx + 1}. ${body}`
          }
          if (listType === 'task') {
            return `- [${item.checked ? 'x' : ' '}] ${body}`
          }
          return `- ${body}`
        })
        .join('\n')
    }
    case 'divider':
      return '---'
    case 'page_break':
      return PAGE_BREAK
    case 'image': {
      const { src = '', alt = '' } = block.content as ImageContent
      const props = block.props as ImageProps
      const width = props.width
      // Obsidian 语法:![[]] 嵌入,| 后跟宽度(像素)
      // 无宽度时也用 ![[]] 保持一致性,alt 信息丢失(Obsidian wikilink 不支持 alt)
      if (width && width > 0) {
        return `![[${src}|${width}]]`
      }
      // 无宽度:优先用标准 ![](src) 保留 alt,兼容性更好
      return `![${alt}](${src})`
    }
    default:
      return ''
  }
}

/** blocks 数组 → Markdown 字符串 */
export function serializeMarkdown(blocks: Block[]): string {
  return blocks
    .map((block) => serializeBlock(block))
    .filter((line) => line !== '')
    .join('\n\n')
}

/* ============== Frontmatter(YAML)支持 ============== */

/** 将 meta 序列化为 YAML frontmatter 字符串(不含首尾分隔符行) */
function serializeMetaToYaml(meta: DocumentMeta): string {
  const lines: string[] = []
  if (meta.title) lines.push(`title: ${escapeYaml(meta.title)}`)
  if (meta.author) lines.push(`author: ${escapeYaml(meta.author)}`)
  if (meta.version) lines.push(`version: ${escapeYaml(meta.version)}`)
  if (meta.created_at) lines.push(`created_at: ${escapeYaml(meta.created_at)}`)
  if (meta.updated_at) lines.push(`updated_at: ${escapeYaml(meta.updated_at)}`)
  if (meta.tags && meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map((t) => escapeYaml(t)).join(', ')}]`)
  }
  return lines.join('\n')
}

/** YAML 字符串转义(简单处理:含特殊字符时加双引号) */
function escapeYaml(value: string): string {
  if (/[:\[\]{}&*!|>'"%@`#?,]/.test(value) || value.includes('\n')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

/** 简易 YAML 值解析(支持字符串、数组、数字) */
function parseYamlValue(raw: string): string | string[] {
  const trimmed = raw.trim()
  // 数组 [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((s) => unquoteYaml(s.trim()))
  }
  return unquoteYaml(trimmed)
}

/** 去除 YAML 字符串的引号 */
function unquoteYaml(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1)
    return s.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner
  }
  return s
}

/** 序列化 blocks + meta → 含 frontmatter 的 Markdown */
export function serializeMarkdownWithMeta(blocks: Block[], meta: DocumentMeta): string {
  const body = serializeMarkdown(blocks)
  const yaml = serializeMetaToYaml(meta)
  if (!yaml) return body
  return `${FRONTMATTER_DELIM}\n${yaml}\n${FRONTMATTER_DELIM}\n\n${body}`
}

/** 解析 markdown,分离 frontmatter 与正文 */
export function parseFrontmatter(markdown: string): {
  meta: Partial<DocumentMeta> | null
  body: string
} {
  const lines = markdown.split(/\r?\n/)
  // 必须以 --- 开头且至少 4 行(---、字段、---、空行)
  if (lines.length < 4 || lines[0].trim() !== FRONTMATTER_DELIM) {
    return { meta: null, body: markdown }
  }
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIM) {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return { meta: null, body: markdown }

  const yamlLines = lines.slice(1, endIdx)
  const meta: Partial<DocumentMeta> = {}
  for (const line of yamlLines) {
    const match = line.match(/^(\w+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const value = parseYamlValue(match[2])
    if (key === 'title') meta.title = String(value)
    else if (key === 'author') meta.author = String(value)
    else if (key === 'version') meta.version = String(value)
    else if (key === 'created_at') meta.created_at = String(value)
    else if (key === 'updated_at') meta.updated_at = String(value)
    else if (key === 'tags') {
      meta.tags = Array.isArray(value) ? value : [value]
    }
  }
  const body = lines.slice(endIdx + 1).join('\n').replace(/^\n+/, '')
  return { meta, body }
}

/* ============== 反序列化:markdown → blocks ============== */

/** 反序列化 Markdown 字符串为 blocks 数组 */
export function deserializeMarkdown(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 跳过空行
    if (line.trim() === '') {
      i++
      continue
    }

    // HTML 块级标签:多行 HTML(<details>/<table>/<div> 等)
    // 匹配 <tag> 或 <tag attrs> 或 <tag>同行内容</tag>
    const htmlBlockStart = line.match(/^<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>(.*)$/)
    if (htmlBlockStart) {
      const tag = htmlBlockStart[1].toLowerCase()
      const restLine = htmlBlockStart[3] || ''
      // 只处理块级标签(行内标签走普通段落解析)
      const blockTags = new Set([
        'div', 'details', 'summary', 'table', 'thead', 'tbody', 'tfoot',
        'tr', 'td', 'th', 'caption', 'colgroup', 'figure', 'figcaption',
        'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
        'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
        'p', 'center', 'form', 'fieldset'
      ])
      if (blockTags.has(tag)) {
        const closeTag = `</${tag}>`
        // 检查同行是否已闭合(单行 HTML 块)
        const sameLineClose = restLine.includes(closeTag)
        if (sameLineClose) {
          // 单行 HTML 块:<tag>...</tag>
          const parsed = parseInlineMarkdown(line)
          const block = createParagraphBlock(parsed.text)
          block.content = { text: parsed.text, marks: parsed.marks }
          blocks.push(block)
          i++
          continue
        }
        // 多行 HTML 块:收集到闭合标签
        const collected: string[] = [line]
        let depth = 1
        let j = i + 1
        while (j < lines.length) {
          const l = lines[j]
          const openRegex = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')
          const closeRegex = new RegExp(`</${tag}>`, 'gi')
          const opens = (l.match(openRegex) || []).length
          const closes = (l.match(closeRegex) || []).length
          depth += opens - closes
          collected.push(l)
          j++
          if (depth <= 0) break
        }
        const htmlContent = collected.join('\n')
        const parsed = parseInlineMarkdown(htmlContent)
        const block = createParagraphBlock(parsed.text)
        block.content = { text: parsed.text, marks: parsed.marks }
        blocks.push(block)
        i = j
        continue
      }
    }

    // 分页标记
    if (line.trim() === PAGE_BREAK) {
      blocks.push(createPageBreakBlock())
      i++
      continue
    }

    // 代码块: ```lang ... ```
    const codeFenceStart = line.match(/^```(\w*)/)
    if (codeFenceStart) {
      const lang = codeFenceStart[1] || 'plaintext'
      i++
      const codeLines: string[] = []
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过结束 ```
      blocks.push(createCodeBlockBlock(codeLines.join('\n'), lang))
      continue
    }

    // 缩进代码块: 4 空格或 1 tab 缩进(CommonMark)
    // 注意: 需前有一空行或文档开头,且不是列表项
    if (/^( {4}|\t)/.test(line) && line.trim() !== '') {
      // 简单起见,连续的缩进行都算代码块
      const codeLines: string[] = []
      while (i < lines.length && /^( {4}|\t)/.test(lines[i])) {
        codeLines.push(lines[i].replace(/^( {4}|\t)/, ''))
        i++
      }
      if (codeLines.length > 0) {
        blocks.push(createCodeBlockBlock(codeLines.join('\n'), 'plaintext'))
      }
      continue
    }

    // 表格: | a | b | \n |---|---| \n | 1 | 2 |
    if (line.match(/^\|.+\|$/)) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].match(/^\|.+\|$/)) {
        tableLines.push(lines[i])
        i++
      }
      if (tableLines.length >= 2) {
        const dividerLine = tableLines[1]
        const dividerCells = dividerLine.split('|').slice(1, -1).map((c) => c.trim())
        // 判断分隔行是否为有效的表格分隔符(包含 ---)
        const isDivider = dividerCells.every((c) => /^:?-{3,}:?$/.test(c))
        if (isDivider) {
          const aligns = dividerCells.map((c): ColumnAlign => {
            const left = c.startsWith(':')
            const right = c.endsWith(':')
            if (left && right) return 'center'
            if (right) return 'right'
            return 'left'
          })
          const headers = tableLines[0]
            .split('|')
            .slice(1, -1)
            .map((c) => parseInlineMarkdown(c.trim()))
          const rows = tableLines.slice(2).map((row) =>
            row
              .split('|')
              .slice(1, -1)
              .map((c) => parseInlineMarkdown(c.trim()))
          )
          blocks.push(createTableBlock(headers, rows, aligns))
        }
      }
      continue
    }

    // Setext 标题: 上一行是文本 + 下一行 === 或 ---
    // 注意: 必须在分隔线判断之前处理,因为 --- 既是分隔线也是 Setext H2
    const setextMatch = line.match(/^(={3,}|-{3,})\s*$/)
    if (setextMatch && blocks.length > 0) {
      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock.type === 'paragraph' && (lastBlock.content as ParagraphContent).text.trim() !== '') {
        const level = setextMatch[1].startsWith('=') ? 1 : 2
        const text = (lastBlock.content as ParagraphContent).text
        const marks = (lastBlock.content as ParagraphContent).marks ?? []
        blocks.pop()
        const heading = createHeadingBlock(text, level as 1 | 2)
        heading.content.marks = marks
        blocks.push(heading)
        i++
        continue
      }
    }

    // 分隔线(三个或更多连字符,但不是 ---page---)
    if (DIVIDER_RE.test(line.trim())) {
      blocks.push(createDividerBlock())
      i++
      continue
    }

    // 图片(Obsidian 嵌入语法): ![[src|width]] 或 ![[src|widthxheight]] 或 ![[src]]
    const obsidianImageMatch = line.match(/^!\[\[([^\]|]+)(?:\|(\d+)(?:x\d+)?)?\]\]\s*$/)
    if (obsidianImageMatch) {
      const src = obsidianImageMatch[1]
      const width = obsidianImageMatch[2] ? Number(obsidianImageMatch[2]) : undefined
      blocks.push(createImageBlock(src, '', width ? { width } : {}))
      i++
      continue
    }

    // 图片(标准 md): ![alt](src)
    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (imageMatch) {
      blocks.push(createImageBlock(imageMatch[2], imageMatch[1]))
      i++
      continue
    }

    // 标题
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      const level = headingMatch[1].length as HeadingProps['level']
      const { text, marks } = parseInlineMarkdown(headingMatch[2])
      const block = createHeadingBlock(text, level)
      block.content.marks = marks
      blocks.push(block)
      i++
      continue
    }

    // 引用: > text（支持多层嵌套,如 > > text,扁平化处理）
    const quoteMatch = line.match(/^(?:>\s+)+/)
    if (quoteMatch) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].match(/^(?:>\s+)+/)) {
        quoteLines.push(lines[i].replace(/^(?:>\s+)+/, ''))
        i++
      }
      const { text, marks } = parseInlineMarkdown(quoteLines.join(' '))
      const block = createQuoteBlock(text)
      ;(block.content as QuoteContent).marks = marks
      blocks.push(block)
      continue
    }

    // 任务列表项
    const taskMatch = line.match(TASK_RE)
    if (taskMatch) {
      const items: ListItem[] = []
      while (i < lines.length) {
        const tm = lines[i].match(TASK_RE)
        if (!tm) break
        const parsed = parseInlineMarkdown(tm[2])
        items.push({
          id: crypto.randomUUID(),
          text: parsed.text,
          marks: parsed.marks,
          checked: tm[1].toLowerCase() === 'x'
        })
        i++
      }
      blocks.push(
        createListBlock(
          items.map((it) => ({ text: it.text, marks: it.marks, checked: it.checked })),
          'task'
        )
      )
      continue
    }

    // 无序列表项
    const bulletMatch = line.match(BULLET_RE)
    if (bulletMatch) {
      const items: ListItem[] = []
      while (i < lines.length) {
        const bm = lines[i].match(BULLET_RE)
        if (!bm) break
        const parsed = parseInlineMarkdown(bm[1])
        items.push({ id: crypto.randomUUID(), text: parsed.text, marks: parsed.marks })
        i++
      }
      blocks.push(
        createListBlock(items.map((it) => ({ text: it.text, marks: it.marks })), 'bullet')
      )
      continue
    }

    // 有序列表项
    const orderedMatch = line.match(ORDERED_RE)
    if (orderedMatch) {
      const items: ListItem[] = []
      while (i < lines.length) {
        const om = lines[i].match(ORDERED_RE)
        if (!om) break
        const parsed = parseInlineMarkdown(om[1])
        items.push({ id: crypto.randomUUID(), text: parsed.text, marks: parsed.marks })
        i++
      }
      blocks.push(
        createListBlock(items.map((it) => ({ text: it.text, marks: it.marks })), 'ordered')
      )
      continue
    }

    // 段落:连续非空、非特殊语法的行合并为一段
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      lines[i].trim() !== PAGE_BREAK &&
      !lines[i].startsWith('```') &&
      !lines[i].match(/^\|.+\|$/) &&
      !DIVIDER_RE.test(lines[i].trim()) &&
      !HEADING_RE.test(lines[i]) &&
      !lines[i].match(/^>\s+/) &&
      !BULLET_RE.test(lines[i]) &&
      !ORDERED_RE.test(lines[i]) &&
      !TASK_RE.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length) {
      const { text, marks } = parseInlineMarkdown(paraLines.join(' '))
      const block = createParagraphBlock(text)
      ;(block.content as ParagraphContent).marks = marks
      blocks.push(block)
    }
  }

  return blocks
}
