/**
 * HTML 序列化器
 * 将 blocks 数组转换为完整的 HTML 文档
 *
 * 支持三种样式模式:
 *   - styled:   内嵌完整主题样式(亮/暗主题),浏览器打开即完美显示
 *   - semantic: 纯语义化 HTML,不带样式,供嵌入其他页面
 *   - print:    打印/阅读优化样式,适合打印或转 PDF
 *
 * 支持两种图片处理:
 *   - keep:   保持原路径引用(HTML 需与图片放在同一目录)
 *   - base64: 将图片转为 base64 内嵌(单文件,体积大)
 */

import type {
  Block,
  CodeBlockContent,
  ColumnAlign,
  DocumentMeta,
  HeadingContent,
  HeadingProps,
  ImageContent,
  ImageProps,
  ListContent,
  ListProps,
  ParagraphContent,
  QuoteContent,
  TableCell,
  TableContent,
} from '../blocks/types'
import { marksToHtml } from '@/components/blocks/marks'

export type HtmlStyleMode = 'styled' | 'semantic' | 'print'
export type HtmlImageMode = 'keep' | 'base64'

export interface HtmlExportOptions {
  styleMode: HtmlStyleMode
  imageMode: HtmlImageMode
  /** 当前主题,styled 模式下使用 */
  theme?: 'light' | 'dark'
  /** 自定义 CSS(追加到默认样式之后) */
  customCss?: string
}

/* ============== 工具函数 ============== */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 对齐方式 → CSS text-align */
function alignToCss(align?: string): string {
  if (!align || align === 'left') return ''
  return `text-align: ${align};`
}

/** 处理图片 src:根据 imageMode 决定是否转为 base64 */
async function resolveImageSrc(src: string, mode: HtmlImageMode): Promise<string> {
  if (mode !== 'base64') return src
  // 已经是 base64 或 http(s) 远程的:跳过
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src
  }
  // 本地路径:尝试 fetch 后转 base64(Web/Tauri 环境下通用)
  try {
    const res = await fetch(src)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    // fetch 失败(如跨域、路径不存在),保留原路径
    return src
  }
}

/* ============== 单行 Block 序列化 ============== */

function serializeHeading(block: Block): string {
  const { text = '', marks = [] } = block.content as HeadingContent
  const level = (block.props as HeadingProps).level ?? 1
  const align = (block.props as HeadingProps).align
  const style = alignToCss(align)
  const inner = marksToHtml(text, marks)
  return `<h${level} class="doc-heading doc-h${level}"${style ? ` style="${style}"` : ''}>${inner}</h${level}>`
}

function serializeParagraph(block: Block): string {
  const { text = '', marks = [] } = block.content as ParagraphContent
  const align = (block.props as { align?: string }).align
  const style = alignToCss(align)
  const inner = marksToHtml(text, marks)
  return `<p class="doc-paragraph"${style ? ` style="${style}"` : ''}>${inner}</p>`
}

function serializeQuote(block: Block): string {
  const { text = '', marks = [] } = block.content as QuoteContent
  const inner = marksToHtml(text, marks)
  return `<blockquote class="doc-quote">${inner}</blockquote>`
}

function serializeCodeBlock(block: Block): string {
  const { code = '' } = block.content as CodeBlockContent
  const lang = (block.props as { language?: string }).language ?? ''
  const escaped = escapeHtml(code)
  return `<pre class="doc-code-block"><code${lang ? ` class="language-${lang}"` : ''}>${escaped}</code></pre>`
}

function serializeDivider(): string {
  return `<hr class="doc-divider" />`
}

function serializePageBreak(): string {
  return `<div class="doc-page-break"></div>`
}

function serializeList(block: Block): string {
  const { items = [] } = block.content as ListContent
  const { listType } = block.props as ListProps
  const tag = listType === 'ordered' ? 'ol' : 'ul'
  const cls = `doc-list doc-list-${listType}`
  const itemsHtml = items
    .map((item) => {
      const inner = marksToHtml(item.text, item.marks ?? [])
      if (listType === 'task') {
        const checked = item.checked ? 'checked' : ''
        return `<li class="doc-task-item">
  <input type="checkbox" disabled ${checked} class="doc-task-checkbox" />
  <span class="doc-task-text">${inner}</span>
</li>`
      }
      return `<li class="doc-list-item">${inner}</li>`
    })
    .join('\n')
  return `<${tag} class="${cls}">
${itemsHtml}
</${tag}>`
}

function serializeTable(block: Block): string {
  const { headers = [], rows = [], aligns = [] } = block.content as TableContent
  if (!headers.length) return ''

  function cellToHtml(c: TableCell, isHeader = false, align?: ColumnAlign): string {
    const inner = marksToHtml(c.text, c.marks ?? [])
    const tag = isHeader ? 'th' : 'td'
    const style = align && align !== 'left' ? ` style="text-align:${align};"` : ''
    return `<${tag} class="doc-table-${tag}"${style}>${inner}</${tag}>`
  }

  const headerRow = `<tr class="doc-table-row">
    ${headers.map((h, i) => cellToHtml(h, true, aligns[i])).join('\n    ')}
  </tr>`

  const bodyRows = rows
    .map(
      (r) => `<tr class="doc-table-row">
    ${r.map((c, i) => cellToHtml(c, false, aligns[i])).join('\n    ')}
  </tr>`,
    )
    .join('\n  ')

  return `<table class="doc-table">
  <thead class="doc-table-thead">
    ${headerRow}
  </thead>
  <tbody class="doc-table-tbody">
    ${bodyRows}
  </tbody>
</table>`
}

async function serializeImage(block: Block, imageMode: HtmlImageMode): Promise<string> {
  const { src = '', alt = '' } = block.content as ImageContent
  const align = (block.props as ImageProps).align
  const width = (block.props as ImageProps).width
  const resolvedSrc = await resolveImageSrc(src, imageMode)
  const styleParts: string[] = []
  if (width && width > 0) styleParts.push(`width:${width}px;`)
  if (align && align !== 'left') styleParts.push(`display:block;${alignToCss(align)}margin:0 auto;`)
  const style = styleParts.join('')
  return `<img class="doc-image" src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(alt)}"${style ? ` style="${style}"` : ''} />`
}

/** 序列化单个 Block 为 HTML 片段 */
async function serializeBlock(block: Block, imageMode: HtmlImageMode): Promise<string> {
  switch (block.type) {
    case 'heading':
      return serializeHeading(block)
    case 'paragraph':
      return serializeParagraph(block)
    case 'quote':
      return serializeQuote(block)
    case 'code_block':
      return serializeCodeBlock(block)
    case 'divider':
      return serializeDivider()
    case 'page_break':
      return serializePageBreak()
    case 'list':
      return serializeList(block)
    case 'table':
      return serializeTable(block)
    case 'image':
      return serializeImage(block, imageMode)
    default:
      return ''
  }
}

/* ============== 样式模板 ============== */

const PRINT_CSS = `
/* 打印/阅读优化样式 */
body {
  font-family: "Noto Sans CJK SC", "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.7;
  color: #1d1d1f;
  max-width: 800px;
  margin: 40px auto;
  padding: 0 24px;
  background: #fff;
}
.doc-heading { margin: 1.6em 0 0.8em; line-height: 1.3; }
.doc-h1 { font-size: 2em; border-bottom: 1px solid #e5e5ea; padding-bottom: 0.3em; }
.doc-h2 { font-size: 1.5em; border-bottom: 1px solid #f2f2f7; padding-bottom: 0.25em; }
.doc-h3 { font-size: 1.25em; }
.doc-h4 { font-size: 1.1em; }
.doc-paragraph { margin: 1em 0; }
.doc-quote {
  margin: 1em 0;
  padding: 0.6em 1.2em;
  border-left: 4px solid #007aff;
  background: #f7f7fa;
  color: #48484a;
}
.doc-code-block {
  background: #1c1c1e;
  color: #e3e3e8;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.55;
}
.doc-divider { border: none; border-top: 1px solid #e5e5ea; margin: 2em 0; }
.doc-page-break { page-break-after: always; }
.doc-list { padding-left: 1.6em; margin: 1em 0; }
.doc-list-item { margin: 0.4em 0; }
.doc-task-item { list-style: none; display: flex; align-items: flex-start; gap: 8px; margin: 0.4em 0; }
.doc-task-checkbox { margin-top: 4px; }
.doc-table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.2em 0;
  font-size: 14px;
}
.doc-table th, .doc-table td {
  border: 1px solid #e5e5ea;
  padding: 10px 14px;
  text-align: left;
}
.doc-table th { background: #f7f7fa; font-weight: 600; }
.doc-image { max-width: 100%; height: auto; margin: 1em 0; }
.md-link { color: #007aff; text-decoration: none; }
.md-link:hover { text-decoration: underline; }
.inline-code {
  background: #f2f2f7;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
}
.md-highlight { background: #fff3cd; padding: 0 2px; border-radius: 2px; }
@media print {
  body { margin: 0; max-width: none; }
  .doc-page-break { page-break-after: always; }
}
`

/** styled 模式的亮色主题 CSS */
const STYLED_LIGHT_CSS = `
body {
  font-family: var(--font-sans, "Noto Sans CJK SC", "Noto Sans", sans-serif);
  line-height: 1.7;
  color: #1d1d1f;
  background: #ffffff;
  max-width: 900px;
  margin: 0 auto;
  padding: 48px 64px;
}
.doc-heading { margin: 1.6em 0 0.8em; line-height: 1.3; font-weight: 700; }
.doc-h1 { font-size: 2em; color: #000; }
.doc-h2 { font-size: 1.5em; color: #1d1d1f; }
.doc-h3 { font-size: 1.25em; }
.doc-h4 { font-size: 1.1em; }
.doc-paragraph { margin: 1em 0; }
.doc-quote {
  margin: 1em 0;
  padding: 0.8em 1.4em;
  border-left: 4px solid #007aff;
  background: #f7f7fa;
  color: #48484a;
  border-radius: 0 8px 8px 0;
}
.doc-code-block {
  background: #1c1c1e;
  color: #e3e3e8;
  padding: 18px;
  border-radius: 10px;
  overflow-x: auto;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.doc-divider { border: none; border-top: 1px solid #e5e5ea; margin: 2.4em 0; }
.doc-page-break { page-break-after: always; }
.doc-list { padding-left: 1.6em; margin: 1em 0; }
.doc-list-item { margin: 0.4em 0; }
.doc-task-item { list-style: none; display: flex; align-items: flex-start; gap: 10px; margin: 0.4em 0; }
.doc-task-checkbox { margin-top: 5px; accent-color: #007aff; }
.doc-table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.4em 0;
  font-size: 14px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.doc-table th, .doc-table td {
  border: 1px solid #e5e5ea;
  padding: 12px 16px;
  text-align: left;
}
.doc-table th { background: #f7f7fa; font-weight: 600; }
.doc-image { max-width: 100%; height: auto; margin: 1.2em 0; border-radius: 8px; }
.md-link { color: #007aff; text-decoration: none; }
.md-link:hover { text-decoration: underline; }
.inline-code {
  background: #f2f2f7;
  padding: 3px 7px;
  border-radius: 5px;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 0.88em;
  color: #af52de;
}
.md-highlight { background: #fff3cd; padding: 0 3px; border-radius: 3px; }
`

/** styled 模式的暗色主题 CSS */
const STYLED_DARK_CSS = `
body {
  font-family: var(--font-sans, "Noto Sans CJK SC", "Noto Sans", sans-serif);
  line-height: 1.7;
  color: #f5f5f7;
  background: #1c1c1e;
  max-width: 900px;
  margin: 0 auto;
  padding: 48px 64px;
}
.doc-heading { margin: 1.6em 0 0.8em; line-height: 1.3; font-weight: 700; }
.doc-h1 { font-size: 2em; color: #ffffff; }
.doc-h2 { font-size: 1.5em; color: #f5f5f7; }
.doc-h3 { font-size: 1.25em; }
.doc-h4 { font-size: 1.1em; }
.doc-paragraph { margin: 1em 0; }
.doc-quote {
  margin: 1em 0;
  padding: 0.8em 1.4em;
  border-left: 4px solid #007aff;
  background: #2c2c2e;
  color: #c7c7cc;
  border-radius: 0 8px 8px 0;
}
.doc-code-block {
  background: #000000;
  color: #e3e3e8;
  padding: 18px;
  border-radius: 10px;
  overflow-x: auto;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
  border: 1px solid #3a3a3c;
}
.doc-divider { border: none; border-top: 1px solid #3a3a3c; margin: 2.4em 0; }
.doc-page-break { page-break-after: always; }
.doc-list { padding-left: 1.6em; margin: 1em 0; }
.doc-list-item { margin: 0.4em 0; }
.doc-task-item { list-style: none; display: flex; align-items: flex-start; gap: 10px; margin: 0.4em 0; }
.doc-task-checkbox { margin-top: 5px; accent-color: #007aff; }
.doc-table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.4em 0;
  font-size: 14px;
  border-radius: 10px;
  overflow: hidden;
}
.doc-table th, .doc-table td {
  border: 1px solid #3a3a3c;
  padding: 12px 16px;
  text-align: left;
}
.doc-table th { background: #2c2c2e; font-weight: 600; }
.doc-image { max-width: 100%; height: auto; margin: 1.2em 0; border-radius: 8px; }
.md-link { color: #66abff; text-decoration: none; }
.md-link:hover { text-decoration: underline; }
.inline-code {
  background: #3a3a3c;
  padding: 3px 7px;
  border-radius: 5px;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 0.88em;
  color: #bf5af2;
}
.md-highlight { background: #635300; color: #fff3cd; padding: 0 3px; border-radius: 3px; }
`

/** 根据样式模式生成 <style> 块 */
function buildStyleBlock(
  mode: HtmlStyleMode,
  theme: 'light' | 'dark' = 'light',
  customCss = '',
): string {
  if (mode === 'semantic') return ''
  let css = ''
  if (mode === 'print') {
    css = PRINT_CSS
  } else if (mode === 'styled') {
    css = theme === 'dark' ? STYLED_DARK_CSS : STYLED_LIGHT_CSS
  }
  if (customCss) css += `\n/* 自定义样式 */\n${customCss}\n`
  return `<style>\n${css}\n</style>`
}

/* ============== 主入口 ============== */

/**
 * 将 blocks 序列化为完整的 HTML 文档
 *
 * @param blocks 文档 blocks 数组
 * @param meta   文档元信息(标题等)
 * @param options 导出选项
 */
export async function serializeHtml(
  blocks: Block[],
  meta: DocumentMeta,
  options: HtmlExportOptions,
): Promise<string> {
  const { styleMode, imageMode, theme = 'light', customCss } = options

  // 1. 序列化所有 blocks(图片需要异步处理)
  const blockHtmls: string[] = []
  for (const block of blocks) {
    const html = await serializeBlock(block, imageMode)
    if (html) blockHtmls.push(html)
  }
  const bodyContent = blockHtmls.join('\n\n')

  // 2. 组装完整文档
  const styleBlock = buildStyleBlock(styleMode, theme, customCss)
  const title = escapeHtml(meta.title || 'Untitled')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  ${meta.author ? `<meta name="author" content="${escapeHtml(meta.author)}" />` : ''}
  ${meta.created_at ? `<meta name="created" content="${escapeHtml(meta.created_at)}" />` : ''}
  ${styleBlock}
</head>
<body class="unidoc-export">
${bodyContent}
</body>
</html>`
}

/**
 * 仅序列化 body 部分(不带 <html>/<head>/<body> 外壳)
 * 用于嵌入其他页面
 */
export async function serializeHtmlBody(
  blocks: Block[],
  imageMode: HtmlImageMode = 'keep',
): Promise<string> {
  const blockHtmls: string[] = []
  for (const block of blocks) {
    const html = await serializeBlock(block, imageMode)
    if (html) blockHtmls.push(html)
  }
  return blockHtmls.join('\n\n')
}
