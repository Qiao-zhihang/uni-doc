/**
 * AI 气泡富文本渲染器(Plan C:零新增运行时依赖)
 *
 * 与旧实现(src/ai/markdown.ts 的逐行正则渲染器)的分工:
 *   - src/ai/markdown.ts        流式输出期间使用的轻量渲染器(快、容错)
 *   - src/ai/renderBubble.ts    回答完成后的完整渲染器(本文件)
 *
 * 渲染方式:
 *   块级 → 复用文档侧 deserializeMarkdown()(mdast):标题/段落/嵌套列表/任务列表/
 *          引用(含内嵌块)/管道表格/围栏代码/Obsidian 与标准图片/HTML 块
 *   行内 → 复用 marksToHtml()(消费 deserializeMarkdown 算好的 marks):
 *          粗体/斜体/删除线/行内码/<u>/==高亮==/^上标^/~下标~/链接/wikilink/
 *          图片/KaTeX 公式($…$ 与 $$…$$)/白名单原始 HTML
 *   脚注 → 本文件自实现的预扫描(文档侧尚无脚注语法),零依赖
 *   异步 → 图片路径解析与 Mermaid 由组件侧后置通道处理,本文件只产出带
 *          data-md-lazy 占位的 HTML
 *
 * 关键约束(踩过的坑):
 *   1) 行内**必须**用 deserializeMarkdown 算好的 marks,不能用 parseInlineMarkdown
 *      重新解析 content.text —— 字面转义(如 \*\*不是粗体\*\*)会因为二次解析被
 *      错误地当成语法(参见 marks.ts:sameAsSource 的同类问题)
 *   2) 脚注引用在**进 mdast 之前**改写成白名单内的 <a id/class>,不能用 href="#…"
 *      —— 路由是 createWebHashHistory,hash 会被当成路由跳转 → 页面白屏
 *   3) 代码围栏内的内容不做任何改写(否则代码示例里的 [^1] / ![]() 会被破坏)
 *
 * 安全模型:
 *   所有 HTML 只能经由 parseInlineMarkdown 的白名单进入(on* 剥离、URL 协议白名单、
 *   style 净化均在解析期完成);本文件自己拼装的标签只使用字面量 + escapeText/escapeAttr。
 */

import type {
  Block,
  Mark,
  ParagraphContent,
  HeadingContent,
  HeadingProps,
  ListContent,
  ListProps,
  QuoteContent,
  CodeBlockContent,
  CodeBlockProps,
  TableContent,
  TableCell,
  ImageContent,
} from '@/core/blocks/types'
import { marksToHtml } from '@/components/blocks/marks'
import { parseInlineMarkdown, unescapeLegacyCodeSpan } from '@/core/parser/inlineMarkdown'
import { deserializeMarkdown } from '@/core/serializer/markdown'

export interface BubbleRenderOptions {
  /** 消息唯一前缀,用于脚注锚点 id 隔离(同一会话多条消息不冲突) */
  idPrefix?: string
  /** 是否允许原始 HTML(默认 true)。关闭时剥离 html mark,但保留脚注锚点 */
  rawHtml?: boolean
}

interface Ctx {
  rawHtml: boolean
  prefix: string
}

/** AI 内部提示标记(带图消息会把 vault 路径塞进用户消息),渲染前必须剥离 */
const INTERNAL_RE = /__AI_INTERNAL__:[\s\S]*?__AI_INTERNAL_END__/g

export function stripInternalMarkers(text: string): string {
  return (text ?? '').replace(INTERNAL_RE, '').trim()
}

// ===================== 转义工具 =====================

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

// ===================== 脚注 =====================

interface FootnoteDef {
  id: string
  text: string
}

const FENCE_RE = /^\s*(?:```|~~~)/
const FN_DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/

/** 抽出脚注定义行(含缩进续行),并从正文中移除;围栏代码块内不处理 */
function extractFootnoteDefs(md: string): { body: string; defs: FootnoteDef[] } {
  const lines = md.split('\n')
  const out: string[] = []
  const defs: FootnoteDef[] = []
  const seen = new Set<string>()
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const m = FN_DEF_RE.exec(line)
    const id = m?.[1] ?? ''
    if (m && id && !seen.has(id)) {
      seen.add(id)
      let text = m[2] ?? ''
      // 续行:缩进 2 空格以上或 Tab,且非空行
      while (i + 1 < lines.length && /^(?: {2,}|\t)\S/.test(lines[i + 1] ?? '')) {
        i++
        text += '\n' + (lines[i] ?? '').trim()
      }
      defs.push({ id, text })
      out.push('')
      continue
    }
    out.push(line)
  }
  return { body: out.join('\n'), defs }
}

/**
 * 把 [^id] 改写为白名单内的锚点。编号按"首次引用顺序"。
 * 用 id + class 承载(两者都在 HTML 属性白名单里),不用 href:
 * hash 路由下 href="#fn-1" 会被 vue-router 当成路由跳转。
 */
function substituteFootnoteRefs(
  md: string,
  defs: FootnoteDef[],
  prefix: string,
): { md: string; used: FootnoteDef[] } {
  if (!defs.length) return { md, used: [] }
  const byId = new Map(defs.map((d) => [d.id, d]))
  const order = new Map<string, number>()
  const used: FootnoteDef[] = []
  const lines = md.split('\n')
  let inFence = false
  const out = lines.map((line) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence || !line.includes('[^')) return line
    return line.replace(/\[\^([^\]\s]+)\]/g, (full, id: string) => {
      const def = byId.get(id)
      if (!def) return full
      let n = order.get(id)
      if (!n) {
        n = order.size + 1
        order.set(id, n)
        used.push(def)
      }
      return `<a id="fnref-${prefix}-${n}" class="md-fn-ref">${n}</a>`
    })
  })
  return { md: out.join('\n'), used }
}

/** 生成脚注区(仅渲染被引用过的定义,顺序为首次引用顺序) */
function renderFootnoteSection(used: FootnoteDef[], ctx: Ctx): string {
  if (!used.length) return ''
  const items = used.map((def, i) => {
    const n = i + 1
    const parsed = parseInlineMarkdown(def.text)
    const inner = marksToHtml(
      parsed.text,
      parsed.marks.filter((m) => keepMark(m, ctx.rawHtml)),
    )
    return (
      `<li id="fn-${ctx.prefix}-${n}" class="md-fn-item">${inner}` +
      `<a id="fnback-${ctx.prefix}-${n}" class="md-fn-back" title="返回正文">↩</a></li>`
    )
  })
  return `<section class="md-footnotes"><ol class="md-fn-list">${items.join('')}</ol></section>`
}

// ===================== 行内 =====================

/** 关闭原始 HTML 时仍保留脚注锚点(否则脚注编号会变成不可点的裸数字) */
function keepMark(mark: Mark, rawHtml: boolean): boolean {
  if (mark.type !== 'html') return true
  if (rawHtml) return true
  return /class="[^"]*md-fn-(?:ref|back)/.test(mark.attrs ?? '')
}

function inline(text: string, marks: Mark[] | undefined, ctx: Ctx): string {
  const list = (marks ?? []).filter((m) => keepMark(m, ctx.rawHtml))
  return marksToHtml(text ?? '', list)
}

function alignStyle(align?: string): string {
  if (align === 'center' || align === 'right' || align === 'justify') {
    return ` style="text-align:${align}"`
  }
  return ''
}

// ===================== 块级 =====================

function renderBlocks(blocks: Block[], ctx: Ctx): string {
  return blocks
    .map((b) => renderBlock(b, ctx))
    .filter((s) => s.length > 0)
    .join('')
}

function renderList(block: Block, ctx: Ctx): string {
  const content = block.content as ListContent
  const props = block.props as ListProps
  const items = Array.isArray(content.items) ? content.items : []
  const listType = props?.listType ?? 'bullet'
  const ordered = listType === 'ordered'
  const tag = ordered ? 'ol' : 'ul'
  const cls = ordered ? 'md-ol' : 'md-ul'
  const start =
    ordered && typeof props?.start === 'number' && props.start !== 1
      ? ` start="${Number(props.start) || 1}"`
      : ''
  const body = items
    .map((item) => {
      const inner = inline(item.text, item.marks, ctx)
      // 嵌套子块(嵌套列表/段落/代码块等)递归渲染
      const nested = item.children?.length ? renderBlocks(item.children, ctx) : ''
      if (listType === 'task') {
        const checked = item.checked ? ' checked' : ''
        return `<li class="md-li md-task"><input type="checkbox" disabled${checked} /> <span class="md-task-text">${inner}</span>${nested}</li>`
      }
      return `<li class="md-li">${inner}${nested}</li>`
    })
    .join('')
  return `<${tag} class="${cls}"${start}>${body}</${tag}>`
}

function renderTable(block: Block, ctx: Ctx): string {
  const content = block.content as TableContent
  const headers = Array.isArray(content.headers) ? content.headers : []
  const rows = Array.isArray(content.rows) ? content.rows : []
  if (!headers.length) return ''
  const aligns = Array.isArray(content.aligns) ? content.aligns : []
  const cellStyle = (i: number): string => {
    const a = aligns[i]
    return a === 'center' || a === 'right' ? ` style="text-align:${a}"` : ''
  }
  const cell = (c: TableCell | undefined): string => inline(c?.text ?? '', c?.marks, ctx)
  const head = headers.map((h, i) => `<th class="md-th"${cellStyle(i)}>${cell(h)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((c, i) => `<td class="md-td"${cellStyle(i)}>${cell(c)}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function renderBlock(block: Block, ctx: Ctx): string {
  switch (block.type) {
    case 'paragraph': {
      const c = block.content as ParagraphContent
      return `<p class="md-p">${inline(c.text, c.marks, ctx)}</p>`
    }
    case 'heading': {
      const c = block.content as HeadingContent
      const p = block.props as HeadingProps
      const level = Math.min(6, Math.max(1, Number(p?.level) || 1))
      return `<h${level} class="md-h md-h${level}"${alignStyle(p?.align)}>${inline(c.text, c.marks, ctx)}</h${level}>`
    }
    case 'list':
      return renderList(block, ctx)
    case 'quote': {
      const c = block.content as QuoteContent
      if (c.blocks?.length) {
        return `<blockquote class="md-quote">${renderBlocks(c.blocks, ctx)}</blockquote>`
      }
      return `<blockquote class="md-quote">${inline(c.text, c.marks, ctx)}</blockquote>`
    }
    case 'code_block': {
      const c = block.content as CodeBlockContent
      const p = block.props as CodeBlockProps
      const lang = (p?.language ?? '').trim()
      const cls = lang ? ` class="language-${escapeAttr(lang)}"` : ''
      return `<pre class="md-pre"><code${cls}>${escapeText(c.code ?? '')}</code></pre>`
    }
    case 'table':
      return renderTable(block, ctx)
    case 'image': {
      const c = block.content as ImageContent
      if (!c.src) return ''
      return `<img class="md-image" src="${escapeAttr(c.src)}" alt="${escapeAttr(c.alt ?? '')}" loading="lazy" />`
    }
    case 'divider':
      return '<hr class="md-hr" />'
    case 'page_break':
      return '<div class="md-page-break" title="分页符"></div>'
    default: {
      // 插件自定义块等未知类型:退化为段落文本,不丢内容
      const c = block.content as { text?: string; marks?: Mark[] }
      if (typeof c?.text === 'string' && c.text) {
        return `<p class="md-p">${inline(c.text, c.marks, ctx)}</p>`
      }
      return ''
    }
  }
}

// ===================== 图片 src 安全策略 =====================

/**
 * 图片 src 分类。模型输出是**不可信**的,这里收紧到只允许三类:
 *   1) http(s)://            远程图片
 *   2) data:image/*          内联图片
 *   3) 无协议的相对路径        vault 内图片(交给后置通道拼 vaultRoot 再转 asset://)
 *
 * 其余一律 blocked。最需要拦的是 `asset://`:
 * tauri.conf.json 的 assetProtocol.scope = ["**"],即整盘可读 ——
 * 若放行,一条 `![x](asset://localhost/…)` 就能把本机任意图片读进对话。
 * 同时拦掉 blob:/file:/协议相对(//evil.com 会造成外部请求=IP 泄露)/绝对路径。
 */
function classifyImageSrc(src: string): 'direct' | 'vault' | 'blocked' {
  const raw = (src ?? '').trim()
  if (!raw) return 'blocked'
  if (/^https?:\/\//i.test(raw)) return 'direct'
  if (/^data:image\//i.test(raw)) return 'direct'
  // 任何其它协议(asset:/file:/blob:/javascript: …)
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return 'blocked'
  // 协议相对 //host/… 与绝对路径 /…
  if (raw.startsWith('//') || raw.startsWith('/')) return 'blocked'
  return 'vault'
}

const IMG_TAG_RE = /<img\b[^>]*>/gi

/**
 * 统一处理最终 HTML 里的每个 <img src>:
 *   direct  → 原样保留
 *   vault   → 换成 data-md-src 占位,由组件侧后置通道异步解析为 asset://
 *             (避免先请求一次坏 URL 造成破图闪烁)
 *   blocked → 去掉 src(浏览器会显示 alt 文本),标记 data-md-blocked
 */
function lazifyImages(html: string): string {
  return html.replace(IMG_TAG_RE, (tag) => {
    const m = /\bsrc="([^"]*)"/i.exec(tag)
    if (!m) return tag
    const path = decodeBasicEntities(m[1] ?? '')
    const kind = classifyImageSrc(path)
    if (kind === 'direct') return tag
    const withoutSrc = tag.replace(/\s*src="[^"]*"/i, '')
    if (kind === 'vault') {
      return withoutSrc.replace(/^<img/i, `<img data-md-src="${escapeAttr(path)}" data-md-lazy="1"`)
    }
    return withoutSrc.replace(/^<img/i, '<img data-md-blocked="1"')
  })
}

// ===================== 行内代码保护 =====================

/**
 * 行内代码(`code`)按字面量处理。
 *
 * 共享解析器 parseInlineMarkdown 会对 code span 的**内容**递归解析行内语法,
 * 于是 `**x**` 会同时产生 code 与 bold 两个同区间 mark,渲染成
 * <code><strong>x</strong></code> 且星号本身丢失 —— 文档侧与 AI 侧都受影响。
 *
 * 该缺陷的完整修复需要同时改解析器与序列化器(序列化器 escapeMarkdownSource 的
 * RAW_CONTENT_TYPES 目前只含 math/html,不含 code,否则保存时会把代码内容里的
 * `**` 转义成 `\*\*`),属于编辑器数据链路,风险高于本次改动范围。
 * 因此这里在**渲染前**把 code span 摘出来换成占位符,解析完再替换回
 * <code class="inline-code">…</code>(内容整体转义),效果等价且不触碰共享代码。
 *
 * 额外收益:代码内容里的 `|` 不会再被 mdast 当成表格分隔符。
 */
const SENTINEL = '\uE000'
const CODE_PLACEHOLDER_RE = /\uE000UDC(\d+)\uE000/g

/** 摘出 code span(围栏与缩进代码块内不动),返回替换后的文本与代码内容表 */
function extractInlineCode(md: string, store: string[]): string {
  let inFence = false
  return md
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        inFence = !inFence
        return line
      }
      // 围栏代码块内、以及 4 空格/Tab 缩进的代码块内,反引号就是字面量
      if (inFence || /^(?: {4}|\t)/.test(line)) return line
      if (!line.includes('`')) return line
      return line.replace(/`([^`\n]+)`/g, (_m, code: string) => {
        // 与解析器保持同一套历史转义还原规则,否则同一段代码在气泡与编辑器里
        // 显示不一致(旧文件里常见的 `a\_b`、表格里的 `a\|b`)
        store.push(unescapeLegacyCodeSpan(code))
        return `${SENTINEL}UDC${store.length - 1}${SENTINEL}`
      })
    })
    .join('\n')
}

/** 把占位符还原为 <code>,内容整体转义(代码里不存在 Markdown 语法) */
function restoreInlineCode(html: string, store: string[]): string {
  if (!store.length) return html
  return html.replace(CODE_PLACEHOLDER_RE, (_m, i: string) => {
    const code = store[Number(i)] ?? ''
    return `<code class="inline-code">${escapeText(code)}</code>`
  })
}

// ===================== 入口 =====================

function sanitizeIdPrefix(prefix: string): string {
  const safe = (prefix ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  return safe || 'm'
}

/**
 * 渲染 AI 回答为 HTML 字符串(供 v-html)
 * 注意:这是"完成态"渲染器;流式输出期间请继续使用 src/ai/markdown.ts 的轻量渲染器
 */
export function renderBubbleMarkdown(md: string, options: BubbleRenderOptions = {}): string {
  // 先剔除哨兵字符,保证占位符不可能被正文伪造
  const raw = stripInternalMarkers((md ?? '').replace(/\r\n/g, '\n')).replace(/\uE000/g, '')
  if (!raw) return ''
  const ctx: Ctx = {
    rawHtml: options.rawHtml !== false,
    prefix: sanitizeIdPrefix(options.idPrefix ?? 'm'),
  }
  const codeStore: string[] = []
  try {
    const protectedMd = extractInlineCode(raw, codeStore)
    const { body, defs } = extractFootnoteDefs(protectedMd)
    const { md: withRefs, used } = substituteFootnoteRefs(body, defs, ctx.prefix)
    const blocks = deserializeMarkdown(withRefs)
    const bodyHtml = renderBlocks(blocks, ctx)
    const footnoteHtml = renderFootnoteSection(used, ctx)
    return restoreInlineCode(lazifyImages(bodyHtml + footnoteHtml), codeStore)
  } catch (e) {
    // 任何解析异常都降级为纯文本,保证气泡不会空白
    console.error('[renderBubble] 渲染失败,降级为纯文本:', e)
    return `<p class="md-p">${escapeText(raw).replace(/\n/g, '<br>')}</p>`
  }
}
