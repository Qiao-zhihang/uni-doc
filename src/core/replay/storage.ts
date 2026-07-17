/**
 * 回放快照持久化存储
 * 在 vault 中为每个 .md 文件生成同名 .md.history.json 侧车文件
 */

import { isTauri } from '../serializer/markdownFile'
import { readVaultFile, writeVaultFile } from '../vault/vault'
import type { HistoryFileData, ReplayConfig } from './types'
import { defaultReplayConfig } from './types'

const FILE_VERSION = '1.0.0'

/** 将 .md 路径转为 .md.history.json 路径 */
export function toHistoryPath(mdPath: string): string {
  // 自我介绍.md → 自我介绍.md.history.json
  return `${mdPath}.history.json`
}

/** 创建空的 history 文件数据 */
export function createEmptyHistoryData(docPath: string, title: string): HistoryFileData {
  return {
    version: FILE_VERSION,
    docPath,
    title,
    config: defaultReplayConfig(),
    snapshots: []
  }
}

/** 读取文档的 history 文件(不存在则返回 null) */
export async function loadHistory(
  vaultRoot: string,
  mdPath: string
): Promise<HistoryFileData | null> {
  if (!isTauri()) return null
  const historyPath = toHistoryPath(mdPath)
  try {
    const content = await readVaultFile(vaultRoot, historyPath)
    const data = JSON.parse(content) as HistoryFileData
    // 兼容性:确保新字段存在
    if (!data.config) data.config = defaultReplayConfig()
    if (!data.snapshots) data.snapshots = []
    return data
  } catch {
    // 文件不存在或解析失败
    return null
  }
}

/** 写入文档的 history 文件 */
export async function saveHistory(
  vaultRoot: string,
  mdPath: string,
  data: HistoryFileData
): Promise<void> {
  if (!isTauri()) return
  const historyPath = toHistoryPath(mdPath)
  const content = JSON.stringify(data, null, 2)
  await writeVaultFile(vaultRoot, historyPath, content)
}

/** 仅更新配置部分(轻量写入,避免频繁序列化大量快照) */
export async function saveHistoryConfig(
  vaultRoot: string,
  mdPath: string,
  config: ReplayConfig
): Promise<void> {
  if (!isTauri()) return
  // 需要先读取现有数据,仅替换 config,再写回
  const existing = await loadHistory(vaultRoot, mdPath)
  if (existing) {
    existing.config = config
    await saveHistory(vaultRoot, mdPath, existing)
  }
}
