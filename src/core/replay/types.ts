/**
 * 文档回放系统类型定义
 */

import type { Block } from '../blocks/types'

/** 单个回放快照 */
export interface ReplaySnapshot {
  /** 唯一 id */
  id: string
  /** 快照时间戳(ms) */
  timestamp: number
  /** 快照标签(手动标记的里程碑名称 / 自动生成的操作描述) */
  label: string
  /** 快照类型 */
  type: 'manual' | 'auto' | 'milestone'
  /** 完整 blocks 深拷贝 */
  blocks: Block[]
}

/** 每篇文档的回放配置(随 .history.json 持久化) */
export interface ReplayConfig {
  /** 是否启用回放快照采集 */
  enabled: boolean
  /** 自动快照间隔(秒),0 表示不自动采集 */
  autoIntervalSec: number
  /** 回放默认播放速度(倍速) */
  playbackSpeed: number
}

/** .history.json 文件结构 */
export interface HistoryFileData {
  /** 文件格式版本 */
  version: string
  /** 文档路径(vault 相对路径) */
  docPath: string
  /** 文档标题 */
  title: string
  /** 回放配置 */
  config: ReplayConfig
  /** 快照列表(按时间升序) */
  snapshots: ReplaySnapshot[]
}

/** 默认回放配置 */
export function defaultReplayConfig(): ReplayConfig {
  return {
    enabled: true,
    autoIntervalSec: 60,
    playbackSpeed: 1
  }
}
