const { Plugin, Vue } = window.__unidoc
const { defineComponent, h, ref, watch } = Vue

const FORMATS = [
  { value: 'YYYY-MM-DD', label: '2026-07-27' },
  { value: 'YYYY/MM/DD', label: '2026/07/27' },
  { value: 'MM-DD-YYYY', label: '07-27-2026' },
  { value: 'YYYY年MM月DD日', label: '2026年07月27日' },
  { value: 'YYYY-MM-DD HH:mm', label: '2026-07-27 14:30' },
  { value: 'HH:mm', label: '14:30' },
]

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatDate(fmt, date) {
  const d = date || new Date()
  return fmt
    .replace('YYYY', d.getFullYear())
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()))
}

const SettingsPanel = defineComponent({
  name: 'InsertDateSettings',
  setup() {
    const plugin = window.__unidoc_insertDatePlugin
    const selectedFormat = ref(plugin?.format || 'YYYY-MM-DD')

    watch(selectedFormat, async (val) => {
      if (plugin) {
        plugin.format = val
        await plugin.saveFormat()
      }
    })

    return () =>
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        h('label', { style: { fontSize: '13px', color: 'var(--muted-foreground)' } }, '日期格式'),
        h(
          'select',
          {
            value: selectedFormat.value,
            onChange: (e) => (selectedFormat.value = e.target.value),
            style: {
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              fontSize: '13px',
              maxWidth: '240px',
            },
          },
          FORMATS.map((f) =>
            h('option', { key: f.value, value: f.value }, `${f.value}  (${f.label})`)
          )
        ),
      ])
  },
})

class InsertDatePlugin extends Plugin {
  constructor(api) {
    super(api)
    this.format = 'YYYY-MM-DD'
  }

  async onload() {
    const data = await this.api.loadData()
    if (data.format) this.format = data.format

    window.__unidoc_insertDatePlugin = this

    this.api.addCommand({
      id: 'insert-date',
      name: '插入当前日期',
      hotkey: 'Ctrl+Shift+D',
      callback: () => this.insertDate(),
    })

    this.api.addCommand({
      id: 'insert-time',
      name: '插入当前时间',
      hotkey: 'Ctrl+Shift+T',
      callback: () => this.insertTime(),
    })

    this.api.registerSettingsPanel({
      title: '插入日期设置',
      component: SettingsPanel,
    })
  }

  async saveFormat() {
    await this.api.saveData({ format: this.format })
  }

  insertDate() {
    const text = formatDate(this.format)
    this.insertIntoSelectedBlock(text)
  }

  insertTime() {
    const text = formatDate('HH:mm')
    this.insertIntoSelectedBlock(text)
  }

  insertIntoSelectedBlock(text) {
    const selectedId = this.api.editor.getSelectedBlockId()
    if (!selectedId) {
      this.api.editor.insertBlock('paragraph')
      const blocks = this.api.editor.getBlocks()
      const last = blocks[blocks.length - 1]
      if (last) {
        this.api.editor.updateBlock(last.id, { content: { text } })
      }
      return
    }

    const blocks = this.api.editor.getBlocks()
    const block = blocks.find((b) => b.id === selectedId)
    if (!block) return

    const currentText = (block.content && block.content.text) || ''
    this.api.editor.updateBlock(selectedId, {
      content: { ...block.content, text: currentText + text },
    })

    this.api.ui.notify({ type: 'success', message: `已插入: ${text}`, duration: 1500 })
  }
}

export default InsertDatePlugin
