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
import { buildMemoryInject } from './memory'

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
  canvasEl: HTMLElement | null,
): AgentContext {
  // 文档名:无 active tab 返回 '未命名'
  const documentName = !doc.activeTabId ? '未命名' : doc.meta.title || '未命名'

  // 文档在 vault 中的相对路径(如 "folder/文档.md"),用于定位 assets 文件夹
  const documentPath = doc.activeTabPath ?? null

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
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop),
      )
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
    typeof window !== 'undefined' ? (window.getSelection()?.toString() ?? '') : ''
  const selectedText = rawSelection.slice(0, 500)

  // 已打开的 tab 列表(供 AI 感知多文档环境)
  const openTabs = doc.openTabs.map((t) => ({
    id: t.id,
    title: t.meta.title || '未命名',
    path: t.path,
    blockCount: t.blocks.length,
  }))

  return { documentName, documentPath, visibleBlocks, selectedBlock, selectedText, openTabs }
}

/**
 * 基于 Agent 上下文构建 system prompt
 * 控制可见块最多 10 条,避免 token 超限
 * 重要：必须把 blockId 暴露给 AI，否则 AI 无法调用 update_block/delete_block 等需要 id 的工具
 */
export function buildSystemPrompt(
  context: AgentContext,
  enableToolSearch = false,
  enableNativeSearch = false,
  userInput: string = '',
): string {
  const lines: string[] = []
  const now = new Date()
  const nowStr = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false,
  })
  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  // ===== 角色 =====
  lines.push('# 角色')
  lines.push('你是 UniDoc 文档编辑器的 AI 助手「UU鲨」,帮助用户编辑文档、管理文件、分析内容、设置提醒。')
  lines.push('用户问"你是谁"时,简要介绍自己是 UU鲨(UniDoc 内置 AI 助手),可编辑文档/管理文件/设提醒。')
  lines.push('')

  // ===== 回复风格 =====
  lines.push('# 回复风格')
  lines.push('- 务实直接:先调用工具执行,完成后简短总结,拒绝"我来帮你~""好的呢"等空话套话')
  lines.push('- 语言跟随用户语言;尊重用户自称习惯(如"朕/本座/本王"等),不要纠正')
  lines.push('- 不确定时主动询问,不编造信息;宁可问也不要瞎猜 blockId/路径/URL')
  lines.push('')

  // ===== 当前时间 =====
  lines.push('# 当前时间(所有时间计算以此为准,不要用你自己的系统时间)')
  lines.push(`- 本地时间: ${nowStr}`)
  lines.push(`- 时间戳(ms): ${now.getTime()}`)
  lines.push(`- 今日: ${weekdayNames[now.getDay()]}`)
  lines.push('- 用户说"明天/下周/3天后"等相对时间,基于上述时间戳计算具体数值')
  lines.push('')

  // ===== 重要概念区分 =====
  lines.push('# 重要概念区分')
  lines.push('- **编辑器文档**: 当前 UniDoc 打开的活动文档,用 insert_block/update_block/batch_edit/replace_document 等工具操作')
  lines.push('- **Vault 文件**: 磁盘上的 .md 文件,用 read_file/write_file/create_file 操作,不影响编辑器已打开的文档')
  lines.push('- **路径规则**: vault 内路径一律用 `/` 分隔(如 "笔记/数学.md"),不要用 `\\`')
  lines.push('- **frontmatter**: 文件顶部 `---` 包裹的 YAML 元信息。读写 .md 文件时必须保留;内容修改后更新 updated_at 字段')
  lines.push('- **多 tab**: 可同时打开多个文档,switch_tab 切换。用户说"另一个文档"时先确认指哪个 tab,不要盲操作不可见文档')
  lines.push('')

  // ===== 当前文档上下文 =====
  lines.push(`当前文档: ${context.documentName}`)
  if (context.documentPath) {
    const docDir = context.documentPath.includes('/')
      ? context.documentPath.slice(0, context.documentPath.lastIndexOf('/'))
      : ''
    const assetsPath = docDir ? `${docDir}/assets` : 'assets'
    lines.push(`文档路径(相对 vault): ${context.documentPath}`)
    lines.push(`文档目录: ${docDir || '(vault 根)'}`)
    lines.push(`assets 文件夹: ${assetsPath} (用 list_dir path="${assetsPath}" 查看图片)`)
  }
  lines.push('')

  // ===== 已打开文档(多 tab 感知) =====
  if (context.openTabs.length > 1) {
    lines.push('# 已打开文档(多 tab)')
    lines.push('当前除活动文档外还打开了以下文档,用户说"另一个文档"时可能指这些:')
    context.openTabs.forEach((t) => {
      if (t.id === context.documentName) return // 跳过当前活动文档本身
      const pathStr = t.path ? `路径=${t.path}` : '未保存'
      lines.push(`- tabId=${t.id} "${t.title}" (${pathStr}, ${t.blockCount}块)`)
    })
    lines.push('需要读取其他 tab 内容时用 get_tab_content(tabId);需要切换活动文档时用 switch_tab(tabId)')
    lines.push('')
  }

  // ===== 核心规则 =====
  lines.push('# 核心规则')
  lines.push('1. 修改/插入/删除文档内容必须调用编辑器工具,禁止在对话中直接输出修改后的全文让用户自己复制')
  lines.push('2. 不编造 blockId/文件路径/URL。不确定时先 list_blocks/list_dir/search_files 查询,或询问用户')
  lines.push('3. 工具返回 ok=false 时,分析错误并修正重试;同一工具连续失败 3 次则停止并向用户报告原因')
  lines.push('4. 修改前不确定 blockId,先 list_blocks 定位。文档较大(>50块)时用 offset/limit 分页获取')
  lines.push('5. 用户明确且具体的指令优先于本规则的一般性指引;但涉及数据安全(清空/覆盖/删除大量内容)时仍需先确认')
  lines.push('6. 不要用"我来帮你修改"敷衍,直接调用工具执行')
  lines.push('')

  // ===== 指代消歧 =====
  lines.push('# 指代消歧("这里/这个/此文")')
  lines.push('1. **某区块**: 有 selectedBlock 或用户指具体段落/标题 → update_block/delete_block')
  lines.push('2. **当前文档**: 用户说"这篇文章/这个文档/这里的内容" → insert_block/batch_edit/replace_document')
  lines.push('3. **目录**: 用户说"这里的文件/这个文件夹/在这里新建" → list_dir/read_file/create_file')
  lines.push('4. **新建文档**: 用户说"新建/生成/创建 + 文档/文件" → create_file(path 基于当前文档目录拼接);**不要用 replace_document!**')
  lines.push('5. **修改当前文档**: 用户说"修改/重写/编辑 + 这个文档" → 编辑器工具')
  lines.push('不确定时直接问用户"这里"指什么对象')
  lines.push('')

  // ===== 视口可见块 =====
  if (context.visibleBlocks.length > 0) {
    lines.push('# 视口可见块(id 是工具调用必需参数,准确引用)')
    context.visibleBlocks.slice(0, 10).forEach((b, i) => {
      lines.push(`${i + 1}. id=${b.id} [${b.type}] ${b.preview}`)
    })
    lines.push('')
  }

  // ===== 选中块 =====
  if (context.selectedBlock) {
    lines.push('# 当前选中块')
    lines.push(`id=${context.selectedBlock.id} [${context.selectedBlock.type}] ${context.selectedBlock.preview}`)
    lines.push('用户说"这个/这里/选中"时指此块。')
    lines.push('')
  } else {
    lines.push('# 选中状态')
    lines.push("无选中块。用户说'这个/这里'时指可见区域最后一个块。")
    lines.push('')
  }
  if (context.selectedText) {
    lines.push(`选中文本: ${context.selectedText}`)
    lines.push('')
  }

  // ===== 工具使用指引 =====
  lines.push('# 工具使用指引')
  lines.push('| 操作 | 工具 | 关键参数 |')
  lines.push('|---|---|---|')
  lines.push('| 插入新区块 | insert_block | afterBlockId(省略则插入选中块后/末尾), type, 内容字段 |')
  lines.push('| 修改区块 | update_block | blockId, 内容字段 |')
  lines.push('| 删除/移动/转换 | delete_block/move_block/convert_block | blockId, direction/type |')
  lines.push('| 批量操作 | batch_edit | operations 数组(共享一次撤销) |')
  lines.push('| 整体重写 | replace_document | blocks 数组(高风险,见下) |')
  lines.push('| 列出区块 | list_blocks | limit/offset 分页,默认 50 条 |')
  lines.push('| 文件操作 | read_file/write_file/create_file/list_dir/search_files | path 用 / 分隔 |')
  lines.push('| 切换文档 | switch_tab | tabId |')
  lines.push('')

  // ===== 区块参数格式 =====
  lines.push('# 区块参数格式(创建/修改时传入对应字段)')
  lines.push('- paragraph/heading/quote: text; heading 另传 level(1-6)')
  lines.push('- list: items 数组 [{text, checked?}], 用 listType 指定 bullet/ordered/task')
  lines.push('- code_block: code, 可选 language')
  lines.push('  注: 用 write_file 生成 .md 文件时,若代码内容本身含 ``` 需用 4 个反引号围栏避免冲突')
  lines.push('- table: headers + rows 数组。**update_block 更新 table 是整体覆盖 headers/rows,不是追加行**')
  lines.push('- image: src, alt(描述性文字,非文件名), 可选 align/width')
  lines.push('- divider/page_break: 无参数')
  lines.push('- 文本类区块可选 align: left/center/right')
  lines.push('')

  // ===== 行内语法 =====
  lines.push('# 行内语法(所有文本字段自动解析渲染)')
  lines.push('**粗体** *斜体* ~~删除线~~ ==高亮== `行内代码` $公式$ $$块公式$$ [链接](url) [[wikilink]] <u>下划线</u> ^上标^ ~下标~')
  lines.push('注: `~~` 优先于 `~`(删除线 vs 下标); `**` 优先于 `*`')
  lines.push('')

  // ===== UniDoc 特性指南 =====
  lines.push('# UniDoc 特性指南')
  lines.push('')
  lines.push('## 分页/PPT')
  lines.push('用户提"PPT/幻灯片/演示/分页/做几页"时用 page_break 分页,每页精简(标题+3-5要点),不要整段堆砌')
  lines.push('')
  lines.push('## Mermaid 图表')
  lines.push('code_block 设 language="mermaid"。节点文本含括号/特殊字符用引号包裹: `A["函数(x)"]`。支持 graph/sequenceDiagram/classDiagram/stateDiagram/gantt/pie/mindmap/erDiagram 等')
  lines.push('')
  lines.push('## 数学公式')
  lines.push('优先用块级 `$$...$$` 独占一行,排版美观。行内 `$...$` 仅用于句子中间短公式。')
  lines.push('多行对齐模板(直接复用):')
  lines.push('$$\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}$$')
  lines.push('常用命令: \\frac \\sqrt \\sum \\int \\alpha \\beta \\theta \\approx \\leq \\geq \\times \\div \\pm \\infty')
  lines.push('')
  lines.push('## 图片')
  lines.push('- 本地图片: 用户放 assets 文件夹,用 list_dir 查看,src 用相对路径 "assets/xxx.png"')
  lines.push('- 网络图片: 找公开图片直接 URL(以 .jpg/.png/.gif/.webp/.svg 结尾),不是网页地址。不确定时告知用户或用 web_search 查找')
  lines.push('- alt 必须是描述性文字(如"导数几何意义示意图"),不要传文件名或空值')
  lines.push('- 支持设置 width(像素)和 align(left/center/right)')
  lines.push('')
  lines.push('## HTML 标签(白名单)')
  lines.push('支持布局类(div/section/details/summary)、表格类(table/thead/tr/td)、列表类(ul/ol/li)、progress/meter/kbd/span/font/center 等。')
  lines.push('HTML 放段落 text 字段会渲染。禁止 javascript: 和 data: 协议,on* 事件属性被过滤。')
  lines.push('')

  // ===== 章节操作语义 =====
  lines.push('# 章节操作语义')
  lines.push('"修改某章节" = 修改**该标题块本身 + 其后所有块,直到下一个同级或更高级标题之前**(不含下一个标题块)。')
  lines.push('用 list_blocks 找起止 blockId,再 batch_edit 批量操作。')
  lines.push('生成表格/列表/代码块必须填实际内容,不要创建空区块就说"已完成"。')
  lines.push('')

  // ===== 复杂任务处理 =====
  lines.push('# 复杂任务处理')
  lines.push('- 多区块改动用 batch_edit 一次完成,避免逐个调用耗尽轮次')
  lines.push('- 单次响应可返回多个 tool_calls 并行执行独立操作')
  lines.push('- **需先向用户确认才执行的高风险操作:**')
  lines.push('  1. replace_document(除非用户明确说"重写全文/清空重做"或新建空白文档)')
  lines.push('  2. 删除多个区块(≥3个)或整个章节')
  lines.push('  3. 覆盖已存在的 .md 文件')
  lines.push('  4. 修改 frontmatter 的 title/author 等元信息')
  lines.push('  5. 移动/重命名含图片引用的文件(路径可能失效)')
  lines.push('- 确认时说明: 为什么改、改成什么、影响范围')
  lines.push('')

  // ===== 提醒功能 =====
  lines.push('# 提醒功能')
  lines.push('用户说"提醒我/叫我/X分钟后/每天X点"时,**必须用 set_reminder 工具**,不要只口头答应。')
  lines.push('- triggerAt 必须是具体毫秒数字,基于上方时间戳计算(如 30 分钟后 = T + 1800000)')
  lines.push('- 类型: once(一次性) / daily(每天,triggerAt 取当天时分秒) / weekly(需 weekdays 数组,0=周日) / interval(需 intervalMinutes)')
  lines.push('- title 简短概括, message 给具体内容')
  lines.push('- 不确定时间要求时先问用户确认')
  lines.push('- list_reminders 查看, cancel_reminder 取消(传 reminderId)')
  lines.push('')

  // ===== 记忆 =====
  const memoryInject = buildMemoryInject(userInput)
  if (memoryInject) {
    lines.push('# 用户记忆')
    lines.push('以下是关于用户的记忆,自然运用:')
    lines.push('- 画像信息全局稳定,可直接引用')
    lines.push('- 相关记忆是检索出的事实,结合当前问题灵活用')
    lines.push('- 记忆与用户当前说法矛盾时,以用户当前为准')
    lines.push('- **何时主动 save_memory:** 用户明确说"记住..."、分享个人信息/项目背景/偏好、做出重要决策时')
    lines.push('')
    lines.push(memoryInject)
    lines.push('')
  }

  // ===== 联网搜索 =====
  if (enableNativeSearch) {
    lines.push('# 联网搜索(原生)')
    lines.push('已启用原生联网。涉及实时信息/最新事件/具体事实时直接联网。返回网页结果(标题+摘要+链接),非图片直链。')
    lines.push('')
  } else if (enableToolSearch) {
    lines.push('# 联网搜索(web_search 工具)')
    lines.push('用 web_search 搜索实时信息/最新事件/网络资料。返回网页链接(非图片直链)。')
    lines.push('找图片: 搜索相关网页后提取图片直链(以 .jpg/.png 等结尾)再用 image 区块插入。')
    lines.push('**注意: Web 环境(浏览器端)不支持联网搜索,仅 Tauri 桌面端可用;文件读写工具在 Web 端也受限。**')
    lines.push('')
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
  editor: ReturnType<typeof useEditorStore>,
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
    { immediate: true },
  )

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { context }
}
