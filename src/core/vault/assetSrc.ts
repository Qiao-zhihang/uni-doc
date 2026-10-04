/**
 * vault 资源路径解析(图片 src → WebView 可加载的 URL)
 *
 * 提取自 ImageBlock.vue 原有实现,供编辑器图片块、HTML 导出与 AI 气泡三处共用,
 * 避免同一套规则各写一遍导致行为漂移。
 *
 * 规则:
 *   1. 已带 https?: / data: / asset: / blob: / 绝对路径前缀 → 原样返回
 *   2. 其余视为"相对文档所在目录"的 vault 相对路径 → 拼成绝对路径后走 convertFileSrc
 *   3. 非 Tauri(Web 预览)环境无法访问本地文件 → 原样返回,交给浏览器处理
 */

import { isTauri } from '@/core/serializer/markdownFile'

/** 是否已经是可直接交给 <img src> 的地址(无需再做 vault 解析) */
export function isDirectSrc(src: string): boolean {
  return /^(https?:|data:|asset:|\/|blob:)/.test(src)
}

export interface AssetSrcContext {
  /** vault 根目录绝对路径 */
  vaultRoot?: string | null
  /** 当前文档在 vault 中的相对路径(用于计算文档所在目录) */
  docPath?: string | null
}

/**
 * 把图片 src 解析为 WebView 可加载的 URL
 * Tauri 环境下 vault 相对路径会被转换为 asset://(经 CSP 放行)
 */
export async function resolveAssetSrc(src: string, ctx: AssetSrcContext = {}): Promise<string> {
  const raw = (src ?? '').trim()
  if (!raw) return ''
  if (isDirectSrc(raw)) return raw
  const root = ctx.vaultRoot
  // 非 Tauri 或未打开 vault:保留原值,让浏览器按相对路径尝试
  if (!root || !isTauri()) return raw
  // 算出文档所在目录(去掉文件名);无活动文档时落到 vault 根
  const tabPath = ctx.docPath
  const dir = tabPath ? tabPath.split('/').slice(0, -1).join('/') : ''
  const abs = (dir ? `${root}/${dir}/${raw}` : `${root}/${raw}`).replace(/\\/g, '/')
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return convertFileSrc(abs)
}
