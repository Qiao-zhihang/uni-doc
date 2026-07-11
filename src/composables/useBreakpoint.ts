/**
 * 响应式断点
 * 参考 UI 改造方案 §3.4(响应式)
 *
 * 断点规则:
 *   - >= 1000px: 桌面布局,所有面板可用,用户可手动折叠
 *   - 700-999px: 中等屏,自动折叠 FileExplorer + Outline,用户仍可手动展开
 *   - < 700px:  窄屏,强制折叠(不允许展开),Ribbon 保留原位
 */

import { onMounted, onUnmounted, ref } from 'vue'

export interface BreakpointState {
  /** 当前视口宽度 */
  width: number
  /** 中等屏断点(700-999px) */
  isMedium: boolean
  /** 窄屏断点(< 700px) */
  isNarrow: boolean
  /** 桌面(>= 1000px) */
  isDesktop: boolean
}

export function useBreakpoint() {
  const state = ref<BreakpointState>({
    width: window.innerWidth,
    isMedium: false,
    isNarrow: false,
    isDesktop: true
  })

  function update() {
    const w = window.innerWidth
    state.value = {
      width: w,
      isMedium: w >= 700 && w < 1000,
      isNarrow: w < 700,
      isDesktop: w >= 1000
    }
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', update)
  })

  return state
}
