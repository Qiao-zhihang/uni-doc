const { Plugin, Vue } = window.__unidoc
const { defineComponent, h, ref, onMounted, watch } = Vue

const PRESETS = [
  { name: '海洋蓝', color: '#007AFF' },
  { name: '翠绿', color: '#34C759' },
  { name: '紫罗兰', color: '#5856D6' },
  { name: '珊瑚橙', color: '#FF9500' },
  { name: '玫瑰粉', color: '#FF2D55' },
  { name: '烈焰红', color: '#FF3B30' },
  { name: '暗夜青', color: '#00C7BE' },
  { name: '金盏黄', color: '#FFCC00' },
  { name: '石墨灰', color: '#8E8E93' },
  { name: '深邃紫', color: '#AF52DE' },
]

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const v = Math.max(0, Math.min(255, Math.round(x)))
    return v.toString(16).padStart(2, '0')
  }).join('')
}

function mixColor(c1, c2, t) {
  return {
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t,
  }
}

function generateShades(baseHex) {
  const base = hexToRgb(baseHex)
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }
  const shades = {}
  const weights = [
    { key: 50, t: 0.88 },
    { key: 100, t: 0.76 },
    { key: 200, t: 0.56 },
    { key: 300, t: 0.36 },
    { key: 400, t: 0.16 },
    { key: 500, t: 0 },
    { key: 600, t: -0.10 },
    { key: 700, t: -0.24 },
    { key: 800, t: -0.40 },
    { key: 900, t: -0.56 },
  ]
  for (const w of weights) {
    const c = w.t >= 0
      ? mixColor(white, base, 1 - w.t)
      : mixColor(black, base, -w.t)
    shades[w.key] = rgbToHex(c.r, c.g, c.b)
  }
  return shades
}

const CUSTOM_VARS = [
  '--primary', '--ring', '--sidebar-primary', '--sidebar-ring',
]

const DARK_VARS = {
  '--primary': 500,
  '--ring': 500,
  '--sidebar-primary': 500,
  '--sidebar-ring': 500,
}

function applyTheme(baseHex) {
  const shades = generateShades(baseHex)
  const root = document.documentElement
  const styleEl = document.getElementById('plugin-theme-color-style')
  if (styleEl) styleEl.remove()
  const lightRules = []
  const darkRules = []
  for (let i = 50; i <= 900; i += 50) {
    if (shades[i]) {
      lightRules.push(`  --brand-${i}: ${shades[i]};`)
      darkRules.push(`  --brand-${i}: ${shades[i]};`)
    }
  }
  lightRules.push(`  --primary: ${shades[500]};`)
  lightRules.push(`  --ring: ${shades[500]};`)
  lightRules.push(`  --sidebar-primary: ${shades[500]};`)
  lightRules.push(`  --sidebar-ring: ${shades[500]};`)
  lightRules.push(`  --conversation-active-bar: ${shades[500]};`)
  lightRules.push(`  --conversation-active-bg: ${shades[50]};`)
  darkRules.push(`  --primary: ${shades[400]};`)
  darkRules.push(`  --ring: ${shades[400]};`)
  darkRules.push(`  --sidebar-primary: ${shades[400]};`)
  darkRules.push(`  --sidebar-ring: ${shades[400]};`)
  darkRules.push(`  --conversation-active-bar: ${shades[400]};`)
  darkRules.push(`  --conversation-active-bg: rgba(10, 132, 255, 0.18);`)
  const css = `:root {\n${lightRules.join('\n')}\n}\n.dark {\n${darkRules.join('\n')}\n}`
  const el = document.createElement('style')
  el.id = 'plugin-theme-color-style'
  el.textContent = css
  document.head.appendChild(el)
}

function resetTheme() {
  const el = document.getElementById('plugin-theme-color-style')
  if (el) el.remove()
}

function buildSettingsPanel(pluginApi) {
  return defineComponent({
    name: 'ThemeColorSettings',
    setup() {
      const selectedColor = ref('#007AFF')
      const customColor = ref('#007AFF')

      async function loadSaved() {
        try {
          const data = await pluginApi.loadData()
          if (data && data.color) {
            selectedColor.value = data.color
            customColor.value = data.color
          }
        } catch (_) {}
      }

      async function pickColor(color) {
        selectedColor.value = color
        customColor.value = color
        applyTheme(color)
        try {
          await pluginApi.saveData({ color })
        } catch (_) {}
      }

      function onCustomChange(e) {
        pickColor(e.target.value)
      }

      async function resetDefault() {
        resetTheme()
        selectedColor.value = '#007AFF'
        customColor.value = '#007AFF'
        try {
          await pluginApi.saveData({ color: null })
        } catch (_) {}
      }

      loadSaved()

      return () => {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
            h('span', {
              style: {
                display: 'inline-block',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: selectedColor.value,
                border: '1px solid var(--border)',
                flexShrink: 0,
              },
            }),
            h('div', { style: { flex: 1 } }, [
              h('div', {
                style: { fontSize: '13px', fontWeight: 500, color: 'var(--foreground)' },
              }, '当前主题色'),
              h('div', {
                style: { fontSize: '12px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', marginTop: '2px' },
              }, selectedColor.value.toUpperCase()),
            ]),
            h('button', {
              onclick: resetDefault,
              style: {
                padding: '6px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'transparent',
                color: 'var(--muted-foreground)',
                fontSize: '12px',
                cursor: 'pointer',
              },
            }, '恢复默认'),
          ]),

          h('div', [
            h('div', {
              style: { fontSize: '12px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '10px' },
            }, '预设色板'),
            h('div', {
              style: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
            }, PRESETS.map(p =>
              h('button', {
                onclick: () => pickColor(p.color),
                title: p.name,
                style: {
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: p.color,
                  border: selectedColor.value.toLowerCase() === p.color.toLowerCase()
                    ? '2px solid var(--foreground)'
                    : '1px solid var(--border)',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'transform 0.15s',
                },
                onmouseenter: (e) => { e.target.style.transform = 'scale(1.1)' },
                onmouseleave: (e) => { e.target.style.transform = 'scale(1)' },
              })
            )),
          ]),

          h('div', [
            h('div', {
              style: { fontSize: '12px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '8px' },
            }, '自定义颜色'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
              h('input', {
                type: 'color',
                value: customColor.value,
                oninput: onCustomChange,
                style: {
                  width: '44px',
                  height: '36px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '2px',
                },
              }),
              h('input', {
                type: 'text',
                value: customColor.value,
                oninput: (e) => {
                  const v = e.target.value.trim()
                  if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                    pickColor(v)
                  }
                },
                style: {
                  flex: 1,
                  height: '36px',
                  padding: '0 10px',
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--foreground)',
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  outline: 'none',
                },
                placeholder: '#RRGGBB',
              }),
            ]),
          ]),

          h('div', {
            style: {
              padding: '12px',
              background: 'var(--muted)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--muted-foreground)',
              lineHeight: 1.6,
            },
          }, '提示：主题色会影响按钮、链接、选中状态、侧边栏高亮等所有品牌色相关的界面元素。设置会在重启后自动恢复。'),
        ])
      }
    },
  })
}

class ThemeColorPlugin extends Plugin {
  async onload() {
    try {
      const data = await this.api.loadData()
      if (data && data.color) {
        applyTheme(data.color)
      }
    } catch (_) {}

    const SettingsPanel = buildSettingsPanel(this.api)
    this.api.registerSettingsPanel({
      title: '主题色',
      component: SettingsPanel,
    })
  }

  onunload() {
    resetTheme()
  }
}

export default ThemeColorPlugin
