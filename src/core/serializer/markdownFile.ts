/**
 * Markdown 文件读写
 * 参考 PRD §11.4(Markdown 序列化)
 *
 * 纯 Markdown 文件读写(不含 .uni-doc 元数据)
 * - 保存为 .md 文件
 * - 支持打开 .md 文件
 *
 * 双实现策略:
 *   - Tauri 环境:调用 Rust 后端命令(原生文件对话框)
 *   - Web 环境:  浏览器 file input + Blob 下载
 */

import type { Block, DocumentMeta } from '../blocks/types'
import { serializeMarkdown, deserializeMarkdown, parseFrontmatter } from './markdown'

/** 检测当前是否运行在 Tauri 环境中 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 动态导入 Tauri invoke,避免 Web 环境下打包报错 */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** Tauri:弹出保存对话框并写入 .md 文件 */
async function saveMdTauri(blocks: Block[], fileName: string): Promise<boolean> {
  const filePath = await tauriInvoke<string | null>('save_md_dialog', {
    title: '保存 Markdown 文件',
    defaultName: fileName.endsWith('.md') ? fileName : `${fileName}.md`
  })
  if (!filePath) return false

  const content = serializeMarkdown(blocks)
  await tauriInvoke('save_md_file', { filePath, content })
  return true
}

/** Tauri:弹出打开对话框并读取 .md 文件 */
async function openMdTauri(): Promise<{ content: string; fileName: string } | null> {
  const filePath = await tauriInvoke<string | null>('open_md_dialog', {})
  if (!filePath) return null

  const content = await tauriInvoke<string>('load_md_file', { filePath })

  const parts = filePath.replace(/\\/g, '/').split('/')
  const fileName = parts[parts.length - 1] || 'document.md'

  return { content, fileName }
}

/** Web:触发浏览器下载 .md 文件 */
async function saveMdWeb(blocks: Block[], fileName: string): Promise<void> {
  const content = serializeMarkdown(blocks)
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.md') ? fileName : `${fileName}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Web:打开本地 .md 文件(通过隐藏的 file input) */
function openMdWeb(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt'
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      resolve(file)
    }
    input.click()
  })
}

/** 保存 .md 文件(自动选择 Tauri/Web 路径) */
export async function saveMarkdownFile(blocks: Block[], fileName = 'document.md'): Promise<boolean> {
  if (isTauri()) {
    return saveMdTauri(blocks, fileName)
  }
  await saveMdWeb(blocks, fileName)
  return true
}

/** 打开 .md 文件(自动选择 Tauri/Web 路径) */
export async function openMarkdownFile(): Promise<{
  blocks: Block[]
  fileName: string
  meta: Partial<DocumentMeta> | null
} | null> {
  if (isTauri()) {
    const result = await openMdTauri()
    if (!result) return null
    const { meta, body } = parseFrontmatter(result.content)
    const blocks = deserializeMarkdown(body)
    return { blocks, fileName: result.fileName, meta }
  }

  const file = await openMdWeb()
  if (!file) return null
  const content = await file.text()
  const { meta, body } = parseFrontmatter(content)
  const blocks = deserializeMarkdown(body)
  return { blocks, fileName: file.name, meta }
}

// ===== 保留旧接口兼容 =====
export { saveMarkdownFile as downloadMarkdownFile }
export { openMdWeb as pickMarkdownFile }