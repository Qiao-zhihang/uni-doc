/**
 * 统一对话框系统
 * 替代 window.confirm / window.prompt(Tauri 环境下原生对话框被禁用)
 *
 * 用法:
 *   import { confirmDialog, promptDialog } from '@/composables/useDialog'
 *   const ok = await confirmDialog('确认删除?')
 *   const name = await promptDialog('文件名:', '默认值')
 *
 * 实现:基于 Vue reactive 状态 + Promise,由 DialogHost 组件渲染 modal
 * Web/Tauri 体验一致,无原生对话框依赖
 */
import { reactive } from 'vue'

interface ConfirmState {
  visible: boolean
  message: string
  title: string
  resolve: ((v: boolean) => void) | null
}

interface PromptState {
  visible: boolean
  message: string
  title: string
  defaultValue: string
  inputValue: string
  resolve: ((v: string | null) => void) | null
}

const confirmState = reactive<ConfirmState>({
  visible: false,
  message: '',
  title: '确认',
  resolve: null
})

const promptState = reactive<PromptState>({
  visible: false,
  message: '',
  title: '输入',
  defaultValue: '',
  inputValue: '',
  resolve: null
})

/** 显示确认对话框,返回用户是否点击"确认" */
export function confirmDialog(message: string, title = '确认'): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.title = title
    confirmState.resolve = resolve
    confirmState.visible = true
  })
}

/** 显示输入对话框,返回用户输入的值(取消则返回 null) */
export function promptDialog(message: string, defaultValue = '', title = '输入'): Promise<string | null> {
  return new Promise((resolve) => {
    promptState.message = message
    promptState.title = title
    promptState.defaultValue = defaultValue
    promptState.inputValue = defaultValue
    promptState.resolve = resolve
    promptState.visible = true
  })
}

/** DialogHost 组件用:确认 */
function resolveConfirm(value: boolean) {
  if (confirmState.resolve) confirmState.resolve(value)
  confirmState.visible = false
  confirmState.resolve = null
}

/** DialogHost 组件用:输入确认 */
function resolvePrompt(value: string | null) {
  if (promptState.resolve) promptState.resolve(value)
  promptState.visible = false
  promptState.resolve = null
}

/** 供 DialogHost 组件使用的状态和方法 */
export function useDialog() {
  return {
    confirmState,
    promptState,
    resolveConfirm,
    resolvePrompt
  }
}
