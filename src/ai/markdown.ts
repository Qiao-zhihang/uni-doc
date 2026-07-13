/**
 * 轻量 Markdown 渲染器（供 AI 浮窗消息气泡使用）
 * 零依赖,支持 AI 常见返回格式：
 *   标题 #/##/###、代码块 ```、行内代码 `、粗体 **、斜体 *、删除线 ~~、
 *   无序列表 -/*、有序列表 1.、任务列表 - [ ]、引用 >、分割线 ---、链接 [text](url)、换行
 * 不追求完整 CommonMark,够 AI 回复渲染即可。先 escapeHtml 防 XSS,再应用语法替换。
 */

/** HTML 转义 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 行内 Markdown 转换（已转义后的文本上操作,注意顺序：先代码,再粗体,再斜体） */
function renderInline(text: string): string {
  let s = text
  // 行内代码 `code`（先处理,内部不再解析其他语法）
  s = s.replace(/`([^`]+)`/g, (_, code) => `<code class="md-code">${code}</code>`)
  // 粗体 **text** 或 __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  // 斜体 *text* 或 _text_
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, '$1<em>$2</em>')
  // 删除线 ~~text~~
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  // 链接 [text](url) — 防 javascript: 协议
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, txt, url) => {
      const safe = /^(https?:\/\/|mailto:)/.test(url) ? url : '#'
      return `<a href="${safe}" target="_blank" rel="noopener">${txt}</a>`
    }
  )
  // 换行
  s = s.replace(/\n/g, '<br>')
  return s
}

/**
 * 将 Markdown 字符串渲染为 HTML
 * 块级元素拆行处理,行内元素交由 renderInline
 */
export function renderMarkdown(md: string): string {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'
  let inQuote = false
  const quoteBuf: string[] = []

  function closeList() {
    if (inList) {
      html.push(`</${listType}>`)
      inList = false
    }
  }
  function closeQuote() {
    if (inQuote) {
      html.push(`<blockquote>${renderInline(quoteBuf.join('\n'))}</blockquote>`)
      quoteBuf.length = 0
      inQuote = false
    }
  }

  while (i < lines.length) {
    let line = lines[i]

    // 代码块 ```
    if (line.trimStart().startsWith('```')) {
      closeList()
      closeQuote()
      const lang = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过结束的 ```
      html.push(
        `<pre class="md-pre"><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`
      )
      continue
    }

    // 分割线 ---
    if (/^\s*---+\s*$/.test(line) && !inList) {
      closeList()
      closeQuote()
      html.push('<hr class="md-hr">')
      i++
      continue
    }

    // 标题 # ## ###
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      closeList()
      closeQuote()
      const level = headingMatch[1].length
      const text = escapeHtml(headingMatch[2])
      html.push(`<h${level} class="md-h md-h${level}">${renderInline(text)}</h${level}>`)
      i++
      continue
    }

    // 引用 >
    if (/^\s*>\s?/.test(line)) {
      closeList()
      inQuote = true
      quoteBuf.push(line.replace(/^\s*>\s?/, ''))
      i++
      continue
    } else if (inQuote) {
      closeQuote()
    }

    // 无序列表 - 或 *
    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/)
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        closeList()
        inList = true
        listType = 'ul'
        html.push('<ul class="md-ul">')
      }
      const item = ulMatch[1]
      // 任务列表 - [ ] / - [x]
      const taskMatch = item.match(/^\[([ xX])\]\s+(.*)$/)
      if (taskMatch) {
        const checked = taskMatch[1].toLowerCase() === 'x'
        html.push(
          `<li class="md-li md-task"><input type="checkbox" disabled ${checked ? 'checked' : ''}> ${renderInline(escapeHtml(taskMatch[2]))}</li>`
        )
      } else {
        html.push(`<li class="md-li">${renderInline(escapeHtml(item))}</li>`)
      }
      i++
      continue
    }

    // 有序列表 1.
    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/)
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList()
        inList = true
        listType = 'ol'
        html.push('<ol class="md-ol">')
      }
      html.push(`<li class="md-li">${renderInline(escapeHtml(olMatch[1]))}</li>`)
      i++
      continue
    }

    // GFM 表格：当前行含 |，下一行是分隔行（| --- | --- | 或 ---|---|---）
    const tableSep = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      tableSep.test(lines[i + 1])
    ) {
      closeList()
      closeQuote()
      const headerCells = splitTableRow(line)
      const aligns = parseAligns(lines[i + 1])
      const bodyRows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        bodyRows.push(splitTableRow(lines[i]))
        i++
      }
      let tableHtml = '<table class="md-table"><thead><tr>'
      headerCells.forEach((c, idx) => {
        const a = aligns[idx] || 'left'
        tableHtml += `<th class="md-th" style="text-align:${a}">${renderInline(escapeHtml(c))}</th>`
      })
      tableHtml += '</tr></thead><tbody>'
      bodyRows.forEach((row) => {
        tableHtml += '<tr>'
        row.forEach((c, idx) => {
          const a = aligns[idx] || 'left'
          tableHtml += `<td class="md-td" style="text-align:${a}">${renderInline(escapeHtml(c))}</td>`
        })
        tableHtml += '</tr>'
      })
      tableHtml += '</tbody></table>'
      html.push(tableHtml)
      continue
    }

    // 空行
    if (line.trim() === '') {
      closeList()
      closeQuote()
      i++
      continue
    }

    // 普通段落
    closeList()
    closeQuote()
    html.push(`<p class="md-p">${renderInline(escapeHtml(line))}</p>`)
    i++
  }

  closeList()
  closeQuote()
  return html.join('\n')
}

/** 拆分表格行：| a | b | → ['a', 'b']；支持首尾无 | 的情况 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  // 去掉首尾的 |
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((c) => c.trim())
}

/** 解析对齐方式：| :--- | :---: | ---: | → ['left', 'center', 'right'] */
function parseAligns(line: string): ('left' | 'center' | 'right')[] {
  return splitTableRow(line).map((cell) => {
    const c = cell.trim()
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}
