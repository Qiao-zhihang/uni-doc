/**
 * Markdown 行内语法实时解析
 * 在编辑器中输入 Markdown 语法时自动转换为格式化文本
 *
 * 支持的语法:
 * - **粗体** / __粗体__ -> bold mark
 * - *斜体* / _斜体_ -> italic mark
 * - ~~删除线~~ -> strikethrough mark
 * - `代码` -> code mark
 * - <u>下划线</u> -> underline mark
 * - [text](url) -> link mark
 * - <url> 自动链接 -> link mark
 * - ![alt](url) -> image mark
 * - ==高亮== -> highlight mark
 * - \转义字符 -> 普通文本
 * - [[页面]] / [[页面|别名]] -> wikilink mark (Obsidian 内部链接)
 * - HTML 标签(Obsidian 兼容): <b> <i> <s> <del> <mark> <sub> <sup> <kbd> <code>
 *   <span> <font> <center> <cite> <q> <small> <big> <tt> <u> <abbr> <dfn> <time> <a>
 */

import type { Mark } from '../blocks/types'

/**
 * Obsidian 兼容的 HTML 白名单标签(小写)
 * 参考 CommonMark HTML 块级+行内元素 + Obsidian 实践
 * 行内:b/i/s/del/mark/sub/sup/kbd/code/span/font/center/cite/q/small/big/tt/u/abbr/dfn/time/a/em/strong/var/samp/data/bdi/bdo/ruby/rt/rp/label/output
 * 块级:p/div/details/summary/dl/dt/dd/figure/figcaption/ul/ol/li/pre/blockquote/section/article/header/footer/nav/aside/main/h1-h6
 * 交互:progress/meter(进度条/度量条)
 */
const HTML_TAG_WHITELIST = new Set([
  // 行内
  'b', 'i', 's', 'del', 'mark', 'sub', 'sup', 'kbd', 'code',
  'span', 'font', 'center', 'cite', 'q', 'small', 'big', 'tt',
  'u', 'abbr', 'dfn', 'time', 'a', 'em', 'strong', 'var', 'samp',
  'data', 'bdi', 'bdo', 'ruby', 'rt', 'rp', 'label', 'output',
  // 块级
  'p', 'div', 'details', 'summary', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'ul', 'ol', 'li', 'pre', 'blockquote',
  'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // 表格
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup',
  // 交互(进度条/度量条)
  'progress', 'meter'
])

/** 自闭合 HTML 标签(小写,HTML 规范 void elements) */
const HTML_SELF_CLOSING = new Set(['br', 'hr', 'img', 'wbr', 'area', 'base', 'col', 'embed', 'input', 'link', 'meta', 'source', 'track'])

/** HTML 属性白名单(防 XSS) */
const HTML_ATTR_WHITELIST = new Set([
  'href', 'src', 'alt', 'title', 'class', 'style', 'id', 'name',
  'color', 'size', 'face', 'align', 'width', 'height',
  'target', 'rel', 'datetime', 'cite', 'lang', 'dir',
  'colspan', 'rowspan', 'start', 'type', 'value', 'open',
  'role', 'aria-label', 'aria-hidden', 'data-type',
  // 进度条/度量条
  'min', 'max', 'low', 'high', 'optimum',
  // 表单/选项卡(radio+label 纯 CSS 选项卡)
  'checked', 'for', 'placeholder', 'readonly', 'disabled', 'required',
  'autocomplete', 'autofocus', 'tabindex', 'accesskey',
  // 表格
  'border', 'cellpadding', 'cellspacing', 'scope', 'headers', 'abbr',
  'nowrap', 'bgcolor', 'valign', 'background', 'frame', 'rules', 'span'
])

/**
 * 过滤 HTML 属性,只保留白名单内的属性
 * 危险属性(on* 事件、javascript: 协议)一律移除
 */
function filterAttrs(attrStr: string): string {
  const safeAttrs: string[] = []
  // 属性正则:支持带引号和不带引号的值,支持布尔属性(如 open)
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g
  let m: RegExpExecArray | null
  while ((m = attrRegex.exec(attrStr)) !== null) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (!HTML_ATTR_WHITELIST.has(name)) continue
    // 阻止 javascript: 协议
    if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) continue
    // 阻止 data: 协议在 href(防 XSS)
    if (name === 'href' && /^\s*data:/i.test(value)) continue
    if (value === '') {
      safeAttrs.push(name)
    } else {
      safeAttrs.push(`${name}="${escapeAttr(value)}"`)
    }
  }
  return safeAttrs.join(' ')
}

/** 转义 HTML 属性值中的特殊字符,防止属性注入 XSS */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 查找匹配的闭合标签(支持嵌套同类标签)
 * 返回闭合标签的起始位置,找不到返回 -1
 */
function findCloseTag(text: string, tag: string, startIdx: number): number {
  const openTag = `<${tag}`
  const closeTag = `</${tag}>`
  let depth = 1
  let i = startIdx
  while (i < text.length) {
    const nextOpen = text.indexOf(openTag, i)
    const nextClose = text.indexOf(closeTag, i)
    if (nextClose === -1) return -1
    // 先遇到闭合标签
    if (nextOpen === -1 || nextClose < nextOpen) {
      depth--
      if (depth === 0) return nextClose
      i = nextClose + closeTag.length
    } else {
      // 先遇到开标签(可能是嵌套),需确认是完整标签(后跟空格/>或>)
      const afterTag = text[nextOpen + openTag.length]
      if (afterTag === ' ' || afterTag === '>' || afterTag === '/' || afterTag === '\t' || afterTag === '\n') {
        depth++
      }
      i = nextOpen + openTag.length
    }
  }
  return -1
}

/** 检测光标位置最近的未闭合语法 */
export interface PendingSyntax {
  type: Mark['type']
  start: number
  trigger: string
}

/**
 * 从文本中解析出所有 Markdown 行内语法
 * 返回: { plainText, marks }
 */
export function parseInlineMarkdown(text: string): { text: string; marks: Mark[] } {
  const marks: Mark[] = []
  let plain = ''
  let i = 0

  while (i < text.length) {
    let matched = false

    // HTML 标签(Obsidian 兼容):<tag attrs>...</tag> 或 <tag attrs/>
    if (text[i] === '<') {
      // 匹配开标签或自闭合标签: <tag attrs> 或 <tag attrs/>
      // 属性部分用 [\s\S]*? 支持任意字符(含换行),但限制不越界到下一个 >
      const openMatch = text.slice(i).match(/^<([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/)
      if (openMatch) {
        const tag = openMatch[1].toLowerCase()
        if (HTML_TAG_WHITELIST.has(tag) || HTML_SELF_CLOSING.has(tag)) {
          const attrs = filterAttrs(openMatch[2] ?? '')
          const isSelfClosing = openMatch[3] === '/' || HTML_SELF_CLOSING.has(tag)

          if (isSelfClosing) {
            // 自闭合标签:不包裹内容,在 plain 中占位(空字符串)
            const start = plain.length
            marks.push({ type: 'html', start, end: start, tag, attrs, selfClosing: true })
            i += openMatch[0].length
            matched = true
          } else {
            // 找闭合标签 </tag>(支持嵌套同类标签)
            const closePos = findCloseTag(text, tag, i + openMatch[0].length)
            if (closePos !== -1) {
              const content = text.slice(i + openMatch[0].length, closePos)
              const parsed = parseInlineMarkdown(content)
              const start = plain.length
              plain += parsed.text
              marks.push({ type: 'html', start, end: plain.length, tag, attrs })
              for (const nested of parsed.marks) {
                marks.push({ ...nested, start: start + nested.start, end: start + nested.end })
              }
              i = closePos + `</${tag}>`.length
              matched = true
            }
          }
        }
      }
    }

    // 块级公式: $$...$$
    if (!matched && text.slice(i, i + 2) === '$$') {
      const endPos = text.indexOf('$$', i + 2)
      if (endPos !== -1) {
        const content = text.slice(i + 2, endPos)
        const start = plain.length
        plain += content
        marks.push({ type: 'math', start, end: plain.length, displayMode: true })
        i = endPos + 2
        matched = true
      }
    }

    // 行内公式: $...$ (非 $$ 开头,且 $ 后非空白,闭合 $ 前非空白)
    if (!matched && text[i] === '$') {
      const after = text[i + 1]
      if (after && after !== '$' && !/\s/.test(after)) {
        // 找闭合 $,不能跨行
        const rest = text.slice(i + 1)
        const closeMatch = rest.match(/^(?!\s)[^$\n]*\S\$(?!\d)/)
        if (closeMatch) {
          const content = closeMatch[0].slice(0, -1)
          const start = plain.length
          plain += content
          marks.push({ type: 'math', start, end: plain.length, displayMode: false })
          i += closeMatch[0].length + 1
          matched = true
        }
      }
    }

    // 图片: ![alt](url)
    const imgMatch = text.slice(i).match(/^!\[([^\]]*)\]\(([^)]+)\)/)
    if (imgMatch) {
      const alt = imgMatch[1]
      const url = imgMatch[2]
      const start = plain.length
      // image mark 作为 selfClosing 处理:alt 仅存于属性,不进入 plain text
      // 避免 marksToHtml 时 alt 文本被重复渲染(属性 + 内容)
      marks.push({ type: 'image', start, end: start, href: url, alt, selfClosing: true })
      i += imgMatch[0].length
      matched = true
    }

    // Wikilink: [[目标]] 或 [[目标|别名]] (Obsidian 内部链接)
    // 注意: 必须放在标准链接 [text](url) 之前,避免 [[ 被误识别
    if (!matched && text.slice(i, i + 2) === '[[') {
      const closePos = text.indexOf(']]', i + 2)
      if (closePos !== -1) {
        const inner = text.slice(i + 2, closePos)
        const pipeIdx = inner.indexOf('|')
        let target: string
        let alias: string
        if (pipeIdx !== -1) {
          target = inner.slice(0, pipeIdx)
          alias = inner.slice(pipeIdx + 1)
        } else {
          target = inner
          alias = inner
        }
        if (target.trim() !== '') {
          const start = plain.length
          plain += alias
          marks.push({ type: 'wikilink', start, end: plain.length, target, alias })
          i = closePos + 2
          matched = true
        }
      }
    }

    // 链接: [text](url)
    if (!matched) {
      const linkMatch = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        const label = linkMatch[1]
        const url = linkMatch[2]
        const start = plain.length
        // 递归处理链接文本中的行内语法
        const parsed = parseInlineMarkdown(label)
        plain += parsed.text
        marks.push({ type: 'link', start, end: plain.length, href: url })
        for (const nested of parsed.marks) {
          // 不保留 link 类型的 nested marks:
          // 标准 Markdown 不支持链接 label 中嵌套另一个链接,
          // 且外层 link 已包裹整个 label,内层 link(来自裸URL/<url>)与之范围重叠,
          // 会导致 marksToSource 生成 [[text](url)](url) 形式的嵌套链接源码(看起来像链接翻倍)
          if (nested.type === 'link') continue
          marks.push({ ...nested, start: start + nested.start, end: start + nested.end })
        }
        i += linkMatch[0].length
        matched = true
      }
    }

    // 高亮: ==text==
    if (!matched && text.slice(i, i + 2) === '==') {
      const endPos = text.indexOf('==', i + 2)
      if (endPos !== -1) {
        const content = text.slice(i + 2, endPos)
        const parsed = parseInlineMarkdown(content)
        const start = plain.length
        plain += parsed.text
        marks.push({ type: 'highlight', start, end: plain.length })
        for (const nested of parsed.marks) {
          marks.push({ ...nested, start: start + nested.start, end: start + nested.end })
        }
        i = endPos + 2
        matched = true
      }
    }

    // 上标: ^text^
    if (!matched && text[i] === '^') {
      const endPos = text.indexOf('^', i + 1)
      if (endPos !== -1 && endPos > i + 1) {
        const content = text.slice(i + 1, endPos)
        const parsed = parseInlineMarkdown(content)
        const start = plain.length
        plain += parsed.text
        marks.push({ type: 'superscript', start, end: plain.length })
        for (const nested of parsed.marks) {
          marks.push({ ...nested, start: start + nested.start, end: start + nested.end })
        }
        i = endPos + 1
        matched = true
      }
    }

    // 下标: ~text~ (注意: ~~ 是删除线,优先匹配 ~~)
    if (!matched && text[i] === '~' && text[i + 1] !== '~') {
      const endPos = text.indexOf('~', i + 1)
      if (endPos !== -1 && endPos > i + 1) {
        const content = text.slice(i + 1, endPos)
        const parsed = parseInlineMarkdown(content)
        const start = plain.length
        plain += parsed.text
        marks.push({ type: 'subscript', start, end: plain.length })
        for (const nested of parsed.marks) {
          marks.push({ ...nested, start: start + nested.start, end: start + nested.end })
        }
        i = endPos + 1
        matched = true
      }
    }

    // 自动链接: <url> (标准 Markdown)
    if (!matched && text[i] === '<') {
      const autoLinkMatch = text.slice(i).match(/^<(https?:\/\/|ftp:\/\/)[^\s<>]+>/)
      if (autoLinkMatch) {
        const url = autoLinkMatch[0].slice(1, -1)
        const start = plain.length
        plain += url
        marks.push({ type: 'link', start, end: plain.length, href: url })
        i += autoLinkMatch[0].length
        matched = true
      }
    }

    // 自动链接: 裸 URL (http/https/ftp)
    if (!matched) {
      const urlMatch = text.slice(i).match(/^(https?:\/\/|ftp:\/\/)[^\s<>)]+/)
      if (urlMatch) {
        const url = urlMatch[0]
        const start = plain.length
        plain += url
        marks.push({ type: 'link', start, end: plain.length, href: url })
        i += urlMatch[0].length
        matched = true
      }
    }

    // 转义字符: \* \_ \# 等
    if (!matched && text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1]
      if ('\\`*_{}[]()#+-.!|~$='.includes(next)) {
        plain += next
        i += 2
        matched = true
      }
    }

    // 语法规则: [触发字符, 结束字符/重复触发字符, 类型]
    // 注意: __ 必须放在 _ 之前,避免 _ 误匹配 __ 的第一个字符
    if (!matched) {
      const patterns: [string, string, Mark['type']][] = [
        ['`', '`', 'code'],
        ['**', '**', 'bold'],
        ['__', '__', 'bold'],
        ['~~', '~~', 'strikethrough'],
        ['<u>', '</u>', 'underline'],
        ['*', '*', 'italic'],
        ['_', '_', 'italic']
      ]

      for (const [trigger, end, type] of patterns) {
        if (text.slice(i).startsWith(trigger)) {
          // _ 和 __ 需要做左右边界判断:左侧应为非单词字符或行首,右侧应为非单词字符或行尾
          // 避免 a_b 这样的下划线被识别为斜体
          if (trigger === '_' || trigger === '__') {
            const leftChar = i > 0 ? text[i - 1] : ''
            const triggerLen = trigger.length
            const rightChar = text[i + triggerLen]
            if (/\w/.test(leftChar) || /\w/.test(rightChar)) {
              continue
            }
          }
          const startPos = plain.length
          const contentStart = i + trigger.length
          const endPos = text.indexOf(end, contentStart)
          if (endPos !== -1) {
            // 对 _/__ 的闭合端也做边界检查
            if (end === '_' || end === '__') {
              const endLeftChar = text[endPos - 1]
              const endRightChar = text[endPos + end.length]
              if (/\w/.test(endLeftChar) || /\w/.test(endRightChar ?? '')) {
                continue
              }
            }
            const content = text.slice(contentStart, endPos)
            const parsed = parseInlineMarkdown(content)
            plain += parsed.text
            marks.push({ type, start: startPos, end: plain.length })
            for (const nested of parsed.marks) {
              marks.push({ ...nested, start: startPos + nested.start, end: startPos + nested.end })
            }
            i = endPos + end.length
            matched = true
            break
          }
        }
      }
    }

    if (!matched) {
      plain += text[i]
      i++
    }
  }

  const merged = mergeAdjacentMarks(marks)
  return { text: plain, marks: merged }
}

/**
 * 合并相邻的同类型 marks
 */
function mergeAdjacentMarks(marks: Mark[]): Mark[] {
  if (marks.length === 0) return []
  const sorted = [...marks].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Mark[] = []
  for (const mark of sorted) {
    const last = merged[merged.length - 1]
    // 去重:完全相同的 mark(同 type/start/end/href/target/alias)只保留一个
    // 防止 [label](url) 中 label 含 URL 时,外层 link 与内层 link(裸URL/<url>)重复
    if (
      last &&
      last.type === mark.type &&
      last.start === mark.start &&
      last.end === mark.end &&
      (last as any).href === (mark as any).href &&
      (last as any).target === (mark as any).target &&
      (last as any).alias === (mark as any).alias
    ) {
      continue
    }
    // html 标签不合并:不同 tag(如 table/tr/td)即使位置相同也不应合并
    const isHtml = mark.type === 'html' || last?.type === 'html'
    if (
      last &&
      last.type === mark.type &&
      last.end >= mark.start &&
      !last.href &&
      !isHtml
    ) {
      last.end = Math.max(last.end, mark.end)
    } else {
      merged.push({ ...mark })
    }
  }
  return merged
}

/**
 * 检测文本中是否有未闭合的语法
 */
export function detectUnclosedSyntax(text: string): PendingSyntax | null {
  const patterns: [string, Mark['type']][] = [
    ['`', 'code'],
    ['**', 'bold'],
    ['~~', 'strikethrough'],
    ['==', 'highlight'],
    ['*', 'italic'],
    ['<u>', 'underline']
  ]

  let lastPending: PendingSyntax | null = null

  for (const [trigger, type] of patterns) {
    const index = text.lastIndexOf(trigger)
    if (index !== -1) {
      const end = type === 'code' ? '`' : type === 'bold' ? '**' : type === 'strikethrough' ? '~~' : type === 'highlight' ? '==' : type === 'italic' ? '*' : '</u>'
      const endPos = text.indexOf(end, index + trigger.length)
      if (endPos === -1) {
        if (!lastPending || index > lastPending.start) {
          lastPending = { type, start: index, trigger }
        }
      }
    }
  }

  return lastPending
}

/**
 * 自动闭合未完成的语法
 */
export function autoCloseSyntax(text: string): string {
  const pending = detectUnclosedSyntax(text)
  if (!pending) return text

  const endMap: Record<string, string> = {
    code: '`',
    bold: '**',
    italic: '*',
    strikethrough: '~~',
    highlight: '==',
    underline: '</u>'
  }

  return text + endMap[pending.type]
}

/**
 * 将带 Markdown 语法的文本转换为 plain text + marks
 */
export function convertMarkdownToBlocks(text: string): { text: string; marks: Mark[] } {
  return parseInlineMarkdown(text)
}
