/**
 * Block 创建工厂
 * 参考 PRD §11.2 / §11.3
 * 提供统一的 Block 实例创建方法,自动填充 id 与时间戳
 */

import type {
  Block,
  BlockType,
  ColumnAlign,
  HeadingProps,
  ImageProps,
  ListItem,
  ListType,
  Mark,
  ParagraphProps,
  TableCell
} from './types'

/** 生成 RFC4122 风格 UUID(优先使用原生,回退到随机实现) */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // 回退实现
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 当前 ISO 时间戳 */
function now(): string {
  return new Date().toISOString()
}

/** 创建空 Block 骨架 */
function createBaseBlock(type: BlockType): Block {
  return {
    id: uuid(),
    type,
    content: {},
    props: {},
    ai_history: [],
    created_at: now(),
    updated_at: now()
  }
}

/** 创建段落 Block */
export function createParagraphBlock(text = '', props: ParagraphProps = {}): Block {
  const block = createBaseBlock('paragraph')
  block.content = { text, marks: [] }
  block.props = { align: props.align ?? 'left' }
  return block
}

/** 创建标题 Block */
export function createHeadingBlock(
  text = '',
  level: HeadingProps['level'] = 1,
  props: ParagraphProps = {}
): Block {
  const block = createBaseBlock('heading')
  block.content = { text, marks: [] }
  block.props = { level, align: props.align ?? 'left' }
  return block
}

/** 创建列表 Block */
export function createListBlock(
  items: { text: string; marks?: Mark[]; checked?: boolean }[] = [],
  listType: ListType = 'bullet'
): Block {
  const block = createBaseBlock('list')
  block.content = {
    items: items.map((item): ListItem => ({
      id: uuid(),
      text: item.text,
      marks: item.marks ?? [],
      checked: item.checked
    }))
  }
  block.props = { listType }
  return block
}

/** 创建分隔线 Block */
export function createDividerBlock(): Block {
  return createBaseBlock('divider')
}

/** 创建分页标记 Block */
export function createPageBreakBlock(): Block {
  return createBaseBlock('page_break')
}

/** 创建引用 Block */
export function createQuoteBlock(text = ''): Block {
  const block = createBaseBlock('quote')
  block.content = { text, marks: [] }
  return block
}

/** 创建代码块 Block */
export function createCodeBlockBlock(code = '', language = 'plaintext'): Block {
  const block = createBaseBlock('code_block')
  block.content = { code }
  block.props = { language }
  return block
}

/** 创建表格 Block */
export function createTableBlock(
  headers: (string | TableCell)[] = [],
  rows: (string | TableCell)[][] = [],
  aligns: ColumnAlign[] = []
): Block {
  const block = createBaseBlock('table')
  const toCell = (c: string | TableCell): TableCell =>
    typeof c === 'string' ? { text: c, marks: [] } : { text: c.text, marks: c.marks ?? [] }
  block.content = {
    headers: headers.map(toCell),
    rows: rows.map((r) => r.map(toCell)),
    aligns
  }
  return block
}

/** 创建图片 Block */
export function createImageBlock(src = '', alt = '', props: ImageProps = {}): Block {
  const block = createBaseBlock('image')
  block.content = { src, alt }
  block.props = { align: props.align ?? 'center', width: props.width }
  return block
}

/** 通用创建入口:按类型创建对应 Block */
export function createBlock(type: BlockType): Block {
  switch (type) {
    case 'paragraph':
      return createParagraphBlock()
    case 'heading':
      return createHeadingBlock()
    case 'list':
      return createListBlock()
    case 'divider':
      return createDividerBlock()
    case 'page_break':
      return createPageBreakBlock()
    case 'quote':
      return createQuoteBlock()
    case 'code_block':
      return createCodeBlockBlock()
    case 'table':
      return createTableBlock()
    case 'image':
      return createImageBlock()
    default:
      return createParagraphBlock()
  }
}

/** 创建一个示例文档(用于首次进入时的初始内容) */
export function createSampleDocument(): Block[] {
  return [
    createHeadingBlock('UniDoc 演示文档', 1),
    createParagraphBlock(
      '这是一份基于 Markdown 的轻量化办公编辑器,所有内容以 Block 形式组织,支持深浅主题切换、撤销重做与 Markdown 文件读写。'
    ),
    createHeadingBlock('核心特性', 2),
    createListBlock(
      [
        { text: 'Block-based 文档引擎,所见即所得' },
        { text: '扩展 Markdown 双向实时同步' },
        { text: '深色 / 浅色主题切换' },
        { text: '完整的撤销重做历史栈' }
      ],
      'bullet'
    ),
    createDividerBlock(),
    createHeadingBlock('快捷操作', 2),
    createListBlock(
      [
        { text: 'Ctrl+Z 撤销,Ctrl+Shift+Z 重做', checked: true },
        { text: 'Enter 在当前 Block 后新建同类型', checked: true },
        { text: 'Backspace 在空 Block 上删除并合并', checked: false }
      ],
      'task'
    ),
    createPageBreakBlock(),
    createHeadingBlock('分页之后的内容', 2),
    createParagraphBlock('上方为分页标记,演示模式下将作为幻灯片边界。')
  ]
}
