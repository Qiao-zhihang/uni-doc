/**
 * 行内标记(Mark)渲染工具
 * 将 Block 内的 text + marks 转换为带样式的 HTML
 * 参考 PRD §11.2:paragraph / heading 含纯文本 + 行内样式
 */
import type { Mark } from '@/core/blocks/types'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/** 转义 HTML 特殊字符,防止注入 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 用 KaTeX 渲染数学公式为 HTML 字符串 */
function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'html'
    })
  } catch {
    return escapeHtml(tex)
  }
}

interface MarkEvent {
  pos: number
  kind: 'open' | 'close' | 'self'
  mark: Mark
  origIndex: number
}

/**
 * 去重:完全相同的 mark(影响渲染的字段全相同)只保留一个
 * 防止块中存储了重复 marks(如历史遗留的重复 link marks)导致
 * marksToSource 生成 [[text](url)](url) 形式的翻倍源码,
 * 或 marksToHtml 生成 <a><a>text</a></a> 嵌套标签
 */
function dedupMarks(marks: Mark[]): Mark[] {
  const seen = new Set<string>()
  const result: Mark[] = []
  for (const mark of marks) {
    const key = JSON.stringify({
      type: mark.type,
      start: mark.start,
      end: mark.end,
      href: (mark as any).href,
      target: (mark as any).target,
      alias: (mark as any).alias,
      alt: (mark as any).alt,
      tag: (mark as any).tag,
      attrs: (mark as any).attrs,
      selfClosing: (mark as any).selfClosing,
      displayMode: (mark as any).displayMode
    })
    if (seen.has(key)) continue
    seen.add(key)
    result.push(mark)
  }
  return result
}

/**
 * 从 marks 生成事件列表(open/close/self),并按正确顺序排序
 * 排序规则:
 *   1. pos 升序
 *   2. 同 pos: close < self < open (先关闭,再自闭合,再打开)
 *   3. 同 pos 同 kind:
 *      - open: end 降序(外层先开),end 相同按 origIndex 升序(外层先创建先开)
 *      - close: end 升序(内层先关),end 相同按 origIndex 降序(内层后创建先关)
 */
function buildEvents(marks: Mark[], textLen: number): MarkEvent[] {
  const events: MarkEvent[] = []
  marks.forEach((mark, idx) => {
    // selfClosing 标记:html(自闭合标签)和 image(单点占位)
    const isSelfClosing = mark.selfClosing === true || (mark.type === 'html' && mark.start === mark.end)
    // 跳过无效标记
    if (mark.start < 0 || mark.end > textLen) return
    if (!isSelfClosing && mark.start >= mark.end) return
    if (isSelfClosing) {
      events.push({ pos: mark.start, kind: 'self', mark, origIndex: idx })
    } else {
      events.push({ pos: mark.start, kind: 'open', mark, origIndex: idx })
      events.push({ pos: mark.end, kind: 'close', mark, origIndex: idx })
    }
  })
  events.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    const order = { close: 0, self: 1, open: 2 }
    if (a.kind !== b.kind) return order[a.kind] - order[b.kind]
    if (a.kind === 'open') {
      // end 降序(外层先开);end 相同时 origIndex 升序(外层先创建先开)
      if (a.mark.end !== b.mark.end) return b.mark.end - a.mark.end
      return a.origIndex - b.origIndex
    }
    if (a.kind === 'close') {
      // end 升序(内层先关);end 相同时 origIndex 降序(内层后创建先关)
      if (a.mark.end !== b.mark.end) return a.mark.end - b.mark.end
      return b.origIndex - a.origIndex
    }
    return 0
  })
  return events
}

/** 获取 mark 的源码前缀(编辑态显示) */
function getSourcePrefix(mark: Mark): string {
  switch (mark.type) {
    case 'bold': return '**'
    case 'italic': return '*'
    case 'strikethrough': return '~~'
    case 'code': return '`'
    case 'underline': return '<u>'
    case 'link': return '['
    case 'image': return mark.selfClosing ? `![${mark.alt ?? ''}](${mark.href ?? ''})` : '!['
    case 'highlight': return '=='
    case 'superscript': return '^'
    case 'subscript': return '~'
    case 'math': return mark.displayMode ? '$$' : '$'
    case 'wikilink': {
      const target = mark.target ?? ''
      const alias = mark.alias ?? ''
      if (alias && alias !== target) {
        return `[[${target}|`
      }
      return '[['
    }
    case 'html': {
      const attrs = mark.attrs ? ` ${mark.attrs}` : ''
      return mark.selfClosing ? `<${mark.tag}${attrs}/>` : `<${mark.tag}${attrs}>`
    }
    default: return ''
  }
}

/** 获取 mark 的源码后缀(编辑态显示) */
function getSourceSuffix(mark: Mark): string {
  switch (mark.type) {
    case 'bold': return '**'
    case 'italic': return '*'
    case 'strikethrough': return '~~'
    case 'code': return '`'
    case 'underline': return '</u>'
    case 'link': return `](${mark.href ?? ''})`
    case 'image': return mark.selfClosing ? '' : `](${mark.href ?? ''})`
    case 'highlight': return '=='
    case 'superscript': return '^'
    case 'subscript': return '~'
    case 'math': return mark.displayMode ? '$$' : '$'
    case 'wikilink': return ']]'
    case 'html': return mark.selfClosing ? '' : `</${mark.tag}>`
    default: return ''
  }
}

/** 获取 mark 的 HTML 前缀(阅读态显示) */
function getHtmlPrefix(mark: Mark): string {
  switch (mark.type) {
    case 'bold': return '<strong>'
    case 'italic': return '<em>'
    case 'strikethrough': return '<del>'
    case 'code': return '<code class="inline-code">'
    case 'underline': return '<u>'
    case 'link': return `<a href="${escapeHtml(mark.href ?? '#')}" target="_blank" rel="noopener noreferrer" class="md-link">`
    case 'image': return `<img src="${escapeHtml(mark.href ?? '')}" alt="${escapeHtml(mark.alt ?? '')}" class="md-image" />`
    case 'highlight': return '<mark class="md-highlight">'
    case 'superscript': return '<sup>'
    case 'subscript': return '<sub>'
    case 'wikilink': return `<a class="md-wikilink" data-target="${escapeHtml(mark.target ?? '')}">`
    case 'math': return ''
    case 'html': {
      const attrs = mark.attrs ? ` ${mark.attrs}` : ''
      return mark.selfClosing ? `<${mark.tag}${attrs} />` : `<${mark.tag}${attrs}>`
    }
    default: return ''
  }
}

/** 获取 mark 的 HTML 后缀(阅读态显示) */
function getHtmlSuffix(mark: Mark): string {
  switch (mark.type) {
    case 'bold': return '</strong>'
    case 'italic': return '</em>'
    case 'strikethrough': return '</del>'
    case 'code': return '</code>'
    case 'underline': return '</u>'
    case 'link': return '</a>'
    case 'image': return ''
    case 'highlight': return '</mark>'
    case 'superscript': return '</sup>'
    case 'subscript': return '</sub>'
    case 'wikilink': return '</a>'
    case 'math': return ''
    case 'html': return mark.selfClosing ? '' : `</${mark.tag}>`
    default: return ''
  }
}

/** 将 text + marks 还原为带 Markdown 语法的源码字符串(用于编辑态显示) */
export function marksToSource(text: string, marks: Mark[] = []): string {
  if (!text && !marks.length) return ''
  if (!marks.length) return text
  const events = buildEvents(dedupMarks(marks), text.length)
  let result = ''
  let cursor = 0
  for (const evt of events) {
    if (evt.pos > text.length) continue
    if (evt.pos > cursor) {
      result += text.slice(cursor, evt.pos)
      cursor = evt.pos
    }
    if (evt.kind === 'open') {
      result += getSourcePrefix(evt.mark)
    } else if (evt.kind === 'close') {
      result += getSourceSuffix(evt.mark)
    } else if (evt.kind === 'self') {
      result += getSourcePrefix(evt.mark)
    }
  }
  if (cursor < text.length) {
    result += text.slice(cursor)
  }
  return result
}

/** 将 text + marks 渲染为带行内样式的 HTML 字符串 */
export function marksToHtml(text: string, marks: Mark[] = []): string {
  if (!text && !marks.length) return ''
  if (!marks.length) return escapeHtml(text)
  const events = buildEvents(dedupMarks(marks), text.length)
  let result = ''
  let cursor = 0
  for (const evt of events) {
    if (evt.pos > text.length) continue
    if (evt.pos > cursor) {
      result += escapeHtml(text.slice(cursor, evt.pos))
      cursor = evt.pos
    }
    if (evt.kind === 'open') {
      if (evt.mark.type === 'math') {
        result += renderMath(text.slice(evt.mark.start, evt.mark.end), evt.mark.displayMode ?? false)
        cursor = evt.mark.end
      } else {
        result += getHtmlPrefix(evt.mark)
      }
    } else if (evt.kind === 'close') {
      if (evt.mark.type === 'math') {
        // math 已在 open 时完整渲染,close 时不输出
      } else {
        result += getHtmlSuffix(evt.mark)
      }
    } else if (evt.kind === 'self') {
      if (evt.mark.type === 'math') {
        result += renderMath(text.slice(evt.mark.start, evt.mark.end), evt.mark.displayMode ?? false)
        cursor = evt.mark.end
      } else {
        result += getHtmlPrefix(evt.mark)
      }
    }
  }
  if (cursor < text.length) {
    result += escapeHtml(text.slice(cursor))
  }
  return result
}
