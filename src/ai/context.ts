/**
 * UniDoc AI Agent 上下文构建模块
 *
 * 聚合当前文档状态(文档名、视口可见块、选中块、选中文本)为 AgentContext,
 * 并据此生成发送给 LLM 的 system prompt。
 * 供 AI 聊天面板在每次发起请求前调用,让模型感知用户当前的编辑上下文。
 */

import type { AgentContext, AgentContextBlock } from './types'
import type { Block } from '@/core/blocks/types'
import { ref, watch, onUnmounted, type Ref } from 'vue'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'

/** 将文本截断到 max 字符,超出时追加省略号 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

/**
 * 按块类型格式化预览文本
 * 把 Block 转成精简的 AgentContextBlock,便于塞进 system prompt 而不超 token
 */
export function formatBlockPreview(block: Block): AgentContextBlock {
  const { type, content, props } = block
  let preview = ''

  switch (type) {
    case 'paragraph': {
      const text = (content as { text?: string }).text ?? ''
      preview = truncate(text, 200)
      break
    }
    case 'heading': {
      const text = (content as { text?: string }).text ?? ''
      const level = (props as { level?: number }).level ?? 1
      preview = '#'.repeat(level) + ' ' + truncate(text, 200)
      break
    }
    case 'quote': {
      const text = (content as { text?: string }).text ?? ''
      preview = '> ' + truncate(text, 200)
      break
    }
    case 'list': {
      const items = (content as { items?: { text?: string }[] }).items ?? []
      const text = items.map((it) => '- ' + (it.text ?? '')).join(' ')
      preview = truncate(text, 200)
      break
    }
    case 'code_block': {
      const code = (content as { code?: string }).code ?? ''
      preview = '```' + truncate(code, 100)
      break
    }
    case 'table': {
      const headers = (content as { headers?: unknown[] }).headers ?? []
      const rows = (content as { rows?: unknown[][] }).rows ?? []
      preview = `表格 ${headers.length}列 ${rows.length + 1}行`
      break
    }
    case 'image': {
      const src = (content as { src?: string }).src ?? ''
      const alt = (content as { alt?: string }).alt ?? ''
      preview = `![${alt}](${src})`
      break
    }
    case 'divider':
      preview = '---'
      break
    case 'page_break':
      preview = '分页符'
      break
    default:
      preview = truncate(JSON.stringify(content), 100)
  }

  return { id: block.id, type: block.type, preview }
}

/**
 * 构建 Agent 上下文
 *
 * @param doc       文档 store 实例
 * @param editor    编辑器 store 实例
 * @param canvasEl  画布根元素(包含 [data-block-id] 子节点),用于计算视口可见块
 */
export function buildContext(
  doc: ReturnType<typeof useDocumentStore>,
  editor: ReturnType<typeof useEditorStore>,
  canvasEl: HTMLElement | null
): AgentContext {
  // 文档名:无 active tab 返回 '未命名'
  const documentName = !doc.activeTabId
    ? '未命名'
    : doc.meta.title || '未命名'

  // 视口可见块:遍历画布内所有 [data-block-id] 节点,按与视口的可见高度占比过滤
  const visibleBlocks: AgentContextBlock[] = []
  if (canvasEl) {
    const canvasRect = canvasEl.getBoundingClientRect()
    const viewportTop = canvasRect.top
    const viewportBottom = canvasRect.bottom
    const nodes = canvasEl.querySelectorAll('[data-block-id]')
    nodes.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect()
      if (rect.height <= 0) return
      const visibleHeight =
        Math.max(0, Math.min(rect.bottom, viewportBottom) -
          Math.max(rect.top, viewportTop))
      const visibleRatio = visibleHeight / rect.height
      if (visibleRatio <= 0.3) return
      const blockId = el.getAttribute('data-block-id')
      if (!blockId) return
      const block = doc.blocks.find((b) => b.id === blockId)
      if (!block) return
      visibleBlocks.push(formatBlockPreview(block))
    })
  }

  // 选中块
  let selectedBlock: AgentContextBlock | null = null
  const selectedBlockId = editor.selectedBlockId
  if (selectedBlockId) {
    const block = doc.blocks.find((b) => b.id === selectedBlockId)
    if (block) selectedBlock = formatBlockPreview(block)
  }

  // 选中文本(截取前 500 字)
  const rawSelection =
    typeof window !== 'undefined' ? window.getSelection()?.toString() ?? '' : ''
  const selectedText = rawSelection.slice(0, 500)

  return { documentName, visibleBlocks, selectedBlock, selectedText }
}

/**
 * 基于 Agent 上下文构建 system prompt
 * 控制可见块最多 10 条,避免 token 超限
 * 重要：必须把 blockId 暴露给 AI，否则 AI 无法调用 update_block/delete_block 等需要 id 的工具
 */
export function buildSystemPrompt(context: AgentContext, enableToolSearch = false, enableNativeSearch = false): string {
  const lines: string[] = []

  lines.push('# 角色')
  lines.push('你是 UniDoc 文档编辑器的 AI 助手「UU鲨」,可以帮用户编辑文档、管理文件、分析内容。')
  lines.push('')
  lines.push('# 核心规则（必须严格遵守）')
  lines.push('1. 凡是涉及修改/插入/删除/移动/转换文档内容的请求,必须调用工具完成,绝对不能在对话中直接输出修改后的内容。')
  lines.push('2. 工具调用完成后,检查返回结果中的 preview 字段验证修改是否成功。如果 preview 为空或与预期不符,重新调用工具。')
  lines.push('3. 修改文档前,如果不确定目标区块的 blockId,先调用 list_blocks 工具获取完整区块列表,再从中定位目标。')
  lines.push('4. 如果工具返回 ok=false,分析错误信息并修正后重新调用。')
  lines.push('5. 不要用"我来帮你修改"之类的话敷衍,直接调用工具并执行。')
  lines.push('')
  lines.push(`当前文档: ${context.documentName}`)

  if (context.visibleBlocks.length > 0) {
    lines.push('')
    lines.push('视口可见块（id 是工具调用的必需参数,请准确引用）:')
    context.visibleBlocks.slice(0, 10).forEach((b, i) => {
      lines.push(`${i + 1}. id=${b.id} [${b.type}] ${b.preview}`)
    })
  }

  if (context.selectedBlock) {
    lines.push('')
    lines.push(`当前选中块: id=${context.selectedBlock.id} [${context.selectedBlock.type}] ${context.selectedBlock.preview}`)
    lines.push('用户说"这个/这里/选中"时指代上述选中块。')
  } else {
    lines.push('')
    lines.push("用户说'这个/这里/选中'时指代当前可见区域最后一个块。")
  }

  if (context.selectedText) {
    lines.push(`选中文本: ${context.selectedText}`)
  }

  lines.push('')
  lines.push('# 工具使用指引')
  lines.push('- 插入新区块: 使用 insert_block,afterBlockId 传锚点区块 id')
  lines.push('- 修改区块文本/属性: 使用 update_block,blockId 传目标区块 id')
  lines.push('- 删除区块: 使用 delete_block')
  lines.push('- 移动区块: 使用 move_block')
  lines.push('- 转换区块类型: 使用 convert_block')
  lines.push('- 获取完整区块列表: 使用 list_blocks（修改前不确定 id 时必须先调用）')
  lines.push('')
  lines.push('# 各区块类型的参数格式（重要！创建/修改区块时必须传入对应内容）')
  lines.push('- paragraph/heading/quote: 传 text 字段;heading 额外传 level(1-6)')
  lines.push('- list: 传 items 数组,每项 {text:"内容",checked:false}')
  lines.push('- code_block: 传 code 字段(代码内容),可选 language')
  lines.push('- table: 传 headers 数组(如 ["列1","列2"]) 和 rows 数组(如 [["a","b"],["c","d"]])。不要创建空表格!')
  lines.push('- image: 传 src 和 alt')
  lines.push('- divider/page_break: 无需额外参数')
  lines.push('')
  lines.push('# 章节操作语义（重要）')
  lines.push('- "修改某个章节"指的是修改该标题及其下所有内容块(直到下一个同级或更高级标题),不只是改标题文本!')
  lines.push('- 用户说"修改第二章/这个章节"时,应先用 list_blocks 获取区块列表,找到该标题及其下所有块,然后用 batch_edit 批量更新。')
  lines.push('- 生成表格/列表/代码块时,必须填入实际内容,不要创建空区块后就说"已完成"。')
  lines.push('')
  lines.push('# 复杂任务处理（重要）')
  lines.push('- 需要一次性修改/插入/删除多个区块时,使用 batch_edit 工具,把多个操作放在 operations 数组里一次完成,而不是逐个调用工具。')
  lines.push('- 需要重写整篇文章、大段重构、整体替换文档内容时,使用 replace_document 工具,直接传入新的 blocks 数组。')
  lines.push('- 单次响应中也可以返回多个 tool_calls 并行执行多个独立工具。')
  lines.push('- 优先选择批量工具,避免逐个操作导致轮次耗尽。')

  if (enableNativeSearch) {
    lines.push('')
    lines.push('# 联网搜索')
    lines.push('你已启用联网搜索功能。当用户的问题涉及实时信息、最新事件、具体事实或需要查找网络资料时,你可以直接联网搜索并给出回答。')
  } else if (enableToolSearch) {
    lines.push('')
    lines.push('# 联网搜索')
    lines.push('你已启用联网搜索功能。当用户的问题涉及实时信息、最新事件、具体事实或需要查找网络资料时,请使用 web_search 工具搜索。搜索后结合搜索结果和你的知识给出回答。')
  }

  return lines.join('\n')
}

/**
 * 滚动防抖的可见块上下文 composable
 * 监听 canvasEl 的 scroll 事件,200ms 防抖后重新计算可见块
 * 用于 UI 实时展示当前上下文（如未来在浮窗中显示"AI 已感知到 N 个可见块"）
 */
export function useScrollContext(
  canvasEl: Ref<HTMLElement | null>,
  doc: ReturnType<typeof useDocumentStore>,
  editor: ReturnType<typeof useEditorStore>
): { context: Ref<AgentContext | null> } {
  const context = ref<AgentContext | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function refresh() {
    context.value = buildContext(doc, editor, canvasEl.value)
  }

  function debouncedRefresh() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(refresh, 200)
  }

  watch(
    canvasEl,
    (el, _oldEl, onCleanup) => {
      if (!el) {
        context.value = null
        return
      }
      el.addEventListener('scroll', debouncedRefresh)
      refresh()
      onCleanup(() => el.removeEventListener('scroll', debouncedRefresh))
    },
    { immediate: true }
  )

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { context }
}
