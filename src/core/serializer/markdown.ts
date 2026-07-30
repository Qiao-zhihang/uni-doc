/**
 * Markdown 序列化与反序列化
 * 参考 PRD §11.4(Markdown 序列化)和 §7.2(扩展 Markdown 规则)
 *
 * 扩展语法:`---page---` 为分页标记
 * 支持 Block 类型:paragraph / heading / list / divider / page_break / quote / code_block / table
 * 支持行内样式:粗体 / 斜体 / 删除线 / 代码 / 下划线 / 链接 / 图片 / 高亮
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
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
  ListType,
  Mark,
  ParagraphContent,
  QuoteContent,
  TableContent,
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
  createImageBlock,
  uuid,
} from '../blocks/factory'
import { parseInlineMarkdown } from '../parser/inlineMarkdown'
import { marksToSource } from '@/components/blocks/marks'

const PAGE_BREAK = '---page---'
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
      const q = block.content as QuoteContent
      // 如果有内部块级内容,递归序列化并加 > 前缀
      if (q.blocks && q.blocks.length > 0) {
        return q.blocks
          .map((b) => serializeBlock(b))
          .filter((s) => s !== '')
          .map((s) =>
            s
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n'),
          )
          .join('\n')
      }
      const { text = '', marks = [] } = q
      const source = marksToSource(text, marks)
      return source
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
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
      const dividerLine = `| ${headers
        .map((_, i) => {
          const a = aligns[i]
          if (a === 'left') return ':---'
          if (a === 'center') return ':---:'
          if (a === 'right') return '---:'
          return '---'
        })
        .join(' | ')} |`
      const rowLines = rows.map(
        (r) => `| ${r.map((c) => marksToSource(c.text, c.marks)).join(' | ')} |`,
      )
      return [headerLine, dividerLine, ...rowLines].join('\n')
    }
    case 'list': {
      const { items = [] } = block.content as ListContent
      const props = block.props as ListProps
      const listType = props.listType
      const start = props.start ?? 1
      return items
        .map((item, idx) => {
          const body = marksToSource(item.text, item.marks)
          let line: string
          let prefixLen: number
          if (listType === 'ordered') {
            const num = start + idx
            line = `${num}. ${body}`
            prefixLen = `${num}. `.length
          } else if (listType === 'task') {
            line = `- [${item.checked ? 'x' : ' '}] ${body}`
            prefixLen = 6
          } else {
            line = `- ${body}`
            prefixLen = 2
          }
          // 嵌套子块:缩进到列表内容起始列(CommonMark 要求)
          if (item.children && item.children.length > 0) {
            const indent = ' '.repeat(prefixLen)
            const childMd = item.children
              .map((c) => serializeBlock(c))
              .filter((s) => s !== '')
              .map((s) =>
                s
                  .split('\n')
                  .map((l) => `${indent}${l}`)
                  .join('\n'),
              )
              .join('\n')
            return `${line}\n${childMd}`
          }
          return line
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
      // Obsidian 嵌入语法:![[]],扩展三段式 ![[src|width|alt]] 保留 alt
      // 无 alt 时省略第三段,保持与旧版 ![[src|width]] 兼容
      if (width && width > 0) {
        return alt ? `![[${src}|${width}|${alt}]]` : `![[${src}|${width}]]`
      }
      // 无宽度:用标准 ![](src) 保留 alt,兼容性更好
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

/** YAML 字符串转义(简单处理:含特殊字符或行首 -? 时加双引号) */
function escapeYaml(value: string): string {
  // 行首 - 或 ? 会被 YAML 解析为列表项或映射键,需加引号
  if (/[:\[\]{}&*!|>'"%@`#?,]/.test(value) || /^[-?]/.test(value) || value.includes('\n')) {
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
  const body = lines
    .slice(endIdx + 1)
    .join('\n')
    .replace(/^\n+/, '')
  return { meta, body }
}

/* ============== 反序列化:markdown → blocks ============== */

/** 从 mdast 节点的 position 信息切取源文本片段 */
function sliceSource(
  source: string,
  pos: { start: { offset: number }; end: { offset: number } } | undefined,
): string {
  if (!pos) return ''
  return source.slice(pos.start.offset, pos.end.offset)
}

/** 从 paragraph/heading 的 phrasing 内容中提取纯文本 + marks
 *  策略:用 position 切源文本,再交给 parseInlineMarkdown 处理
 */
function extractInline(
  source: string,
  node: { position?: { start: { offset: number }; end: { offset: number } } },
  stripPrefix = 0,
): { text: string; marks: Mark[] } {
  let raw = sliceSource(source, node.position)
  if (stripPrefix > 0) raw = raw.slice(stripPrefix)
  return parseInlineMarkdown(raw)
}

/** 检测一段文本是否全是表格行（用于 mdast→表格 的回退处理） */
function isTableText(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  return lines.length >= 2 && lines.every((l) => /^\|.+\|$/.test(l.trim()))
}

/** 从文本中解析表格（复用原有逻辑） */
function parseTableFromText(text: string): Block | null {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) return null
  const dividerLine = lines[1]
  const dividerCells = dividerLine
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
  const isDivider = dividerCells.every((c) => /^:?-{3,}:?$/.test(c))
  if (!isDivider) return null
  const aligns = dividerCells.map((c): ColumnAlign => {
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
  const headers = lines[0]
    .split('|')
    .slice(1, -1)
    .map((c) => parseInlineMarkdown(c.trim()))
  const rows = lines.slice(2).map((row) =>
    row
      .split('|')
      .slice(1, -1)
      .map((c) => parseInlineMarkdown(c.trim())),
  )
  return createTableBlock(headers, rows, aligns)
}

/** 检测单个 paragraph 是否为单独一行的 Obsidian 图片 */
function parseObsidianImage(text: string): Block | null {
  const m = text.trim().match(/^!\[\[([^\]|]+)(?:\|(\d+)(?:x\d+)?)?(?:\|([^\]]*))?\]\]\s*$/)
  if (!m) return null
  const src = m[1]
  const width = m[2] ? Number(m[2]) : undefined
  const alt = m[3] ?? ''
  return createImageBlock(src, alt, width ? { width } : {})
}

/** 将 mdast 节点数组转换为 unidoc blocks（核心递归函数） */
function convertNodes(source: string, nodes: any[]): Block[] {
  const result: Block[] = []
  for (const node of nodes) {
    const converted = convertNode(source, node)
    if (Array.isArray(converted)) {
      result.push(...converted)
    } else if (converted) {
      result.push(converted)
    }
  }
  return result
}

/** 转换单个 mdast 节点 → 0 个或多个 unidoc blocks */
function convertNode(source: string, node: any): Block | Block[] | null {
  switch (node.type) {
    case 'thematicBreak':
      return createDividerBlock()

    case 'heading': {
      const level = node.depth as HeadingProps['level']
      // 去掉 "# " 前缀:level + 1(空格)
      const prefixLen = level + 1
      const { text, marks } = extractInline(source, node, prefixLen)
      const block = createHeadingBlock(text, level)
      block.content.marks = marks
      return block
    }

    case 'code': {
      const lang = node.lang || 'plaintext'
      return createCodeBlockBlock(node.value || '', lang)
    }

    case 'image': {
      return createImageBlock(node.url || '', node.alt || '')
    }

    case 'list': {
      return convertList(source, node)
    }

    case 'blockquote': {
      const innerBlocks = convertNodes(source, node.children || [])
      if (innerBlocks.length === 0) return null
      // 如果只有一个 paragraph,沿用旧格式(text+marks),否则用 blocks
      if (innerBlocks.length === 1 && innerBlocks[0].type === 'paragraph') {
        const para = innerBlocks[0].content as ParagraphContent
        const block = createQuoteBlock(para.text)
        block.content.marks = para.marks
        return block
      }
      const block = createQuoteBlock('')
      block.content = { text: '', marks: [], blocks: innerBlocks }
      return block
    }

    case 'paragraph': {
      const raw = sliceSource(source, node.position).trim()

      // ---page--- 分页标记
      if (raw === PAGE_BREAK) {
        return createPageBreakBlock()
      }

      // Obsidian 图片（单独一行）
      const img = parseObsidianImage(raw)
      if (img) return img

      // 标准 md 图片（单独一行）: ![alt](src)
      const stdImgMatch = raw.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
      if (stdImgMatch) {
        return createImageBlock(stdImgMatch[2], stdImgMatch[1])
      }

      // 表格:段落文本是多行的管道表格
      if (isTableText(raw)) {
        const table = parseTableFromText(raw)
        if (table) return table
      }

      // 普通段落：CommonMark 规定段落内换行合并为空格
      const { text, marks } = parseInlineMarkdown(raw.replace(/\n/g, ' '))
      const block = createParagraphBlock(text)
      block.content.marks = marks
      return block
    }

    case 'html': {
      // HTML 块:作为段落处理（交给 parseInlineMarkdown 解析其中的 HTML 标签）
      const { text, marks } = parseInlineMarkdown(node.value || '')
      const block = createParagraphBlock(text)
      block.content.marks = marks
      return block
    }

    default:
      return null
  }
}

/** 转换 mdast list 节点 → unidoc list block（支持嵌套） */
function convertList(source: string, node: any): Block {
  const listType: ListType = node.ordered ? 'ordered' : 'bullet'
  const items: ListItem[] = []

  for (const li of node.children || []) {
    items.push(convertListItem(source, li, listType))
  }

  // 检测是否为任务列表:任一 item 有 checked 属性即为任务列表
  const isTask = items.some((it) => it.checked !== undefined)
  const finalListType: ListType = isTask ? 'task' : listType

  // 直接构建 block,避免 createListBlock 丢弃 children/start
  const block = createListBlock(
    items.map((it) => ({ text: it.text, marks: it.marks, checked: it.checked })),
    finalListType,
  )
  // 始终保留有序列表起始号(即使为 1,确保往返一致)
  if (finalListType === 'ordered' && typeof node.start === 'number') {
    ;(block.props as ListProps).start = node.start
  }
  // 回填 children(createListBlock 会生成新 id,需对齐)
  const createdItems = (block.content as ListContent).items
  for (let i = 0; i < createdItems.length && i < items.length; i++) {
    const item = items[i]
    const createdItem = createdItems[i]
    if (item && createdItem && item.children && item.children.length > 0) {
      createdItem.children = item.children
    }
  }
  return block
}

/** 转换单个 mdast listItem → unidoc ListItem */
function convertListItem(source: string, node: any, _parentListType: ListType): ListItem {
  const children = node.children || []
  let text = ''
  let marks: Mark[] = []
  let checked: boolean | undefined = undefined
  const nestedBlocks: Block[] = []

  for (const child of children) {
    if (child.type === 'paragraph') {
      // 列表项的第一个段落就是项文本
      if (text === '') {
        const raw = sliceSource(source, child.position).trim()
        // mdast 默认不支持 GFM 任务列表，paragraph raw 会残留 [x]/[ ] 前缀
        const taskMatch = raw.match(/^\[([ xX])\]\s*(.*)/)
        if (taskMatch) {
          const parsed = parseInlineMarkdown(taskMatch[2].replace(/\n/g, ' '))
          text = parsed.text
          marks = parsed.marks
          checked = taskMatch[1].toLowerCase() === 'x'
        } else {
          const parsed = parseInlineMarkdown(raw.replace(/\n/g, ' '))
          text = parsed.text
          marks = parsed.marks
        }
      } else {
        // 后续段落作为嵌套块
        const { text: t, marks: m } = parseInlineMarkdown(
          sliceSource(source, child.position).trim().replace(/\n/g, ' '),
        )
        const p = createParagraphBlock(t)
        p.content.marks = m
        nestedBlocks.push(p)
      }
    } else if (child.type === 'list') {
      nestedBlocks.push(convertList(source, child))
    } else {
      // 其他块级内容（代码块、引用等）也作为嵌套块
      const converted = convertNode(source, child)
      if (converted) {
        if (Array.isArray(converted)) nestedBlocks.push(...converted)
        else nestedBlocks.push(converted)
      }
    }
  }

  // mdast 的 checked 属性（如果有 GFM 插件支持）
  if (checked === undefined && node.checked !== null && node.checked !== undefined) {
    checked = node.checked
  }

  const item: ListItem = {
    id: uuid(),
    text,
    marks,
  }
  if (checked !== undefined) item.checked = checked
  if (nestedBlocks.length > 0) item.children = nestedBlocks
  return item
}

/** 预处理中文标点有序列表:将 "1、A" "1）A" 转为 "1. A"
 *  CommonMark 只认 "." 和 ")" 作为有序列表标记,中文顿号/全角右括号不被识别
 */
function preprocessChineseList(md: string): string {
  return md.replace(/^(\d+)[、）]\s*/gm, '$1. ')
}

/** 反序列化 Markdown 字符串为 blocks 数组
 *  使用 mdast-util-from-markdown 做块级 AST 解析,行内样式复用 parseInlineMarkdown
 */
export function deserializeMarkdown(markdown: string): Block[] {
  // 空文档直接返回
  if (!markdown || markdown.trim() === '') return []

  // 预处理中文标点(必须在 mdast 解析前,position offset 基于预处理后文本)
  const preprocessed = preprocessChineseList(markdown)

  // mdast 解析（position 默认开启,便于从源文本切取行内原始 markdown）
  const tree = fromMarkdown(preprocessed)

  // 递归转换
  return convertNodes(preprocessed, tree.children as any[])
}
