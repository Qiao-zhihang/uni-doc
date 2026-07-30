/**
 * 导出对话框状态管理
 * 与 ExportDialog.vue 组件配合使用
 *
 * 用法:
 *   import { openExportDialog } from '@/composables/useExportDialog'
 *   const result = await openExportDialog()
 */
import { reactive } from 'vue'
import type { HtmlStyleMode, HtmlImageMode } from '@/core/serializer/html'

export type ExportFormat = 'md' | 'html'

export interface ExportMdResult {
  format: 'md'
}

export interface ExportHtmlResult {
  format: 'html'
  styleMode: HtmlStyleMode
  imageMode: HtmlImageMode
  theme: 'light' | 'dark'
}

export type ExportResult = ExportMdResult | ExportHtmlResult

interface DialogState {
  visible: boolean
  format: ExportFormat
  styleMode: HtmlStyleMode
  imageMode: HtmlImageMode
  theme: 'light' | 'dark'
  resolve: ((v: ExportResult | null) => void) | null
}

export const exportDialogState = reactive<DialogState>({
  visible: false,
  format: 'html',
  styleMode: 'styled',
  imageMode: 'keep',
  theme: 'light',
  resolve: null,
})

export function closeExportDialog(value: ExportResult | null) {
  if (exportDialogState.resolve) exportDialogState.resolve(value)
  exportDialogState.visible = false
  exportDialogState.resolve = null
}

export function confirmExportDialog() {
  if (exportDialogState.format === 'md') {
    closeExportDialog({ format: 'md' })
  } else {
    closeExportDialog({
      format: 'html',
      styleMode: exportDialogState.styleMode,
      imageMode: exportDialogState.imageMode,
      theme: exportDialogState.theme,
    })
  }
}

/** 打开导出对话框,返回用户选择的导出配置(取消则返回 null) */
export function openExportDialog(
  defaults: Partial<{ format: ExportFormat; theme: 'light' | 'dark' }> = {},
): Promise<ExportResult | null> {
  return new Promise((resolve) => {
    exportDialogState.format = defaults.format ?? 'html'
    exportDialogState.theme = defaults.theme ?? 'light'
    exportDialogState.styleMode = 'styled'
    exportDialogState.imageMode = 'keep'
    exportDialogState.resolve = resolve
    exportDialogState.visible = true
  })
}
