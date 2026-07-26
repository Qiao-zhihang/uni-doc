const { Plugin } = window.__unidoc

function getBlockText(block) {
  const c = block.content || {}
  if (typeof c.text === 'string') return c.text
  if (Array.isArray(c.items)) {
    return c.items.map((it) => it.text || '').join('\n')
  }
  if (typeof c.code === 'string') return c.code
  return ''
}

class WordCountPlugin extends Plugin {
  onload() {
    this.api.addCommand({
      id: 'show-word-count',
      name: '显示字数统计',
      hotkey: 'Ctrl+Shift+C',
      callback: () => this.showStats(),
    })
  }

  showStats() {
    const blocks = this.api.editor.getBlocks()
    let charCount = 0
    let charCountNoSpace = 0
    let wordCount = 0
    let paraCount = 0

    for (const block of blocks) {
      const text = getBlockText(block)
      if (!text) continue

      if (block.type === 'paragraph' || block.type === 'heading') {
        paraCount++
      }

      charCount += text.length
      charCountNoSpace += text.replace(/\s/g, '').length

      const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
      const englishWords = text
        .replace(/[\u4e00-\u9fa5]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 0).length
      wordCount += chineseChars + englishWords
    }

    const msg =
      `📊 当前文档统计\n\n` +
      `字符数（含空格）：${charCount}\n` +
      `字符数（不含空格）：${charCountNoSpace}\n` +
      `词数（中英文合计）：${wordCount}\n` +
      `段落数：${paraCount}\n` +
      `块数：${blocks.length}`

    this.api.ui.notify({ type: 'info', message: msg, duration: 5000 })
  }
}

export default WordCountPlugin
