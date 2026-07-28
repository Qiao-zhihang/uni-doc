/**
 * 液态玻璃(liquid glass)运行时管理
 *
 * 设计目标:
 *  1. 仅对"chrome 表面"(标题栏/Ribbon/状态栏/侧栏/AI 浮窗/对话框)开启 backdrop-filter,
 *     编辑器正文与可滚动列表内部不使用,避免在 Tauri 系统 WebView 上频繁重绘带来的卡顿。
 *  2. 检测 backdrop-filter 与 prefers-reduced-motion,在不支持或用户偏好减少动效时
 *     自动回退到当前已有的"纯色玻璃"配色,保持外观一致。
 *  3. 持久化用户偏好到 localStorage,与 theme 解耦(theme 不感知 liquid glass)。
 *  4. 仅在 <html> 上加一个 data-liquid-glass 属性,所有 CSS 通过属性选择器响应,
 *     避免组件层面 reactive class 触发不必要的 patch。
 *
 * 性能注意:
 *  - 检测只在启动时执行一次,后续不监听 media query 变化(罕见场景,且避免持续开销)。
 *  - 不使用 ResizeObserver/IntersectionObserver,这是纯静态开关。
 */

import { computed, ref } from 'vue'

export type LiquidGlassMode = 'auto' | 'on' | 'off'

const STORAGE_KEY = 'unidoc-liquid-glass'

/** 一次性检测当前 WebView 是否真正支持 backdrop-filter(包含 -webkit- 前缀路径) */
function detectBackdropSupport(): boolean {
  if (typeof window === 'undefined') return false
  // 通过 window 访问避免 no-undef;旧 WebKitGTK 可能没有 CSS.supports
  const cssApi = (window as unknown as { CSS?: { supports?: (p: string, v: string) => boolean } })
    .CSS
  if (!cssApi || typeof cssApi.supports !== 'function') return false
  try {
    return (
      cssApi.supports('backdrop-filter', 'blur(1px)') ||
      cssApi.supports('-webkit-backdrop-filter', 'blur(1px)')
    )
  } catch {
    return false
  }
}

/** 用户是否偏好减少动效(影响是否启用 backdrop-filter 的过渡动画) */
function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 检测只跑一次,结果以 ref 暴露给消费方(保持与 preference/enabled 一致的访问语义) */
const backdropSupported = ref<boolean>(detectBackdropSupport())
const reducedMotion = ref<boolean>(detectReducedMotion())

/** 用户偏好(auto / on / off) */
const preference = ref<LiquidGlassMode>(loadPreference())

function loadPreference(): LiquidGlassMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'on' || v === 'off' || v === 'auto') return v
  } catch {
    // localStorage 不可用时忽略
  }
  // 默认 auto:支持就开,不支持自动关闭
  return 'auto'
}

function persistPreference(v: LiquidGlassMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch {
    // 忽略写入失败
  }
}

/** 实际生效状态:auto 时根据支持情况自动决定 */
const enabled = computed<boolean>(() => {
  if (preference.value === 'off') return false
  if (preference.value === 'on') return backdropSupported.value // 强开但环境不支持也只能回退
  return backdropSupported.value // auto
})

/** 应用到 <html> 上的 data 属性,供 CSS 选择器响应 */
function applyToDom(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (enabled.value) {
    root.setAttribute('data-liquid-glass', 'on')
  } else {
    root.removeAttribute('data-liquid-glass')
  }
  // reduced motion 仅影响动画细节,统一暴露给 CSS
  if (reducedMotion.value) {
    root.setAttribute('data-reduce-motion', 'on')
  } else {
    root.removeAttribute('data-reduce-motion')
  }
}

/** 在应用启动时调用一次 */
function init(): void {
  applyToDom()
}

/** 设置偏好并立即应用 */
function setPreference(v: LiquidGlassMode): void {
  preference.value = v
  persistPreference(v)
  applyToDom()
}

/** 切换 on/off(快捷调用) */
function toggle(): void {
  setPreference(enabled.value ? 'off' : 'on')
}

export function useLiquidGlass() {
  return {
    /** 当前用户偏好 */
    preference,
    /** 是否真正生效(只读) */
    enabled,
    /** 当前 WebView 是否支持 backdrop-filter */
    supported: backdropSupported,
    /** 是否偏好减少动效 */
    reducedMotion,
    /** 启动时调用 */
    init,
    /** 设置偏好 */
    setPreference,
    /** 简单切换 */
    toggle,
  }
}
