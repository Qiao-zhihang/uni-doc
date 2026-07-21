/**
 * 回放快照持久化存储
 * 在 vault 中为每个 .md 文件生成同名 .md.history.json 侧车文件
 *
 * 双实现策略:
 *   - Tauri 环境:写入 vault 下的 .md.history.json 文件
 *   - Web 环境:  使用 IndexedDB(`uni-doc-replay`/`histories`,keyPath=docPath)持久化
 *     纯 Web 环境回放历史刷新后不丢失
 */

import { isTauri } from '../serializer/markdownFile'
import { readVaultFile, writeVaultFile } from '../vault/vault'
import type { HistoryFileData } from './types'
import { defaultReplayConfig } from './types'

export const FILE_VERSION = '1.0.0'

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

// ===== Web 环境:IndexedDB 持久化 =====

const DB_NAME = 'uni-doc-replay'
const DB_VERSION = 1
const STORE_NAME = 'histories'

let dbPromise: Promise<IDBDatabase> | null = null

/** 打开(并按需升级)回放历史数据库 */
function openReplayDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'docPath' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/** 从 IndexedDB 读取单条记录 */
function dbGet<T>(key: string): Promise<T | undefined> {
  return openReplayDB().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(key)
        req.onsuccess = () => resolve(req.result as T | undefined)
        req.onerror = () => reject(req.error)
      })
  )
}

/** 向 IndexedDB 写入(覆盖)单条记录 */
function dbPut<T>(value: T): Promise<void> {
  return openReplayDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(value as unknown as Record<string, unknown>)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
  )
}

/** 读取文档的 history 文件(不存在则返回 null) */
export async function loadHistory(
  vaultRoot: string,
  mdPath: string
): Promise<HistoryFileData | null> {
  if (!isTauri()) {
    // Web 环境:IndexedDB 持久化
    try {
      const data = await dbGet<HistoryFileData>(mdPath)
      if (!data) return null
      // 兼容性:确保新字段存在
      if (!data.config) data.config = defaultReplayConfig()
      if (!data.snapshots) data.snapshots = []
      return data
    } catch {
      return null
    }
  }
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
  if (!isTauri()) {
    // Web 环境:IndexedDB 持久化
    try {
      await dbPut(data)
    } catch {
      // 静默失败:回放历史持久化失败不应阻塞 UI
    }
    return
  }
  const historyPath = toHistoryPath(mdPath)
  const content = JSON.stringify(data, null, 2)
  await writeVaultFile(vaultRoot, historyPath, content)
}
