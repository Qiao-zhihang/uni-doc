/**
 * 记忆管理 UI 共享类型与文件读写辅助
 *
 * - 子组件通过 MemoryNotifyPayload 把轻提示/撤销操作冒泡给 MemoryManager
 * - 导入走 open_file_dialog + load_md_file(Tauri) 或浏览器 file input(Web)
 * - 导出走 saveFile(自动适配 Tauri 保存对话框 / 浏览器下载)
 */
import { isTauri, saveFile, type SaveFileFilter } from '@/core/serializer/markdownFile'
import type { MemoryExport } from '@/ai/types'

/** 子组件 → MemoryManager 的轻提示事件 */
export interface MemoryNotifyPayload {
  type: 'success' | 'error' | 'info'
  message: string
  /** 可选撤销操作：显示在 toast 上，点击后执行 */
  undo?: () => void
}

/** 导入/导出共用的文件类型过滤器 */
export const MEMORY_FILE_FILTERS: SaveFileFilter[] = [
  { name: 'JSON 文件', extensions: ['json'] },
  { name: '所有文件', extensions: ['*'] },
]

export interface PickedMemoryFile {
  fileName: string
  raw: unknown
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** Web 端:通过隐藏 file input 选择文件 */
function pickFileWeb(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    let settled = false
    let focusTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (focusTimer !== null) clearTimeout(focusTimer)
      window.removeEventListener('focus', onWindowFocus)
    }
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(file)
    }
    // 用户取消时不会触发 change，用窗口重新获得焦点兜底 resolve(null)
    const onWindowFocus = () => {
      focusTimer = setTimeout(() => finish(input.files?.[0] ?? null), 400)
    }

    input.onchange = () => finish(input.files?.[0] ?? null)
    window.addEventListener('focus', onWindowFocus)
    input.click()
  })
}

/**
 * 选择并读取记忆 JSON 文件。用户取消返回 null，文件非法 JSON 时抛错。
 * 桌面端依赖 Rust 命令 open_file_dialog / load_md_file；命令缺失时向上抛错，
 * 由调用方展示可读的错误提示（优雅降级）。
 */
export async function openMemoryFile(): Promise<PickedMemoryFile | null> {
  let fileName = '记忆文件.json'
  let content: string

  if (isTauri()) {
    const filePath = await tauriInvoke<string | null>('open_file_dialog', {
      title: '导入 AI 记忆',
      filters: MEMORY_FILE_FILTERS,
    })
    if (!filePath) return null
    content = await tauriInvoke<string>('load_md_file', { filePath })
    const parts = filePath.replace(/\\/g, '/').split('/')
    fileName = parts[parts.length - 1] || fileName
  } else {
    const file = await pickFileWeb()
    if (!file) return null
    content = await file.text()
    fileName = file.name
  }

  try {
    const parsed: unknown = JSON.parse(content)
    return { fileName, raw: parsed }
  } catch {
    throw new Error('文件不是合法的 JSON，无法导入')
  }
}

/** 导出记忆到 JSON 文件；返回 false 表示用户在保存对话框中取消 */
export async function saveMemoryExport(data: MemoryExport): Promise<boolean> {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const json = JSON.stringify(data, null, 2)
  return saveFile(json, `unidoc-ai-memory-${stamp}.json`, MEMORY_FILE_FILTERS, 'application/json')
}

/** 把底层异常转为可读文案；对「命令不存在」给出更新应用提示 */
export function describeFileError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  if (/not found|unknown command|unsupported|未找到|不支持/i.test(raw)) {
    return '当前桌面端版本不支持系统文件选择，请更新应用后重试'
  }
  return raw || '未知错误'
}

/** 内容截断，用于确认弹窗摘要 */
export function truncateText(text: string, max = 80): string {
  const trimmed = (text ?? '').trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}
