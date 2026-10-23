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
  'b',
  'i',
  's',
  'del',
  'mark',
  'sub',
  'sup',
  'kbd',
  'code',
  'span',
  'font',
  'center',
  'cite',
  'q',
  'small',
  'big',
  'tt',
  'u',
  'abbr',
  'dfn',
  'time',
  'a',
  'em',
  'strong',
  'var',
  'samp',
  'data',
  'bdi',
  'bdo',
  'ruby',
  'rt',
  'rp',
  'label',
  'output',
  // 块级
  'p',
  'div',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'ul',
  'ol',
  'li',
  'pre',
  'blockquote',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'aside',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  // 表格
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  // 交互(进度条/度量条)
  'progress',
  'meter',
])

/** 自闭合 HTML 标签(小写,HTML 规范 void elements) */
const HTML_SELF_CLOSING = new Set([
  'br',
  'hr',
  'img',
  'wbr',
  'area',
  'base',
  'col',
  'embed',
  'input',
  'link',
  'meta',
  'source',
  'track',
])

/** HTML 属性白名单(防 XSS) */
const HTML_ATTR_WHITELIST = new Set([
  'href',
  'src',
  'alt',
  'title',
  'class',
  'style',
  'id',
  'name',
  'color',
  'size',
  'face',
  'align',
  'width',
  'height',
  'target',
  'rel',
  'datetime',
  'cite',
  'lang',
  'dir',
  'colspan',
  'rowspan',
  'start',
  'type',
  'value',
  'open',
  'role',
  'aria-label',
  'aria-hidden',
  'data-type',
  // 进度条/度量条
  'min',
  'max',
  'low',
  'high',
  'optimum',
  // 表单/选项卡(radio+label 纯 CSS 选项卡)
  'checked',
  'for',
  'placeholder',
  'readonly',
  'disabled',
  'required',
  'autocomplete',
  'autofocus',
  'tabindex',
  'accesskey',
  // 表格
  'border',
  'cellpadding',
  'cellspacing',
  'scope',
  'headers',
  'abbr',
  'nowrap',
  'bgcolor',
  'valign',
  'background',
  'frame',
  'rules',
  'span',
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
    // URL 类属性:使用协议白名单检查
    if (name === 'href' || name === 'src' || name === 'cite' || name === 'background') {
      if (!isSafeUrl(value)) continue
    }
    // style 属性:CSS 净化
    if (name === 'style') {
      const sanitized = sanitizeStyle(value)
      if (!sanitized) continue
      safeAttrs.push(`style="${escapeAttr(sanitized)}"`)
      continue
    }
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

/** 解码 HTML 实体,用于在协议检查前还原被编码的字符 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&#60;/gi, '<')
    .replace(/&#x3C;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#62;/gi, '>')
    .replace(/&#x3E;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** 安全的 URL 协议白名单检查
 *  用于链接 mark、图片 mark 及 HTML 属性的 href/src 校验。
 *  注意:file: 协议不开放在白名单内(可被用于读取本地文件,主流编辑器默认屏蔽)。
 */
export function isSafeUrl(url: string): boolean {
  const decoded = decodeHtmlEntities(url).trim().toLowerCase()
  // 相对路径(以 / ./ ../ 开头)或无协议的纯路径:安全
  if (/^(\.\/|\.\.\/|\/|#|[a-zA-Z0-9_\-])/.test(decoded) && !decoded.includes(':')) {
    return true
  }
  // 显式的协议白名单
  if (/^(https?|ftp|mailto|tel):/i.test(decoded)) {
    return true
  }
  return false
}

/** 净化 CSS style 字符串,移除危险属性 */
function sanitizeStyle(style: string): string {
  // 移除所有可能执行代码或造成危害的 CSS 属性
  const dangerousProperties = [
    'expression',
    'behavior',
    'url\\(',
    '@import',
    'javascript:',
    'vbscript:',
    'data:',
    '-moz-binding',
    'position:\\s*fixed',
  ]
  const dangerRegex = new RegExp(dangerousProperties.join('|'), 'gi')
  if (dangerRegex.test(style)) {
    return ''
  }
  // 对每个声明做二次检查
  const declarations = style.split(';')
  const safeDeclarations: string[] = []
  for (const decl of declarations) {
    const trimmed = decl.trim()
    if (!trimmed) continue
    if (dangerRegex.test(trimmed)) continue
    safeDeclarations.push(trimmed)
  }
  return safeDeclarations.join('; ')
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
      if (
        afterTag === ' ' ||
        afterTag === '>' ||
        afterTag === '/' ||
        afterTag === '\t' ||
        afterTag === '\n'
      ) {
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
 * 可被反斜杠转义的字符集(反斜杠自身排在最前)。
 *
 * 这是「解析端反转义」与「序列化端转义」共用的唯一真源:
 * 序列化时若要保证纯文本往返无损,只能转义本集合内的字符 ——
 * 转义集合外的字符(`&` 等)不会被反转义,反而会留下多余的反斜杠。
 *
 * 含 `<` `>`:文档里写 `\<div\>` 这类字面标签时,Editors/CommonMark 都会反转义,
 * 若不支持会导致反斜杠在每次保存时翻倍。
 */
export const INLINE_ESCAPABLE_CHARS = '\\`*_{}[]()#+-.!|~$=<>'

/**
 * 真正会触发行内语法的字符 —— 序列化时只需转义这些。
 *
 * 是 INLINE_ESCAPABLE_CHARS 的子集:像 `=` `|` `{` `}` 虽然能反转义,
 * 但裸写出来并不会被解析成语法,转义它们只会让落盘内容变难看
 * (`a = b` 变成 `a \= b`)。
 */
export const INLINE_SYNTAX_CHARS = '\\`*_~^$[]!<('

/**
 * 解析端**可反转义**的字符集 = 可转义集合 ∪ 会触发语法的集合。
 *
 * 必须取并集:序列化器会转义 INLINE_SYNTAX_CHARS 里的每个字符,解析器若只认
 * INLINE_ESCAPABLE_CHARS,那些只存在于前者的字符(目前是 `^`)写出去就再也
 * 还原不回来 —— 反斜杠会留在文本里,并随每次保存翻倍:
 *   `a^b` → `a\^b` → `a\\\^b` → `a\\\\\^b` …
 * 不变量:**序列化器能写出的转义,解析器必须都能还原**。
 */
const PARSE_ESCAPABLE_CHARS = `${INLINE_ESCAPABLE_CHARS}${INLINE_SYNTAX_CHARS}`

/**
 * 行内代码的历史转义字符集(仅用于存量兼容,不参与新解析)。
 *
 * 旧版本的序列化器会把 code span 内容当普通文本转义:
 *   - `escapeSegment`:反斜杠加倍(`\` → `\\`),并转义 INLINE_SYNTAX_CHARS;
 *   - 块首还会转义 INLINE_ESCAPABLE_CHARS(如 `` `-v` `` 存成 `` `\-v` ``);
 *   - 表格单元格还会把 `|` 转义成 `\|`。
 * 于是磁盘上出现了 `\_`、`\[`、`\-` 这类多余转义,而当时的解析器会把它们吃掉,
 * 所以渲染看起来正常。现在 code span 改为字面量语义后,必须先把这批历史转义还原,
 * 否则升级后老文档会突然显示多余反斜杠。
 *
 * 刻意只包含**标点**:反斜杠后跟字母/数字/空白(Windows 路径 `C:\Users`、
 * 正则 `\d+`、LaTeX `\alpha`)从未被旧序列化器转义过,一律原样保留。
 */
const CODE_SPAN_LEGACY_ESCAPES = '\\`*_{}[]()#+-.!|~$=<>^'

/**
 * 还原 code span 内的历史转义(幂等:还原后再解析不会二次变化)
 * 例:`a\_b` → `a_b`、`arr\[0\]` → `arr[0]`、`C:\\Users` → `C:\Users`、
 * 而 `C:\Users`、`\d+` 因 `U`/`d` 不在集合内保持不变。
 *
 * 导出给 AI 气泡使用:气泡为了处理"表格单元格里的 `|`"会在进 mdast 之前
 * 就把 code span 摘成占位符,因此必须复用同一套还原规则,否则同一段内容
 * 在气泡与编辑器里的显示会不一致。
 */
export function unescapeLegacyCodeSpan(content: string): string {
  if (!content.includes('\\')) return content
  return content.replace(/\\([\s\S])/g, (m, ch: string) =>
    CODE_SPAN_LEGACY_ESCAPES.includes(ch) ? ch : m,
  )
}

/**
 * 从文本中解析出所有 Markdown 行内语法
 * 返回: { plainText, marks }
 * @param depth 递归深度,超过阈值停止解析(防栈溢出)
 */
const MAX_PARSE_LENGTH = 20000
const MAX_RECURSION_DEPTH = 50
export function parseInlineMarkdown(text: string, depth = 0): { text: string; marks: Mark[] } {
  // 超长文本:跳过行内解析,只返回纯文本(防止主线程阻塞)
  if (text.length > MAX_PARSE_LENGTH) {
    return { text, marks: [] }
  }
  // 递归深度超过阈值:停止解析,返回纯文本
  if (depth > MAX_RECURSION_DEPTH) {
    return { text, marks: [] }
  }
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
              const parsed = parseInlineMarkdown(content, depth + 1)
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

    // 图片: ![alt](url) (url 必须通过安全校验,否则按纯文本处理)
    const imgMatch = text.slice(i).match(/^!\[([^\]]*)\]\(([^)]+)\)/)
    if (imgMatch && isSafeUrl(imgMatch[2])) {
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

    // 链接: [text](url) (url 必须通过安全校验,否则按纯文本处理)
    if (!matched) {
      const linkMatch = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch && isSafeUrl(linkMatch[2])) {
        const label = linkMatch[1]
        const url = linkMatch[2]
        const start = plain.length
        // 递归处理链接文本中的行内语法
        const parsed = parseInlineMarkdown(label, depth + 1)
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
        const parsed = parseInlineMarkdown(content, depth + 1)
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
        const parsed = parseInlineMarkdown(content, depth + 1)
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
        const parsed = parseInlineMarkdown(content, depth + 1)
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

    // 转义字符: \* \_ \# 等(用并集,保证序列化写出的转义都能还原)
    if (!matched && text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1]
      if (PARSE_ESCAPABLE_CHARS.includes(next)) {
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
        ['_', '_', 'italic'],
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
          // 内容为空的配对一律不成立(行内代码除外:`` 是合法的空 code span)。
          //
          // 否则未闭合的 `**text` 会被这样吃掉:第一个 `*` 在 i 处匹配上 `**` 失败后,
          // 轮到单字符 `*` 规则,它在 i+1 处找到第二个 `*` 作为闭合 → 产出 start===end
          // 的零宽 italic mark;该 mark 随后被 marks.ts 的 buildEvents 按
          // `start >= end` 丢弃 —— 净效果是两个星号凭空消失,而其它未闭合写法
          // (`` `code ``、`~~x`、`[a](b`…)都原样保留,行为不一致。
          const isEmptyContent = endPos === contentStart
          if (endPos !== -1 && (!isEmptyContent || end === '`')) {
            // 对 _/__ 的闭合端也做边界检查
            if (end === '_' || end === '__') {
              const endLeftChar = text[endPos - 1]
              const endRightChar = text[endPos + end.length]
              if (/\w/.test(endLeftChar) || /\w/.test(endRightChar ?? '')) {
                continue
              }
            }
            const content = text.slice(contentStart, endPos)
            // 行内代码按字面量处理:CommonMark 规定 code span 内部不解析行内语法,
            // 反斜杠也不做转义处理。若像其它标记那样递归解析,`**x**` 会同时产生
            // code 与 bold 两个同区间 mark —— 渲染成 <code><strong>x</strong></code>
            // (代码里出现粗体)且星号本身丢失;并且会让序列化器把 `\_` 之类写进
            // 文件,与 Typora/Obsidian 的读法不一致。
            // 兼容:旧版本写出的文件在 code span 内带有多余转义,这里一次性还原,
            // 使其渲染结果与升级前一致,并在下次保存时收敛为干净源码。
            plain += unescapeLegacyCodeSpan(content)
            marks.push({ type, start: startPos, end: plain.length })
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
    if (last && last.type === mark.type && last.end >= mark.start && !last.href && !isHtml) {
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
    ['<u>', 'underline'],
  ]

  let lastPending: PendingSyntax | null = null

  for (const [trigger, type] of patterns) {
    const index = text.lastIndexOf(trigger)
    if (index !== -1) {
      const end =
        type === 'code'
          ? '`'
          : type === 'bold'
            ? '**'
            : type === 'strikethrough'
              ? '~~'
              : type === 'highlight'
                ? '=='
                : type === 'italic'
                  ? '*'
                  : '</u>'
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
    underline: '</u>',
  }

  return text + endMap[pending.type]
}

/**
 * 将带 Markdown 语法的文本转换为 plain text + marks
 */
export function convertMarkdownToBlocks(text: string): { text: string; marks: Mark[] } {
  return parseInlineMarkdown(text)
}
