/**
 * 主题状态 store
 * 参考 PRD §4.4(深色/浅色主题切换)
 * 状态持久化到 localStorage
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  applyTheme,
  getStoredTheme,
  initTheme,
  toggleTheme as toggleThemeFn,
  type ThemeMode
} from '@/core/theme/theme'

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(initTheme())

  function toggle() {
    mode.value = toggleThemeFn(mode.value)
  }

  function setMode(m: ThemeMode) {
    mode.value = m
    applyTheme(m)
  }

  function init() {
    mode.value = getStoredTheme()
    applyTheme(mode.value)
  }

  return {
    mode,
    toggle,
    setMode,
    init
  }
})
