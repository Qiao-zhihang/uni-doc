/**
 * 撤销重做系统
 * 参考 PRD §4.1(完整操作历史栈、分支撤销)
 *
 * M1 实现:基于 blocks 快照的栈式历史
 * - 每次 Block 变更前入栈
 * - Ctrl+Z 撤销,Ctrl+Shift+Z 重做
 * - 达到上限时丢弃最早的历史
 */

import type { Block } from '../blocks/types'

const DEFAULT_LIMIT = 100

export interface HistorySnapshot {
  blocks: Block[]
  /** 触发本次快照的操作描述,用于状态栏展示 */
  label: string
  timestamp: number
}

export class UndoRedo {
  private undoStack: HistorySnapshot[] = []
  private redoStack: HistorySnapshot[] = []
  private limit: number

  constructor(limit = DEFAULT_LIMIT) {
    this.limit = limit
  }

  /** 深拷贝 blocks(JSON 序列化更可靠) */
  private cloneBlocks(blocks: Block[]): Block[] {
    return JSON.parse(JSON.stringify(blocks))
  }

  /** 当前是否可撤销 */
  canUndo(): boolean {
    return this.undoStack.length > 1
  }

  /** 当前是否可重做 */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * 推入一个新快照(在执行变更前调用)
   * @param blocks 变更前的 blocks 快照
   * @param label 操作描述
   *
   * 合并策略:同 label 且距上次 push <1s 时,视为同一连续操作,跳过新快照(滑动窗口,
   * 更新 timestamp)。这样连续打字/连续微调不会产生大量撤销点。
   */
  push(blocks: Block[], label = '编辑'): void {
    // 新操作总是清空重做栈(分支撤销语义),即使本次被合并
    this.redoStack = []
    const now = Date.now()
    const last = this.undoStack[this.undoStack.length - 1]
    if (last && last.label === label && now - last.timestamp < 1000) {
      // 合并:滑动窗口,更新 timestamp,不 push 新快照
      last.timestamp = now
      return
    }
    const snapshot: HistorySnapshot = {
      blocks: this.cloneBlocks(blocks),
      label,
      timestamp: now
    }
    this.undoStack.push(snapshot)
    // 超出上限丢弃最早历史
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift()
    }
  }

  /**
   * 撤销:返回上一个快照
   * @param current 当前的 blocks(会被压入 redo 栈)
   */
  undo(current: Block[]): HistorySnapshot | null {
    if (!this.canUndo()) return null
    // 当前状态入重做栈
    this.redoStack.push({
      blocks: this.cloneBlocks(current),
      label: '当前',
      timestamp: Date.now()
    })
    return this.undoStack.pop() ?? null
  }

  /**
   * 重做:恢复被撤销的快照
   * @param current 当前的 blocks(会被压入 undo 栈)
   */
  redo(current: Block[]): HistorySnapshot | null {
    if (!this.canRedo()) return null
    this.undoStack.push({
      blocks: this.cloneBlocks(current),
      label: '当前',
      timestamp: Date.now()
    })
    return this.redoStack.pop() ?? null
  }

  /** 重置历史(用于加载新文档) */
  reset(blocks: Block[], label = '初始'): void {
    this.undoStack = [
      {
        blocks: this.cloneBlocks(blocks),
        label,
        timestamp: Date.now()
      }
    ]
    this.redoStack = []
  }

  /** 获取最近一次操作标签(用于状态栏) */
  lastLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? ''
  }
}
