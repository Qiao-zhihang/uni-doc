/**
 * 主题系统
 * 参考 PRD §4.4(深色/浅色主题切换)和 §9.1(字体策略)
 *
 * 通过 <html> 上的 class="dark" 切换主题
 * 主题状态持久化到 localStorage
 */

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'unidoc-theme'

/** 从 localStorage 读取主题,回退到系统偏好 */
export function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // localStorage 不可用时忽略
  }
  // 回退到系统偏好
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

/** 应用主题到 <html> 元素并持久化 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  root.setAttribute('data-theme', mode)
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // 忽略写入失败
  }
}

/** 切换主题并返回新模式 */
export function toggleTheme(current: ThemeMode): ThemeMode {
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

/** 初始化主题(在应用启动时调用) */
export function initTheme(): ThemeMode {
  const mode = getStoredTheme()
  applyTheme(mode)
  return mode
}
