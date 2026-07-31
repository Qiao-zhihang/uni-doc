/**
 * 文档状态 store(多 tab 实例版)
 * 管理多个打开的文档 tab,每个 tab 持有独立的 blocks/meta/history/renderTick
 * 参考 PRD §11(Block-based 文档引擎)和 UI 改造方案 §3.2.C(多标签管理)
 *
 * 兼容策略:
 *   - 保留 blocks / meta / savedStatus / renderTick 作为 computed getter+setter
 *   - 所有现有 actions(updateBlock/insertBlockAfter 等)作用于 active tab
 *   - 新增 tab 管理 actions: openVaultFile / closeTab / switchTab / createNewTab
 */

import { defineStore } from 'pinia'
import { computed, markRaw, nextTick, ref } from 'vue'
import type {
  Block,
  BlockType,
  DocumentMeta,
  ListType,
  Mark,
  OutlineEntry,
} from '@/core/blocks/types'
import { createBlock, createHeadingBlock, uuid } from '@/core/blocks/factory'
import { UndoRedo } from '@/core/history/UndoRedo'
import { parseInlineMarkdown } from '@/core/parser/inlineMarkdown'
import { marksToSource } from '@/components/blocks/marks'
import {
  serializeMarkdown,
  serializeMarkdownWithMeta,
  deserializeMarkdown,
  parseFrontmatter,
} from '@/core/serializer/markdown'
import type { HtmlExportOptions } from '@/core/serializer/html'
import { serializeHtml } from '@/core/serializer/html'
import {
  saveMarkdownFile,
  openMarkdownFile,
  saveFile,
  type SaveFileFilter,
} from '@/core/serializer/markdownFile'
import {
  readVaultFile,
  writeVaultFile,
  readVaultTree,
  findFileByName,
  type VaultNode,
} from '@/core/vault/vault'

/** 单个文档 tab 实例 */
interface TabInstance {
  /** tab 唯一 id(与首个 block id 无关,仅用于 tab 跟踪) */
  id: string
  /** vault 相对路径(用 / 分隔),null 表示未保存的新文件 */
  path: string | null
  /** 文档 blocks */
  blocks: Block[]
  /** 文档元信息 */
  meta: DocumentMeta
  /** 保存状态:saved=已保存 / saving=保存中 / unsaved=编辑中(有未保存改动) */
  savedStatus: 'saved' | 'saving' | 'unsaved'
  /** 强制重渲染信号(导入/打开文件后递增) */
  renderTick: number
  /** 历史栈变更信号(push/undo/redo/reset 后递增,用于驱动 canUndo/canRedo 响应式更新) */
  historyTick: number
  /** 独立的撤销重做栈 */
  history: UndoRedo
  /** batch 嵌套深度(>0 时所有 commit 被挂起) */
  batchDepth: number
  /** batch 内第一次 commit 时的快照(所有 mutations 完成后才 push) */
  batchSnapshot: Block[] | null
  /** batch 内记录的操作标签 */
  batchLabel: string | null
}

/** 默认文档元信息 */
function defaultMeta(title = '未命名文档'): DocumentMeta {
  const now = new Date().toISOString()
  return {
    title,
    created_at: now,
    updated_at: now,
    version: '1.0.0',
    author: 'UniDoc User',
  }
}

/** 创建一个空白 tab(仅含一个 H1 + 一个段落) */
function createBlankTab(title = '未命名文档'): TabInstance {
  const first = createHeadingBlock(title, 1)
  const para = createBlock('paragraph')
  const blocks = [first, para]
  const history = markRaw(new UndoRedo(100))
  history.reset(blocks, '新建文档')
  return {
    id: uuid(),
    path: null,
    blocks,
    meta: defaultMeta(title),
    savedStatus: 'saved',
    renderTick: 0,
    historyTick: 0,
    history,
    batchDepth: 0,
    batchSnapshot: null,
    batchLabel: null,
  }
}

export const useDocumentStore = defineStore('document', () => {
  // ===== state =====
  const openTabs = ref<TabInstance[]>([])
  const activeTabId = ref<string>('')

  // vault 根路径(选择 vault 后设置)
  const vaultRoot = ref<string | null>(null)
  // vault 文件树(缓存,打开 vault 后加载)
  const vaultTree = ref<VaultNode[]>([])
  // 文件树刷新信号(AI 创建文件后递增,FileExplorer 监听此值触发刷新)
  const vaultTreeTick = ref(0)

  // ===== 内部工具 =====
  function getActive(): TabInstance | undefined {
    // markRaw 已保证 UndoRedo 实例不被响应式代理;as 断言修正 UnwrapRef 展开后丢失私有字段的类型
    return openTabs.value.find((t) => t.id === activeTabId.value) as TabInstance | undefined
  }

  // ===== 兼容 getter/setter(让现有代码 blocks.value = xxx 仍工作) =====
  const blocks = computed<Block[]>({
    get: () => getActive()?.blocks ?? [],
    set: (newBlocks) => {
      const tab = getActive()
      if (tab) tab.blocks = newBlocks
    },
  })

  const meta = computed<DocumentMeta>({
    get: () => getActive()?.meta ?? defaultMeta(),
    set: (v) => {
      const tab = getActive()
      if (tab) tab.meta = v
    },
  })

  const savedStatus = computed<'saved' | 'saving' | 'unsaved'>({
    get: () => getActive()?.savedStatus ?? 'saved',
    set: (v) => {
      const tab = getActive()
      if (tab) tab.savedStatus = v
    },
  })

  const renderTick = computed<number>({
    get: () => getActive()?.renderTick ?? 0,
    set: (v) => {
      const tab = getActive()
      if (tab) tab.renderTick = v
    },
  })

  /** 当前 active tab 的 vault 相对路径(用于定位图片等资源的存储目录) */
  const activeTabPath = computed<string | null>(() => getActive()?.path ?? null)

  // ===== getters =====
  const outline = computed<OutlineEntry[]>(() =>
    blocks.value
      .filter((b) => b.type === 'heading')
      .map((b) => {
        const level = (b.props as { level: number }).level
        const text = (b.content as { text: string }).text
        return { id: b.id, level, text }
      }),
  )

  const wordCount = computed(() => {
    return blocks.value.reduce((sum, block) => {
      if (block.type === 'paragraph' || block.type === 'heading') {
        return sum + ((block.content as { text: string }).text?.length ?? 0)
      }
      if (block.type === 'list') {
        return (
          sum +
          (block.content as { items: { text: string }[] }).items.reduce(
            (s, it) => s + it.text.length,
            0,
          )
        )
      }
      return sum
    }, 0)
  })

  const blockCount = computed(() => blocks.value.length)
  const pageCount = computed(() => blocks.value.filter((b) => b.type === 'page_break').length + 1)
  const markdown = computed(() => serializeMarkdown(blocks.value))

  // ===== 自动保存(防抖) =====
  // 编辑后 800ms 触发,写入 vault;无 path 的 tab 跳过(需用户手动另存)
  const SAVE_DEBOUNCE_MS = 800
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function scheduleAutoSave(tabId: string) {
    const existing = saveTimers.get(tabId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      saveTimers.delete(tabId)
      void flushAutoSave(tabId)
    }, SAVE_DEBOUNCE_MS)
    saveTimers.set(tabId, timer)
  }

  /** 立即写入磁盘(仅对有 path 且处于 unsaved 的 tab) */
  async function flushAutoSave(tabId: string) {
    const tab = openTabs.value.find((t) => t.id === tabId)
    if (!tab) return
    if (!vaultRoot.value || !tab.path) return
    if (tab.savedStatus !== 'unsaved') return
    tab.savedStatus = 'saving'
    try {
      const content = serializeMarkdownWithMeta(tab.blocks, tab.meta)
      await writeVaultFile(vaultRoot.value, tab.path, content)
      // 保存期间若又编辑,commit 会把状态改回 unsaved;仅当仍为 saving 时才置 saved
      if (tab.savedStatus === 'saving') {
        tab.savedStatus = 'saved'
      }
    } catch (e) {
      console.error('自动保存失败:', e)
      tab.savedStatus = 'unsaved'
    }
  }

  // ===== 内部:历史提交 =====
  function commit(label = '编辑') {
    const tab = getActive()
    if (!tab) return
    // batch 模式下:只记录第一次的快照,不重复 push
    if (tab.batchDepth > 0) {
      if (tab.batchSnapshot === null) {
        tab.batchSnapshot = JSON.parse(JSON.stringify(tab.blocks))
        tab.batchLabel = label
      }
      return
    }
    tab.history.push(tab.blocks, label)
    tab.historyTick++
    tab.renderTick++
    tab.savedStatus = 'unsaved'
    tab.meta.updated_at = new Date().toISOString()
    scheduleAutoSave(tab.id)

    // 在块编辑完成时触发快照(动态导入避免循环依赖)
    void import('@/stores/replay').then(({ useReplayStore }) => {
      const replay = useReplayStore()
      replay.captureSnapshot(label, 'auto')
    })
  }

  /**
   * 批量执行多个 mutation 并只产生一条历史记录
   * fn 内部所有 action 的 commit 都会被挂起,fn 返回后一次性提交
   */
  function batch<T>(fn: () => T, label = '编辑'): T {
    const tab = getActive()
    if (!tab) return fn()
    tab.batchDepth++
    try {
      const result = fn()
      tab.batchDepth--
      if (tab.batchDepth === 0 && tab.batchSnapshot !== null) {
        const snapshot = tab.batchSnapshot
        const usedLabel = tab.batchLabel || label
        tab.batchSnapshot = null
        tab.batchLabel = null
        tab.history.push(snapshot, usedLabel)
        tab.historyTick++
        tab.renderTick++
        tab.savedStatus = 'unsaved'
        tab.meta.updated_at = new Date().toISOString()
        scheduleAutoSave(tab.id)
        void import('@/stores/replay').then(({ useReplayStore }) => {
          const replay = useReplayStore()
          replay.captureSnapshot(usedLabel, 'auto')
        })
      }
      return result
    } catch (e) {
      tab.batchDepth = 0
      tab.batchSnapshot = null
      tab.batchLabel = null
      throw e
    }
  }

  function replaceBlocks(newBlocks: Block[], label: string) {
    commit(label)
    blocks.value = newBlocks
  }

  // ===== actions:作用于 active tab =====

  function updateBlock(id: string, patch: Partial<Block>, label = '编辑内容'): boolean {
    const tab = getActive()
    if (!tab) return false
    const idx = tab.blocks.findIndex((b) => b.id === id)
    if (idx === -1) return false
    commit(label)
    const target = tab.blocks[idx]
    tab.blocks[idx] = {
      ...target,
      ...patch,
      content: { ...target.content, ...(patch.content ?? {}) },
      props: { ...target.props, ...(patch.props ?? {}) },
      updated_at: new Date().toISOString(),
    }
    return true
  }

  function insertBlockAfter(
    id: string | null,
    type: BlockType,
    label = '新建区块',
    listType?: ListType,
  ) {
    commit(label)
    const newBlock = createBlock(type)
    if (type === 'list' && listType) {
      newBlock.props = { listType }
    }
    if (id === null) {
      blocks.value.push(newBlock)
    } else {
      const idx = blocks.value.findIndex((b) => b.id === id)
      if (idx === -1) {
        blocks.value.push(newBlock)
      } else {
        blocks.value.splice(idx + 1, 0, newBlock)
      }
    }
    return newBlock.id
  }

  function appendBlock(type: BlockType) {
    return insertBlockAfter(null, type, '追加区块')
  }

  function removeBlock(id: string, label = '删除区块'): boolean {
    const exists = blocks.value.some((b) => b.id === id)
    if (!exists) return false
    commit(label)
    blocks.value = blocks.value.filter((b) => b.id !== id)
    return true
  }

  function moveBlockUp(id: string, label = '上移区块'): boolean {
    const idx = blocks.value.findIndex((b) => b.id === id)
    if (idx <= 0) return false
    commit(label)
    const arr = [...blocks.value]
    ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
    blocks.value = arr
    return true
  }

  function moveBlockDown(id: string, label = '下移区块'): boolean {
    const idx = blocks.value.findIndex((b) => b.id === id)
    if (idx === -1 || idx >= blocks.value.length - 1) return false
    commit(label)
    const arr = [...blocks.value]
    ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
    blocks.value = arr
    return true
  }

  function duplicateBlock(id: string, label = '复制区块') {
    const idx = blocks.value.findIndex((b) => b.id === id)
    if (idx === -1) return
    commit(label)
    const clone = JSON.parse(JSON.stringify(blocks.value[idx]))
    clone.id = uuid()
    clone.created_at = new Date().toISOString()
    clone.updated_at = clone.created_at
    blocks.value.splice(idx + 1, 0, clone)
    return clone.id
  }

  /** 提取任意块的文本内容(还原行内 Markdown 语法),用于类型转换时保留内容 */
  function extractBlockText(block: Block): string {
    const content = block.content as {
      text?: string
      marks?: Mark[]
      code?: string
      items?: Array<{ text?: string; marks?: Mark[] }>
      headers?: Array<{ text?: string; marks?: Mark[] }>
      rows?: Array<Array<{ text?: string; marks?: Mark[] }>>
      blocks?: Block[]
      alt?: string
    }
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        return marksToSource(content.text ?? '', content.marks ?? [])
      case 'quote': {
        if (content.blocks && content.blocks.length > 0) {
          return serializeMarkdown(content.blocks)
        }
        return marksToSource(content.text ?? '', content.marks ?? [])
      }
      case 'list':
        return (content.items ?? [])
          .map((item) => marksToSource(item.text ?? '', item.marks ?? []))
          .join('\n')
      case 'code_block':
        return content.code ?? ''
      case 'table': {
        const cellToSource = (cell?: { text?: string; marks?: Mark[] }) =>
          marksToSource(cell?.text ?? '', cell?.marks ?? [])
        const header = (content.headers ?? []).map(cellToSource).join(' | ')
        const rows = (content.rows ?? []).map((row) => row.map(cellToSource).join(' | '))
        return [header, ...rows].filter((line) => line !== '').join('\n')
      }
      case 'image':
        return content.alt ?? ''
      default:
        return ''
    }
  }

  function convertBlock(id: string, type: BlockType, label = '转换类型'): boolean {
    const idx = blocks.value.findIndex((b) => b.id === id)
    if (idx === -1) return false
    commit(label)
    const old = blocks.value[idx]
    const newBlock = createBlock(type)
    const textTypes: BlockType[] = ['paragraph', 'heading', 'quote']

    if (old.type === type) {
      // 同类型转换:整体保留内容与属性(避免清空 marks/align 等)
      newBlock.content = JSON.parse(JSON.stringify(old.content))
      newBlock.props = JSON.parse(JSON.stringify(old.props))
    } else if (textTypes.includes(type)) {
      // 目标为文本类块:保留内容与行内格式
      const oldContent = old.content as { text?: string; marks?: Mark[]; blocks?: Block[] }
      const canCopyInline =
        old.type === 'paragraph' ||
        old.type === 'heading' ||
        (old.type === 'quote' && !(oldContent.blocks && oldContent.blocks.length > 0))
      const { text, marks } = canCopyInline
        ? {
            text: oldContent.text ?? '',
            marks: (oldContent.marks ?? []).map((m) => ({ ...m })),
          }
        : parseInlineMarkdown(extractBlockText(old))
      newBlock.content = { text, marks }
      const oldAlign =
        old.type === 'paragraph' || old.type === 'heading'
          ? (old.props as { align?: string }).align
          : undefined
      if (type === 'heading') {
        const oldLevel = old.type === 'heading' ? (old.props as { level?: number }).level : undefined
        newBlock.props = {
          level: oldLevel ?? 2,
          ...(oldAlign ? { align: oldAlign } : {}),
        }
      } else if (type === 'paragraph') {
        newBlock.props = oldAlign ? { align: oldAlign } : {}
      }
    } else if (type === 'list') {
      if (old.type === 'list') {
        // 保留原列表结构(含子块/勾选状态)
        newBlock.content = JSON.parse(JSON.stringify(old.content))
        newBlock.props = JSON.parse(JSON.stringify(old.props))
      } else {
        // 非列表来源:按行拆分为列表项
        const lines = extractBlockText(old)
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
        const items = lines.map((line) => {
          const parsed = parseInlineMarkdown(line)
          return { id: uuid(), text: parsed.text, marks: parsed.marks }
        })
        newBlock.content = {
          items: items.length > 0 ? items : [{ id: uuid(), text: '', marks: [] }],
        }
        newBlock.props = { listType: 'bullet' }
      }
    } else if (type === 'code_block') {
      if (old.type === 'code_block') {
        newBlock.content = JSON.parse(JSON.stringify(old.content))
        newBlock.props = JSON.parse(JSON.stringify(old.props))
      } else {
        newBlock.content = { code: extractBlockText(old) }
        newBlock.props = { language: 'plaintext' }
      }
    } else if (type === 'table') {
      if (old.type === 'table') {
        newBlock.content = JSON.parse(JSON.stringify(old.content))
        newBlock.props = JSON.parse(JSON.stringify(old.props))
      } else {
        // 非表格来源:文本放入表头,保持可编辑结构
        const parsed = parseInlineMarkdown(extractBlockText(old))
        newBlock.content = {
          headers: [{ text: parsed.text, marks: parsed.marks }],
          rows: [],
          aligns: ['left'],
        }
      }
    } else if (type === 'image') {
      if (old.type === 'image') {
        newBlock.content = JSON.parse(JSON.stringify(old.content))
        newBlock.props = JSON.parse(JSON.stringify(old.props))
      }
      // 非图片来源:保留为空图片块,由用户选择/粘贴图片
    }

    newBlock.id = old.id
    newBlock.created_at = old.created_at
    newBlock.updated_at = new Date().toISOString()
    blocks.value[idx] = newBlock
    return true
  }

  function undo() {
    const tab = getActive()
    if (!tab) return
    const snap = tab.history.undo(tab.blocks)
    if (snap) {
      tab.blocks = JSON.parse(JSON.stringify(snap.blocks))
      tab.savedStatus = 'unsaved'
      scheduleAutoSave(tab.id)
      // 递增 renderTick,触发 Mermaid 等需要重新渲染的块更新
      tab.renderTick++
      tab.historyTick++
    }
  }

  function redo() {
    const tab = getActive()
    if (!tab) return
    const snap = tab.history.redo(tab.blocks)
    if (snap) {
      tab.blocks = JSON.parse(JSON.stringify(snap.blocks))
      tab.savedStatus = 'unsaved'
      scheduleAutoSave(tab.id)
      // 递增 renderTick,触发 Mermaid 等需要重新渲染的块更新
      tab.renderTick++
      tab.historyTick++
    }
  }

  function canUndo() {
    const tab = getActive()
    if (!tab) return false
    // 读取 historyTick 建立响应式依赖(markRaw 的 history 内部状态不响应)
    void tab.historyTick
    return tab.history.canUndo()
  }

  function canRedo() {
    const tab = getActive()
    if (!tab) return false
    void tab.historyTick
    return tab.history.canRedo()
  }

  /** 从 Markdown 字符串导入到当前 active tab(覆盖) */
  function importMarkdown(md: string, label = '导入 Markdown') {
    const tab = getActive()
    if (!tab) return
    const parsed = deserializeMarkdown(md)
    replaceBlocks(parsed, label)
    tab.renderTick++
  }

  /** 保存 active tab:有 path 写 vault,无 path 走"另存为"对话框 */
  async function saveToFile() {
    const tab = getActive()
    if (!tab) return
    const ok = await saveMarkdownFile(tab.blocks, tab.meta.title)
    if (ok) tab.savedStatus = 'saved'
  }

  /** 打开 .md 文件(对话框),开新 tab */
  async function openFromFile() {
    const result = await openMarkdownFile()
    if (!result) return false
    const tab = createBlankTab(result.fileName.replace(/\.(md|markdown|txt)$/i, ''))
    tab.blocks = result.blocks
    // 合并 frontmatter meta
    if (result.meta) {
      const fm = result.meta
      if (fm.title) tab.meta.title = fm.title
      if (fm.author) tab.meta.author = fm.author
      if (fm.version) tab.meta.version = fm.version
      if (fm.created_at) tab.meta.created_at = fm.created_at
      if (fm.updated_at) tab.meta.updated_at = fm.updated_at
      if (fm.tags) tab.meta.tags = fm.tags
    }
    tab.history.reset(result.blocks, '打开文档')
    tab.historyTick++
    tab.savedStatus = 'saved'
    openTabs.value.push(tab)
    activeTabId.value = tab.id
    // 延迟到块组件挂载后再递增 renderTick,确保 watch 已注册
    nextTick(() => {
      tab.renderTick++
    })
    return true
  }

  /** 从 vault 打开文件,开新 tab(若已打开则切换) */
  async function openVaultFile(relPath: string) {
    if (!vaultRoot.value) return
    // 已打开则切换
    const existing = openTabs.value.find((t) => t.path === relPath)
    if (existing) {
      activeTabId.value = existing.id
      return
    }
    try {
      const content = await readVaultFile(vaultRoot.value, relPath)
      // 分离 frontmatter 与正文
      const { meta: fmMeta, body } = parseFrontmatter(content)
      const parsed = deserializeMarkdown(body)
      const name = relPath.split('/').pop()?.replace(/\.md$/i, '') ?? '未命名文档'
      const tab = createBlankTab(name)
      tab.path = relPath
      tab.blocks = parsed
      // 合并 frontmatter 到 meta
      if (fmMeta) {
        if (fmMeta.title) tab.meta.title = fmMeta.title
        if (fmMeta.author) tab.meta.author = fmMeta.author
        if (fmMeta.version) tab.meta.version = fmMeta.version
        if (fmMeta.created_at) tab.meta.created_at = fmMeta.created_at
        if (fmMeta.updated_at) tab.meta.updated_at = fmMeta.updated_at
        if (fmMeta.tags) tab.meta.tags = fmMeta.tags
      }
      tab.history.reset(parsed, '打开 vault 文件')
      tab.historyTick++
      tab.savedStatus = 'saved'
      openTabs.value.push(tab)
      activeTabId.value = tab.id
      // 延迟到块组件挂载后再递增 renderTick,确保 watch 已注册
      nextTick(() => {
        tab.renderTick++
      })
    } catch (e) {
      console.error('打开 vault 文件失败:', e)
    }
  }

  /** 保存 active tab 到 vault(若 path 为 null 则提示用户先另存为) */
  async function saveActiveToVault(): Promise<boolean> {
    const tab = getActive()
    if (!tab) return false
    if (!vaultRoot.value || !tab.path) {
      // 走"另存为"对话框
      const ok = await saveMarkdownFile(tab.blocks, tab.meta.title)
      if (ok) tab.savedStatus = 'saved'
      return ok
    }
    tab.savedStatus = 'saving'
    try {
      const content = serializeMarkdownWithMeta(tab.blocks, tab.meta)
      await writeVaultFile(vaultRoot.value, tab.path, content)
      if (tab.savedStatus === 'saving') {
        tab.savedStatus = 'saved'
      }
      return true
    } catch (e) {
      console.error('保存到 vault 失败:', e)
      tab.savedStatus = 'unsaved'
      return false
    }
  }

  /** 清理指定 tab 的 saveTimer(关闭 tab 前调用) */
  function disposeTab(id: string) {
    const existing = saveTimers.get(id)
    if (existing) {
      clearTimeout(existing)
      saveTimers.delete(id)
    }
  }

  /** 关闭指定 tab,返回是否实际关闭 */
  function closeTab(id: string) {
    const idx = openTabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return false
    disposeTab(id)
    openTabs.value.splice(idx, 1)
    if (openTabs.value.length === 0) {
      activeTabId.value = ''
    } else if (activeTabId.value === id) {
      const newIdx = Math.min(idx, openTabs.value.length - 1)
      activeTabId.value = openTabs.value[newIdx].id
    }
    return true
  }

  /** 关闭其他 tab */
  function closeOtherTabs(id: string) {
    const keep = openTabs.value.find((t) => t.id === id)
    if (!keep) return
    // 清理被关闭 tab 的 saveTimer
    for (const t of openTabs.value) {
      if (t.id !== id) disposeTab(t.id)
    }
    openTabs.value = [keep]
    activeTabId.value = keep.id
  }

  /** 关闭右侧 tab */
  function closeTabsToRight(id: string) {
    const idx = openTabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    // 清理被关闭 tab 的 saveTimer
    for (const t of openTabs.value.slice(idx + 1)) {
      disposeTab(t.id)
    }
    openTabs.value = openTabs.value.slice(0, idx + 1)
    if (!openTabs.value.find((t) => t.id === activeTabId.value)) {
      activeTabId.value = openTabs.value[openTabs.value.length - 1].id
    }
  }

  /** 关闭所有 tab(真清空,显示鲨鱼空状态) */
  function closeAllTabs() {
    for (const timer of saveTimers.values()) {
      clearTimeout(timer)
    }
    saveTimers.clear()
    openTabs.value = []
    activeTabId.value = ''
  }

  /** 切换 active tab */
  function switchTab(id: string) {
    if (openTabs.value.find((t) => t.id === id)) {
      activeTabId.value = id
    }
  }

  /** 移动 tab 到指定位置 */
  function moveTab(fromId: string, toIndex: number) {
    const fromIdx = openTabs.value.findIndex((t) => t.id === fromId)
    if (fromIdx === -1) return
    const clampedTo = Math.max(0, Math.min(toIndex, openTabs.value.length - 1))
    if (fromIdx === clampedTo) return
    const [moved] = openTabs.value.splice(fromIdx, 1)
    openTabs.value.splice(clampedTo, 0, moved)
  }

  /** 新建 tab(必须指定 vault 相对路径) */
  function createNewTab(path: string, title?: string) {
    const name = title ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? '未命名文档'
    const tab = createBlankTab(name)
    tab.path = path
    openTabs.value.push(tab)
    activeTabId.value = tab.id
    return tab.id
  }

  /** 设置 active tab 的 vault 路径(另存为后用) */
  function setActivePath(path: string) {
    const tab = getActive()
    if (tab) tab.path = path
  }

  function exportMarkdown(): string {
    return serializeMarkdown(blocks.value)
  }

  /** 导出 Markdown 文件(弹出保存对话框) */
  async function exportMarkdownFile(): Promise<boolean> {
    const tab = getActive()
    if (!tab) return false
    const content = serializeMarkdownWithMeta(tab.blocks, tab.meta)
    const filters: SaveFileFilter[] = [
      { name: 'Markdown 文件', extensions: ['md'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] },
    ]
    return saveFile(content, `${tab.meta.title}.md`, filters, 'text/markdown;charset=utf-8')
  }

  /** 导出 HTML 文件(弹出保存对话框) */
  async function exportHtmlFile(options: HtmlExportOptions): Promise<boolean> {
    const tab = getActive()
    if (!tab) return false
    const content = await serializeHtml(tab.blocks, tab.meta, options)
    const filters: SaveFileFilter[] = [
      { name: 'HTML 文件', extensions: ['html', 'htm'] },
      { name: '所有文件', extensions: ['*'] },
    ]
    return saveFile(content, `${tab.meta.title}.html`, filters, 'text/html;charset=utf-8')
  }

  function setTitle(title: string) {
    const tab = getActive()
    if (!tab) return
    tab.meta.title = title
    tab.meta.updated_at = new Date().toISOString()
    tab.savedStatus = 'unsaved'
    scheduleAutoSave(tab.id)
  }

  /** 新建文档(开新 tab,不覆盖当前) */
  function newDocument() {
    // 无 path 不允许新建:改为触发"打开文件"对话框
    void openFromFile()
  }

  /** 设置 vault 根路径 */
  async function setVaultRoot(path: string | null) {
    vaultRoot.value = path
    if (path) {
      try {
        vaultTree.value = await readVaultTree(path)
      } catch (e) {
        console.error('加载 vault 文件树失败:', e)
        vaultTree.value = []
      }
    } else {
      vaultTree.value = []
    }
    const { usePluginStore } = await import('@/stores/plugin')
    const plugins = usePluginStore()
    await plugins.init(path)
  }

  /** 刷新 vault 文件树 */
  async function refreshVaultTree() {
    if (!vaultRoot.value) return
    try {
      vaultTree.value = await readVaultTree(vaultRoot.value)
      vaultTreeTick.value++
    } catch (e) {
      console.error('刷新 vault 文件树失败:', e)
    }
  }

  /** 打开 wikilink(按文件名查找后在新 tab 打开) */
  async function openWikilink(target: string) {
    if (!vaultRoot.value) return
    const relPath = findFileByName(vaultTree.value, target)
    if (relPath) {
      await openVaultFile(relPath)
    } else {
      console.warn(`Wikilink 目标不存在: ${target}`)
    }
  }

  return {
    // state
    openTabs,
    activeTabId,
    vaultRoot,
    vaultTree,
    vaultTreeTick,
    // 兼容字段(computed getter+setter)
    blocks,
    meta,
    savedStatus,
    renderTick,
    activeTabPath,
    // getters
    outline,
    wordCount,
    blockCount,
    pageCount,
    markdown,
    // actions:作用于 active tab
    updateBlock,
    insertBlockAfter,
    appendBlock,
    removeBlock,
    moveBlockUp,
    moveBlockDown,
    duplicateBlock,
    convertBlock,
    undo,
    redo,
    canUndo,
    canRedo,
    importMarkdown,
    saveToFile,
    openFromFile,
    exportMarkdown,
    exportMarkdownFile,
    exportHtmlFile,
    setTitle,
    newDocument,
    replaceBlocks,
    batch,
    // tab 管理
    openVaultFile,
    saveActiveToVault,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    switchTab,
    moveTab,
    createNewTab,
    setActivePath,
    setVaultRoot,
    refreshVaultTree,
    openWikilink,
    scheduleAutoSave,
  }
})
