const { Plugin, Vue } = window.__unidoc
const { defineComponent, h, ref, computed, onMounted, onBeforeUnmount, watch } = Vue

function btnStyle(bg) {
  return {
    padding: '6px 14px',
    border: 'none',
    borderRadius: '6px',
    background: bg,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  }
}

function buildTimerBlock(uiApi) {
  return defineComponent({
    name: 'TimerBlock',
    props: {
      block: { type: Object, required: true },
    },
    emits: ['update', 'enter', 'backspace-merge', 'select'],
    setup(props, { emit }) {
      const running = ref(false)
      const elapsed = ref(props.block.props?.elapsed || 0)
      const duration = ref(props.block.props?.duration || 25 * 60)
      const mode = ref(props.block.props?.mode || 'countdown')
      let timer = null

      const remaining = computed(() => {
        if (mode.value === 'countdown') {
          return Math.max(0, duration.value - elapsed.value)
        }
        return elapsed.value
      })

      const display = computed(() => {
        const total = remaining.value
        const m = Math.floor(total / 60).toString().padStart(2, '0')
        const s = (total % 60).toString().padStart(2, '0')
        return `${m}:${s}`
      })

      const progress = computed(() => {
        if (mode.value !== 'countdown' || duration.value === 0) return 1
        return Math.min(1, elapsed.value / duration.value)
      })

      function persist() {
        emit('update', {
          props: {
            ...props.block.props,
            elapsed: elapsed.value,
            duration: duration.value,
            mode: mode.value,
            running: running.value,
          },
        })
      }

      function start() {
        if (running.value) return
        running.value = true
        persist()
        timer = setInterval(() => {
          if (mode.value === 'countdown' && elapsed.value >= duration.value) {
            pause()
            finishNotify()
            return
          }
          elapsed.value++
        }, 1000)
      }

      function pause() {
        running.value = false
        if (timer) {
          clearInterval(timer)
          timer = null
        }
        persist()
      }

      function reset() {
        pause()
        elapsed.value = 0
        persist()
      }

      function toggleMode() {
        pause()
        mode.value = mode.value === 'countdown' ? 'stopwatch' : 'countdown'
        elapsed.value = 0
        persist()
      }

      function setDuration(min) {
        pause()
        duration.value = min * 60
        elapsed.value = 0
        persist()
      }

      function finishNotify() {
        try {
          uiApi.notify({ type: 'success', message: '⏰ 时间到！', duration: 5000 })
        } catch (_) {
          alert('⏰ 时间到！')
        }
        try {
          if (typeof Audio !== 'undefined') {
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            const o = ctx.createOscillator()
            const g = ctx.createGain()
            o.connect(g); g.connect(ctx.destination)
            o.frequency.value = 880
            o.start(); setTimeout(() => { o.stop(); ctx.close() }, 300)
          }
        } catch (_) { /* ignore */ }
      }

      watch(() => props.block.props?.elapsed, (v) => {
        if (v != null && !running.value) elapsed.value = v
      })

      onMounted(() => {
        if (props.block.props?.running && !running.value) start()
      })

      onBeforeUnmount(() => {
        if (timer) clearInterval(timer)
      })

      return () => {
        const ringColor = progress.value >= 1
          ? '#10b981'
          : progress.value > 0.75
            ? '#ef4444'
            : progress.value > 0.5
              ? '#f59e0b'
              : '#3b82f6'

        return h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px 20px',
            borderRadius: '12px',
            background: 'var(--muted, #f9fafb)',
            border: `2px solid ${ringColor}`,
            margin: '8px 0',
            cursor: 'text',
            transition: 'border-color 0.3s',
          },
          onclick: () => emit('select'),
        }, [
          h('div', {
            style: {
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '36px',
              fontWeight: 'bold',
              color: ringColor,
              minWidth: '110px',
              textAlign: 'center',
              letterSpacing: '2px',
            },
          }, display.value),

          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 } }, [
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
              !running.value
                ? h('button', {
                    onclick: (e) => { e.stopPropagation(); start() },
                    style: btnStyle('#10b981'),
                  }, '▶ 开始')
                : h('button', {
                    onclick: (e) => { e.stopPropagation(); pause() },
                    style: btnStyle('#f59e0b'),
                  }, '⏸ 暂停'),
              h('button', {
                onclick: (e) => { e.stopPropagation(); reset() },
                style: btnStyle('#6b7280'),
              }, '↺ 重置'),
              h('button', {
                onclick: (e) => { e.stopPropagation(); toggleMode() },
                style: btnStyle('#3b82f6'),
              }, mode.value === 'countdown' ? '⏱ 倒计时' : '⏲ 正计时'),
            ]),
            mode.value === 'countdown' ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, [
              h('span', { style: { fontSize: '12px', color: 'var(--muted-foreground, #6b7280)' } }, '时长：'),
              ...[5, 15, 25, 45, 60].map((m) => h('button', {
                onclick: (e) => { e.stopPropagation(); setDuration(m) },
                style: {
                  ...btnStyle(duration.value === m * 60 ? '#3b82f6' : '#9ca3af'),
                  padding: '4px 10px',
                  fontSize: '12px',
                },
              }, `${m}分`)),
            ]) : null,
          ]),
        ])
      }
    },
  })
}

class TimerPlugin extends Plugin {
  onload() {
    const TimerBlock = buildTimerBlock(this.api.ui)
    this.api.registerBlockType({
      type: 'timer',
      component: TimerBlock,
      defaultProps: { mode: 'countdown', duration: 25 * 60, elapsed: 0, running: false },
      defaultContent: {},
      serialize: (block) => {
        const m = block.props?.mode === 'stopwatch' ? '正计时' : '倒计时'
        const dur = Math.round((block.props?.duration || 0) / 60)
        const el = Math.round((block.props?.elapsed || 0) / 60)
        return `> ⏱ **计时器** [${m}] ${dur}分钟 (已用${el}分)\n`
      },
      deserialize: (source) => {
        const m = source.match(/\[(.+?)\]/)
        const mode = m && m[1] === '正计时' ? 'stopwatch' : 'countdown'
        const dm = source.match(/(\d+)分钟/)
        const duration = dm ? parseInt(dm[1]) * 60 : 25 * 60
        return { type: 'timer', content: {}, props: { mode, duration, elapsed: 0, running: false } }
      },
    })
  }
}

export default TimerPlugin
