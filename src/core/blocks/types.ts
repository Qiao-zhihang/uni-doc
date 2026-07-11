/**
 * Block 类型定义
 * 参考 PRD §11.2(Block 类型定义)和 §11.3(Block 元数据结构)
 *
 * M1 实现的 Block 类型:paragraph / heading / list / divider / page_break
 */

/** 所有 Block 类型的联合标识 */
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'divider'
  | 'page_break'
  | 'quote'
  | 'code_block'
  | 'table'
  | 'image'

/** 行内标记(粗体/斜体等) */
export type MarkType = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'link' | 'image' | 'highlight' | 'superscript' | 'subscript' | 'math' | 'html' | 'wikilink'

export interface Mark {
  type: MarkType
  start: number
  end: number
  href?: string
  alt?: string
  /** wikilink: 目标页面名(不含 .md 后缀) */
  target?: string
  /** wikilink: 别名(显示文本,如果和 target 不同) */
  alias?: string
  /** math mark 是否为块级($$...$$) */
  displayMode?: boolean
  /** html mark:原始标签名(如 b/i/span 等,Obsidian 兼容) */
  tag?: string
  /** html mark:原始属性字符串(白名单过滤后保留) */
  attrs?: string
  /** html mark:是否为自闭合标签(如 <br/>) */
  selfClosing?: boolean
}

/** 对齐方式 */
export type AlignType = 'left' | 'center' | 'right' | 'justify'

/** 列表类型:无序 / 有序 / 任务 */
export type ListType = 'bullet' | 'ordered' | 'task'

/** 列表项 */
export interface ListItem {
  id: string
  text: string
  marks?: Mark[] // 行内标记(粗体/斜体等)
  checked?: boolean // 仅 task 类型使用
}

/** 表格单元格(支持行内标记) */
export interface TableCell {
  text: string
  marks?: Mark[]
}

/** 各 Block 类型的内容结构 */
export interface ParagraphContent {
  text: string
  marks?: Mark[]
}

export interface HeadingContent {
  text: string
  marks?: Mark[]
}

export interface ListContent {
  items: ListItem[]
}

export interface QuoteContent {
  text: string
  marks?: Mark[]
}

export interface CodeBlockContent {
  code: string
}

export type ColumnAlign = 'left' | 'center' | 'right'

export interface TableContent {
  headers: TableCell[]
  rows: TableCell[][]
  aligns?: ColumnAlign[]
}

export interface ImageContent {
  src: string
  alt: string
}

export type BlockContent =
  | ParagraphContent
  | HeadingContent
  | ListContent
  | QuoteContent
  | CodeBlockContent
  | TableContent
  | ImageContent
  | Record<string, never>

/** 各 Block 类型的属性结构 */
export interface ParagraphProps {
  align?: AlignType
}

export interface HeadingProps {
  level: 1 | 2 | 3 | 4 | 5 | 6
  align?: AlignType
}

export interface ListProps {
  listType: ListType
}

export interface CodeBlockProps {
  language?: string
}

export interface ImageProps {
  align?: AlignType
  /** 宽度(像素),不设为自适应。序列化为 Obsidian 语法 ![[src|width]] */
  width?: number
}

export type BlockProps = ParagraphProps | HeadingProps | ListProps | CodeBlockProps | ImageProps | Record<string, never>

/** AI 操作记录(该 Block 的可撤销 AI 操作) */
export interface AiHistoryEntry {
  action: string
  before: string
  after: string
  timestamp: string
}

/** Block 元数据结构(PRD §11.3)
 *  content / props 使用宽松类型,具体结构由各类型接口定义,组件内通过 as 断言使用。
 *  这样既保留类型文档,又避免联合类型在 store 变更时的赋值摩擦。
 */
export interface Block<T extends BlockType = BlockType> {
  id: string
  type: T
  content: Record<string, any>
  props: Record<string, any>
  ai_history: AiHistoryEntry[]
  created_at: string
  updated_at: string
}

/** 文档元信息(PRD §7.1 meta.json) */
export interface DocumentMeta {
  title: string
  created_at: string
  updated_at: string
  version: string
  author: string
  /** 标签数组,对应 frontmatter 的 tags 字段 */
  tags?: string[]
}

/** .uni-doc 加载结果 */
export interface UniDocPayload {
  content: string
  blocks: Block[]
  meta: DocumentMeta
}

/** 文档大纲条目(用于侧边栏) */
export interface OutlineEntry {
  id: string
  level: number
  text: string
}
