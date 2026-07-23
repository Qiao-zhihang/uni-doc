/**
 * UniDoc AI Agent 工具注册与调度
 * 定义 13 个工具,封装执行逻辑,映射到 document/editor store 与 vault 文件系统方法
 * 导出:
 *   - createTools(doc, editor): 工厂函数,绑定 store 实例,返回 ToolDefinition[]
 *   - getToolDefinitions(tools): 转换为 OpenAI Function Calling 请求格式
 *   - executeTool(tools, name, args): 按 name 查找并执行,统一错误处理
 */

import type { ToolDefinition, ToolResult, MemoryCategory } from './types'
import type { BlockType, ListType } from '@/core/blocks/types'
import type { Block } from '@/core/blocks/types'
import { createBlock } from '@/core/blocks/factory'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import {
  readVaultFile,
  writeVaultFile,
  createVaultFile,
  readVaultTree,
  type VaultNode
} from '@/core/vault/vault'
import { isTauri } from '@/core/serializer/markdownFile'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { useAiMemoryStore } from '@/stores/aiMemory'
import { searchAndFormatMemories, listAllMemories, parseAndSaveFact } from './memory'

type DocumentStore = ReturnType<typeof useDocumentStore>
type EditorStore = ReturnType<typeof useEditorStore>
type MemoryStore = ReturnType<typeof useAiMemoryStore>

/**
 * 工具名 → 中文标签(单一事实源)
 * 新增工具时同步更新此处,agent.ts 与 AiFloatingWindow.vue 都从此导入
 */
export const TOOL_LABELS: Record<string, string> = {
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
  write_file: '写入文件',
  create_file: '创建文件',
  list_dir: '列出目录',
  switch_tab: '切换标签',
  web_search: '联网搜索',
  save_memory: '保存记忆',
  list_memory: '查看记忆',
  search_memory: '搜索记忆',
}

const BLOCK_TYPES: BlockType[] = ['paragraph', 'heading', 'list', 'divider', 'page_break', 'quote', 'code_block', 'table', 'image']
const LIST_TYPES: ListType[] = ['bullet', 'ordered', 'task']

/** 深度优先扁平化 VaultNode 树为线性列表 */
function flattenVault(nodes: VaultNode[]): VaultNode[] {
  const out: VaultNode[] = []
  const walk = (arr: VaultNode[]) => {
    for (const n of arr) {
      out.push(n)
      if (n.isDir && n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * 根据简化参数构造 content/props patch（用于 updateBlock）
 * 支持所有区块类型,确保 AI 传入的 headers/rows/items/code 等结构化数据被正确写入
 * 这样 AI 生成表格/列表/代码块时能直接填入内容,而不是创建空白区块
 */
function buildContentPatch(type: BlockType, args: Record<string, unknown>): { content?: Record<string, unknown>; props?: Record<string, unknown> } {
  const patch: { content?: Record<string, unknown>; props?: Record<string, unknown> } = {}
  // 文本类区块: paragraph / heading / quote
  if (typeof args.text === 'string' && (type === 'paragraph' || type === 'heading' || type === 'quote')) {
    const parsed = parseInlineMarkdown(args.text)
    patch.content = { text: parsed.text, marks: parsed.marks }
  }
  // heading level
  if (type === 'heading' && typeof args.level === 'number') {
    const lvl = Math.max(1, Math.min(6, Math.floor(args.level))) as 1 | 2 | 3 | 4 | 5 | 6
    patch.props = { level: lvl, align: 'left' }
  }
  // list: items 数组
  if (type === 'list' && Array.isArray(args.items)) {
    patch.content = {
      items: (args.items as Array<Record<string, unknown>>).map((it) => {
        const parsed = parseInlineMarkdown(String(it.text ?? ''))
        return {
          id: crypto.randomUUID(),
          text: parsed.text,
          marks: parsed.marks,
          checked: typeof it.checked === 'boolean' ? it.checked : undefined
        }
      })
    }
  }
  // code_block: code 字段
  if (type === 'code_block' && typeof args.code === 'string') {
    patch.content = { code: args.code }
    if (typeof args.language === 'string') patch.props = { language: args.language }
  }
  // table: headers + rows
  if (type === 'table' && Array.isArray(args.headers)) {
    patch.content = {
      headers: (args.headers as Array<string | Record<string, unknown>>).map((h) => {
        const text = String(typeof h === 'string' ? h : (h.text ?? ''))
        const parsed = parseInlineMarkdown(text)
        return { text: parsed.text, marks: parsed.marks }
      }),
      rows: Array.isArray(args.rows)
        ? (args.rows as Array<string[] | Record<string, unknown>[]>).map((r) =>
            Array.isArray(r)
              ? r.map((t) => {
                  const text = String(t)
                  const parsed = parseInlineMarkdown(text)
                  return { text: parsed.text, marks: parsed.marks }
                })
              : [{ text: String((r as Record<string, unknown>).text ?? ''), marks: [] }]
          )
        : [],
      aligns: []
    }
  }
  // image
  if (type === 'image' && typeof args.src === 'string') {
    patch.content = { src: args.src, alt: String(args.alt ?? '') }
  }
  return patch
}

/**
 * 工具参数 schema（用于 insert_block / update_block / batch_edit 共享）
 * AI 根据这个 schema 知道每种区块类型需要传什么参数
 */
const BLOCK_CONTENT_PARAMS = {
  text: { type: 'string', description: '文本内容(适用于 paragraph/heading/quote)' },
  level: { type: 'number', description: '标题级别 1-6,仅 type=heading 时需要' },
  items: {
    type: 'array',
    description: '列表项数组,仅 type=list 时需要。每项格式: {text:"内容",checked:false}',
    items: { type: 'object' }
  },
  code: { type: 'string', description: '代码内容,仅 type=code_block 时需要' },
  language: { type: 'string', description: '代码语言,仅 type=code_block 时可选' },
  headers: {
    type: 'array',
    description: '表头数组,仅 type=table 时需要。如 ["列1","列2"]',
    items: { type: 'string' }
  },
  rows: {
    type: 'array',
    description: '表格数据行,仅 type=table 时需要。每行是数组,如 [["a","b"],["c","d"]]',
    items: { type: 'array' }
  },
  src: { type: 'string', description: '图片路径,仅 type=image 时需要' },
  alt: { type: 'string', description: '图片描述,仅 type=image 时可选' },
  align: { type: 'string', description: '对齐方式 left/center/right,仅文本类区块可选' }
}

/** 工具工厂:绑定 doc/editor 实例,返回 16 个 ToolDefinition */
export function createTools(doc: DocumentStore, editor: EditorStore, enableWebSearch = false, memory?: MemoryStore): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: 'get_document',
      description: '导出当前活动文档为 Markdown 全文',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => ({ ok: true, data: doc.exportMarkdown() })
    },
    {
      name: 'get_outline',
      description: '获取当前文档大纲(标题层级列表)',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => ({ ok: true, data: doc.outline })
    },
    {
      name: 'list_blocks',
      description: '获取当前文档所有区块的列表（含 id、类型、文本预览），用于定位要修改/删除的目标区块。修改文档前务必先调用此工具获取准确的 blockId。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '最多返回多少条,默认 50' },
          offset: { type: 'number', description: '从第几条开始,默认 0' }
        }
      },
      execute: (args) => {
        const limit = (args.limit as number) ?? 50
        const offset = (args.offset as number) ?? 0
        const blocks = doc.blocks.slice(offset, offset + limit)
        const data = blocks.map((b) => {
          let preview = ''
          const c = b.content as { text?: string } | undefined
          if (c?.text) preview = c.text.slice(0, 80)
          return { id: b.id, type: b.type, preview }
        })
        return { ok: true, data, total: doc.blocks.length }
      }
    },
    {
      name: 'insert_block',
      description: '在指定区块后插入新区块,支持所有区块类型。创建表格时必须传 headers 和 rows;创建列表时必须传 items;创建代码块时必须传 code。afterBlockId 省略或为 null 时默认插入到当前选中区块之后。',
      parameters: {
        type: 'object',
        properties: {
          afterBlockId: { type: 'string', description: '插入锚点区块 id;传 null 或省略则使用当前选中区块,若无选中则追加到末尾' },
          type: { type: 'string', enum: BLOCK_TYPES, description: '新区块类型' },
          listType: { type: 'string', enum: LIST_TYPES, description: '列表类型,仅 type=list 时有效' },
          ...BLOCK_CONTENT_PARAMS
        },
        required: ['type']
      },
      execute: (args) => {
        const rawAfter = args.afterBlockId as string | null | undefined
        const blockType = args.type as BlockType
        const listType = args.listType as ListType | undefined
        const afterId = rawAfter ?? editor.selectedBlockId ?? null
        const newId = doc.insertBlockAfter(afterId, blockType, 'AI 插入区块', listType)
        // 用 buildContentPatch 构造完整 content patch,确保表格/列表/代码块等内容被正确填充
        const patch = buildContentPatch(blockType, args)
        if (patch.content || patch.props) {
          doc.updateBlock(newId, patch as any, 'AI 填充内容')
        }
        // 返回插入位置信息和内容预览
        const newBlock = doc.blocks.find((b) => b.id === newId)
        let preview = ''
        if (newBlock) {
          if (newBlock.type === 'paragraph' || newBlock.type === 'heading' || newBlock.type === 'quote') {
            preview = (newBlock.content as { text?: string }).text?.slice(0, 200) ?? ''
          } else if (newBlock.type === 'list') {
            const items = (newBlock.content as { items?: { text?: string }[] }).items ?? []
            preview = items.map((it) => it.text).join(', ')?.slice(0, 200) ?? ''
          } else if (newBlock.type === 'code_block') {
            preview = (newBlock.content as { code?: string }).code?.slice(0, 200) ?? ''
          } else if (newBlock.type === 'table') {
            const headers = (newBlock.content as { headers?: unknown[] }).headers ?? []
            const rows = (newBlock.content as { rows?: unknown[][] }).rows ?? []
            preview = `${headers.length}列 ${rows.length + 1}行`
          }
        }
        const index = doc.blocks.findIndex((b) => b.id === newId)
        return { ok: true, data: { blockId: newId, type: blockType, index, preview } }
      }
    },
    {
      name: 'update_block',
      description: '更新指定区块的文本或属性。支持所有区块类型:文本类传 text;列表传 items;代码块传 code;表格传 headers/rows。修改文本时自动清空旧 marks。',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: '目标区块 id' },
          ...BLOCK_CONTENT_PARAMS
        },
        required: ['blockId']
      },
      execute: (args) => {
        const id = args.blockId as string
        // 先找到目标 block 的类型,用 buildContentPatch 构造正确的 patch
        const target = doc.blocks.find((b) => b.id === id)
        if (!target) return { ok: false, error: `区块 ${id} 不存在` }
        const patch = buildContentPatch(target.type, args)
        if (!patch.content && !patch.props) {
          return { ok: false, error: '未提供任何修改内容(text/items/code/headers/rows/src)' }
        }
        const ok = doc.updateBlock(id, patch as any, 'AI 更新区块')
        if (!ok) return { ok: false, error: `区块 ${id} 更新失败` }
        // 返回修改后的内容预览,让 AI 验证是否修改成功
        const updated = doc.blocks.find((b) => b.id === id)
        let preview = ''
        if (updated) {
          if (updated.type === 'paragraph' || updated.type === 'heading' || updated.type === 'quote') {
            preview = (updated.content as { text?: string }).text?.slice(0, 200) ?? ''
          } else if (updated.type === 'list') {
            const items = (updated.content as { items?: { text?: string }[] }).items ?? []
            preview = items.map((it) => it.text).join(', ')?.slice(0, 200) ?? ''
          } else if (updated.type === 'code_block') {
            preview = (updated.content as { code?: string }).code?.slice(0, 200) ?? ''
          } else if (updated.type === 'table') {
            const headers = (updated.content as { headers?: unknown[] }).headers ?? []
            const rows = (updated.content as { rows?: unknown[][] }).rows ?? []
            preview = `${headers.length}列 ${rows.length + 1}行`
          }
        }
        return { ok: true, data: { blockId: id, type: updated?.type, preview } }
      }
    },
    {
      name: 'delete_block',
      description: '删除指定区块',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string', description: '要删除的区块 id' } },
        required: ['blockId']
      },
      execute: (args) => {
        const id = args.blockId as string
        const ok = doc.removeBlock(id, 'AI 删除区块')
        if (!ok) return { ok: false, error: `区块 ${id} 不存在` }
        return { ok: true, data: { blockId: id } }
      }
    },
    {
      name: 'move_block',
      description: '上移或下移指定区块',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: '目标区块 id' },
          direction: { type: 'string', enum: ['up', 'down'], description: '移动方向' }
        },
        required: ['blockId', 'direction']
      },
      execute: (args) => {
        const id = args.blockId as string
        const dir = args.direction as 'up' | 'down'
        let ok: boolean
        if (dir === 'up') ok = doc.moveBlockUp(id, 'AI 上移区块')
        else ok = doc.moveBlockDown(id, 'AI 下移区块')
        if (!ok) return { ok: false, error: `区块 ${id} 不存在或已在边界` }
        return { ok: true, data: { blockId: id, direction: dir } }
      }
    },
    {
      name: 'convert_block',
      description: '将指定区块转换为另一种类型',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: '目标区块 id' },
          type: { type: 'string', enum: BLOCK_TYPES, description: '目标类型' }
        },
        required: ['blockId', 'type']
      },
      execute: (args) => {
        const id = args.blockId as string
        const type = args.type as BlockType
        const ok = doc.convertBlock(id, type, 'AI 转换类型')
        if (!ok) return { ok: false, error: `区块 ${id} 不存在` }
        return { ok: true, data: { blockId: id, type } }
      }
    },
    {
      name: 'search_files',
      description: '在 vault 文件树中按文件名搜索(不区分大小写),返回匹配的文件路径列表(最多 20 条)',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词(匹配文件名)' } },
        required: ['query']
      },
      execute: (args) => {
        const q = String(args.query).toLowerCase()
        const all = flattenVault(doc.vaultTree)
        const matches = all
          .filter((n) => !n.isDir && n.name.toLowerCase().includes(q))
          .map((n) => n.path)
          .slice(0, 20)
        return { ok: true, data: matches }
      }
    },
    {
      name: 'read_file',
      description: '读取 vault 内指定相对路径的文件内容',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件相对 vault 根的路径(用 / 分隔)' } },
        required: ['path']
      },
      execute: async (args) => {
        const root = doc.vaultRoot
        if (!root) return { ok: false, error: '未打开 vault' }
        const content = await readVaultFile(root, args.path as string)
        return { ok: true, data: content }
      }
    },
    {
      name: 'write_file',
      description: '写入(覆盖)vault 内指定路径的文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对 vault 根的路径' },
          content: { type: 'string', description: '文件内容' }
        },
        required: ['path', 'content']
      },
      execute: async (args) => {
        const root = doc.vaultRoot
        if (!root) return { ok: false, error: '未打开 vault' }
        await writeVaultFile(root, args.path as string, args.content as string)
        return { ok: true, data: { path: args.path } }
      }
    },
    {
      name: 'create_file',
      description: '在 vault 内创建新文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '新文件相对 vault 根的路径' },
          content: { type: 'string', description: '初始内容,默认空字符串' }
        },
        required: ['path']
      },
      execute: async (args) => {
        const root = doc.vaultRoot
        if (!root) return { ok: false, error: '未打开 vault' }
        const content = (args.content as string) ?? ''
        await createVaultFile(root, args.path as string, content)
        // 刷新文件树,让文件列表自动更新
        await doc.refreshVaultTree()
        return { ok: true, data: { path: args.path } }
      }
    },
    {
      name: 'list_dir',
      description: '列出 vault 内指定路径下的节点;path 省略或为空时返回根级节点(最多 50 条)',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '目录路径前缀,空则返回根' } },
        required: []
      },
      execute: async (args) => {
        const root = doc.vaultRoot
        if (!root) return { ok: false, error: '未打开 vault' }
        const tree = await readVaultTree(root)
        const prefix = (args.path as string | undefined)?.trim()
        const all = flattenVault(tree)
        const filtered = prefix
          ? all.filter((n) => n.path === prefix || n.path.startsWith(prefix + '/'))
          : all
        const result = filtered.slice(0, 50).map((n) => ({ name: n.name, path: n.path, isDir: n.isDir }))
        return { ok: true, data: result }
      }
    },
    {
      name: 'switch_tab',
      description: '切换到指定文档 tab',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'string', description: '目标 tab id' } },
        required: ['tabId']
      },
      execute: (args) => {
        doc.switchTab(args.tabId as string)
        return { ok: true, data: { activeTabId: doc.activeTabId } }
      }
    },
    {
      name: 'batch_edit',
      description: '批量执行多个区块操作（插入/修改/删除/移动/转换），适用于复杂任务。operations 是操作数组,每个操作含 op 字段和其他参数。所有操作共享一次撤销历史。',
      parameters: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            description: '操作数组,每项格式: {op:"insert",type:"paragraph",text:"...",afterBlockId:"xxx"} / {op:"update",blockId:"xxx",text:"..."} / {op:"delete",blockId:"xxx"} / {op:"move",blockId:"xxx",direction:"up|down"} / {op:"convert",blockId:"xxx",type:"heading"}',
            items: { type: 'object' }
          }
        },
        required: ['operations']
      },
      execute: (args) => {
        const ops = args.operations as Array<Record<string, unknown>>
        if (!Array.isArray(ops) || ops.length === 0) {
          return { ok: false, error: 'operations 必须是非空数组' }
        }
        const results: Array<Record<string, unknown>> = []
        const errors: string[] = []
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]
          const opType = String(op.op ?? '')
          try {
            switch (opType) {
              case 'insert': {
                const type = op.type as BlockType
                const afterId = (op.afterBlockId as string | null | undefined) ?? editor.selectedBlockId ?? null
                const listType = op.listType as ListType | undefined
                const newId = doc.insertBlockAfter(afterId, type, `AI 批量插入 #${i + 1}`, listType)
                // 用 buildContentPatch 填充内容
                const patch = buildContentPatch(type, op)
                if (patch.content || patch.props) {
                  doc.updateBlock(newId, patch as any, `AI 批量设内容 #${i + 1}`)
                }
                results.push({ op: 'insert', ok: true, newBlockId: newId })
                break
              }
              case 'update': {
                const id = op.blockId as string
                const target = doc.blocks.find((b) => b.id === id)
                if (!target) {
                  errors.push(`#${i + 1} update: 区块 ${id} 不存在`)
                  results.push({ op: 'update', ok: false, error: '区块不存在' })
                  break
                }
                const patch = buildContentPatch(target.type, op)
                const ok = doc.updateBlock(id, patch as any, `AI 批量更新 #${i + 1}`)
                if (!ok) {
                  errors.push(`#${i + 1} update: 区块 ${id} 更新失败`)
                  results.push({ op: 'update', ok: false, error: '更新失败' })
                } else {
                  results.push({ op: 'update', ok: true, blockId: id })
                }
                break
              }
              case 'delete': {
                const id = op.blockId as string
                const ok = doc.removeBlock(id, `AI 批量删除 #${i + 1}`)
                if (!ok) {
                  errors.push(`#${i + 1} delete: 区块 ${id} 不存在`)
                  results.push({ op: 'delete', ok: false, error: '区块不存在' })
                } else {
                  results.push({ op: 'delete', ok: true, blockId: id })
                }
                break
              }
              case 'move': {
                const id = op.blockId as string
                const dir = op.direction as 'up' | 'down'
                const ok = dir === 'up' ? doc.moveBlockUp(id, `AI 批量上移 #${i + 1}`) : doc.moveBlockDown(id, `AI 批量下移 #${i + 1}`)
                if (!ok) {
                  errors.push(`#${i + 1} move: 区块 ${id} 不存在或已在边界`)
                  results.push({ op: 'move', ok: false, error: '区块不存在或已在边界' })
                } else {
                  results.push({ op: 'move', ok: true, blockId: id })
                }
                break
              }
              case 'convert': {
                const id = op.blockId as string
                const type = op.type as BlockType
                const ok = doc.convertBlock(id, type, `AI 批量转换 #${i + 1}`)
                if (!ok) {
                  errors.push(`#${i + 1} convert: 区块 ${id} 不存在`)
                  results.push({ op: 'convert', ok: false, error: '区块不存在' })
                } else {
                  results.push({ op: 'convert', ok: true, blockId: id })
                }
                break
              }
              default:
                errors.push(`#${i + 1}: 未知操作类型 ${opType}`)
                results.push({ op: opType, ok: false, error: '未知操作类型' })
            }
          } catch (e) {
            errors.push(`#${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
            results.push({ op: opType, ok: false, error: String(e) })
          }
        }
        const successCount = results.filter((r) => r.ok).length
        return {
          ok: errors.length === 0,
          data: { total: ops.length, success: successCount, failed: errors.length, results, errors: errors.length ? errors : undefined }
        }
      }
    },
    {
      name: 'replace_document',
      description: '用全新的 blocks 数组原子性替换整个文档内容。适用于"重写整篇文章"、"大段重构"等复杂任务。会清空当前文档所有区块,替换为新内容。每个 block 格式: {type:"paragraph",text:"..."} 或 {type:"heading",text:"...",level:1} 或 {type:"divider"} 等。',
      parameters: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            description: '新的区块数组,每项至少含 type 字段;文本类区块含 text;heading 含 level(1-6);list 含 items(数组,每项 {text,checked?});code_block 含 code;table 含 headers/rows;image 含 src/alt。',
            items: { type: 'object' }
          }
        },
        required: ['blocks']
      },
      execute: (args) => {
        const rawBlocks = args.blocks as Array<Record<string, unknown>>
        if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
          return { ok: false, error: 'blocks 必须是非空数组' }
        }
        try {
          const newBlocks: Block[] = rawBlocks.map((rb) => {
            const type = rb.type as BlockType
            if (!BLOCK_TYPES.includes(type)) {
              throw new Error(`未知区块类型: ${type}`)
            }
            const block = createBlock(type)
            // 复用 buildContentPatch 填充内容
            const patch = buildContentPatch(type, rb)
            if (patch.content) block.content = patch.content as any
            if (patch.props) block.props = { ...block.props, ...patch.props } as any
            return block
          })
          doc.replaceBlocks(newBlocks, 'AI 替换整个文档')
          return { ok: true, data: { blockCount: newBlocks.length } }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      }
    }
  ]

  if (memory) {
    tools.push(
      {
        name: 'save_memory',
        description: '将重要信息保存到全局记忆中,供下次对话自动引用。适用于:用户提到个人信息、项目背景、偏好习惯、重要决策等。',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '要保存的记忆内容(简洁描述事实)' },
            category: { type: 'string', enum: ['personal', 'project', 'knowledge', 'preference', 'other'], description: '记忆分类: personal=个人信息, project=项目背景, knowledge=知识, preference=偏好, other=其他' },
            tags: { type: 'array', description: '标签数组,用于后续检索匹配', items: { type: 'string' } },
            importance: { type: 'number', description: '重要度 0-1,越重要越不容易被衰减清理,默认 0.5' }
          },
          required: ['content']
        },
        execute: (args) => {
          const content = String(args.content ?? '')
          if (!content) return { ok: false, error: 'content 不能为空' }
          const category = (args.category as MemoryCategory) ?? 'knowledge'
          const tags = Array.isArray(args.tags) ? (args.tags as string[]) : []
          const importance = typeof args.importance === 'number' ? args.importance : 0.5
          const fact = memory.addFact(content, category, tags, 'agent', importance)
          return { ok: true, data: { id: fact.id, category, content } }
        }
      },
      {
        name: 'list_memory',
        description: '查看用户的全局记忆列表(画像 + 所有事实),按分类展示。',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: () => {
          const result = listAllMemories()
          return { ok: true, data: result }
        }
      },
      {
        name: 'search_memory',
        description: '按关键词搜索用户的全局记忆,返回最相关的事实条目。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词(多个词用空格分隔)' },
            maxResults: { type: 'number', description: '最多返回条数,默认 10' }
          },
          required: ['query']
        },
        execute: (args) => {
          const query = String(args.query ?? '')
          const maxResults = (args.maxResults as number) ?? 10
          const result = searchAndFormatMemories(query, maxResults)
          return { ok: true, data: result }
        }
      }
    )
  }

  // 联网搜索工具（仅在设置中启用时添加）
  if (enableWebSearch) {
    tools.push({
      name: 'web_search',
      description: '联网搜索：使用 Bing 搜索引擎查找网络资料。返回网页搜索结果（每条含标题、摘要、网页链接）。注意：返回的是网页链接，不是图片直接 URL。如需找图片，可搜索相关网页后从中提取图片 URL。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' }
        },
        required: ['query']
      },
      execute: async (args) => {
        const q = String(args.query)
        // Web 环境无法绕过 CORS,且 DuckDuckGo 国内不可访问,直接报错
        if (!isTauri()) {
          return { ok: false, error: 'Web 环境暂不支持联网搜索,请在 Tauri 桌面端使用' }
        }
        try {
          // Tauri 环境下走 Rust 端 web_search 命令(基于 Bing,绕过 CORS)
          const { invoke } = await import('@tauri-apps/api/core')
          const result = await invoke<string>('web_search', { query: q })
          return { ok: true, data: result }
        } catch (e) {
          return { ok: false, error: `搜索失败: ${e instanceof Error ? e.message : String(e)}` }
        }
      }
    })
  }

  return tools
}

/** 将内部 ToolDefinition 转换为 OpenAI Function Calling 请求格式 */
export function getToolDefinitions(
  tools: ToolDefinition[]
): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

/** 按 name 查找并执行工具;未找到或异常时返回错误结果 */
export async function executeTool(
  tools: ToolDefinition[],
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { ok: false, error: `未知工具: ${name}` }
  try {
    return await tool.execute(args)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
