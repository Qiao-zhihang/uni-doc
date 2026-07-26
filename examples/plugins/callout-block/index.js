const { Plugin, Vue } = window.__unidoc
const { defineComponent, h, computed } = Vue

const CalloutBlock = defineComponent({
  name: 'CalloutBlock',
  props: {
    block: { type: Object, required: true },
  },
  emits: ['update', 'enter', 'backspace-merge', 'select'],
  setup(props, { emit }) {
    const styles = {
      info:    { bg: '#dbeafe', border: '#3b82f6', icon: 'ℹ️', text: '#1e40af' },
      warning: { bg: '#fef3c7', border: '#f59e0b', icon: '⚠️', text: '#92400e' },
      success: { bg: '#d1fae5', border: '#10b981', icon: '✅', text: '#065f46' },
      error:   { bg: '#fee2e2', border: '#ef4444', icon: '❌', text: '#991b1b' },
    }

    const kind = computed(() => props.block.props?.kind || 'info')
    const text = computed(() => props.block.content?.text || '')

    function onInput(e) {
      emit('update', { content: { ...props.block.content, text: e.target.innerText } })
    }

    function onKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        emit('enter', '')
      }
      if (e.key === 'Backspace' && text.value === '') {
        e.preventDefault()
        emit('backspace-merge')
      }
    }

    function cycleKind() {
      const order = ['info', 'warning', 'success', 'error']
      const idx = order.indexOf(kind.value)
      const next = order[(idx + 1) % order.length]
      emit('update', { props: { ...props.block.props, kind: next } })
    }

    return () => {
      const s = styles[kind.value] || styles.info
      return h('div', {
        style: {
          display: 'flex',
          gap: '12px',
          padding: '12px 16px',
          borderRadius: '8px',
          background: s.bg,
          borderLeft: `4px solid ${s.border}`,
          margin: '8px 0',
          cursor: 'text',
        },
        onclick: () => emit('select'),
      }, [
        h('button', {
          onclick: (e) => { e.stopPropagation(); cycleKind() },
          style: {
            fontSize: '20px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: '1.4',
          },
          title: '点击切换类型',
        }, s.icon),
        h('div', {
          contenteditable: 'true',
          oninput: onInput,
          onkeydown: onKeydown,
          style: {
            flex: 1,
            outline: 'none',
            color: s.text,
            lineHeight: '1.6',
            fontSize: '14px',
            minHeight: '24px',
          },
        }, text.value),
      ])
    }
  },
})

class CalloutPlugin extends Plugin {
  onload() {
    this.api.registerBlockType({
      type: 'callout',
      component: CalloutBlock,
      defaultProps: { kind: 'info' },
      defaultContent: { text: '' },
      serialize: (block) => {
        const kind = block.props?.kind || 'info'
        const text = block.content?.text || ''
        return `> [!${kind.toUpperCase()}]\n> ${text.split('\n').join('\n> ')}\n`
      },
      deserialize: (source) => {
        const m = source.match(/^\[!([A-Z]+)\]\s*\n?((?:>.*\n?)*)/i)
        if (!m) return null
        const kind = m[1].toLowerCase()
        const text = m[2].replace(/^>\s?/gm, '').trim()
        return {
          type: 'callout',
          content: { text },
          props: { kind: ['info', 'warning', 'success', 'error'].includes(kind) ? kind : 'info' },
        }
      },
    })
  }
}

export default CalloutPlugin
