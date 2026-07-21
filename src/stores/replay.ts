/**
 * 回放系统 Pinia Store
 * 管理:快照采集(手动/定时)、配置、持久化、播放控制
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useDocumentStore } from './document'
import { uuid } from '../core/blocks/factory'
import type { Block } from '../core/blocks/types'
import type { ReplaySnapshot, ReplayConfig, HistoryFileData } from '../core/replay/types'
import { defaultReplayConfig } from '../core/replay/types'
import {
  loadHistory,
  saveHistory,
  createEmptyHistoryData,
  FILE_VERSION
} from '../core/replay/storage'

export const useReplayStore = defineStore('replay', () => {
  const doc = useDocumentStore()

  // ===== state =====
  /** 当前文档的快照列表 */
  const snapshots = ref<ReplaySnapshot[]>([])
  /** 当前文档的回放配置 */
  const config = ref<ReplayConfig>(defaultReplayConfig())
  /** 是否已加载当前文档的 history */
  const loaded = ref(false)
  /** 当前加载的文档路径 */
  const loadedPath = ref<string | null>(null)

  /** 定时器引用 */
  let autoTimer: ReturnType<typeof setInterval> | null = null

  /** 是否正在回放 */
  const isPlaying = ref(false)
  /** 当前回放到的快照索引 */
  const currentIndex = ref(-1)
  /** 回放速度 */
  const playSpeed = ref(1)

  // ===== computed =====
  const snapshotCount = computed(() => snapshots.value.length)
  const canPlay = computed(() => snapshots.value.length > 1)
  const hasSnapshots = computed(() => snapshots.value.length > 0)

  /** 当前快照(回放中) */
  const currentSnapshot = computed(() => {
    if (currentIndex.value < 0 || currentIndex.value >= snapshots.value.length) return null
    return snapshots.value[currentIndex.value]
  })

  // ===== 内部工具 =====

  /** 深拷贝 blocks */
  function cloneBlocks(blocks: Block[]): Block[] {
    return JSON.parse(JSON.stringify(blocks))
  }

  /** 获取文档标题 */
  function getDocTitle(): string {
    const tab = doc.openTabs.find((t) => t.id === doc.activeTabId)
    return tab?.meta?.title ?? '未命名文档'
  }

  /** 持久化到 .history.json */
  async function persist() {
    if (!doc.vaultRoot || !loadedPath.value) return
    const data: HistoryFileData = {
      version: FILE_VERSION,
      docPath: loadedPath.value,
      title: getDocTitle(),
      config: config.value,
      snapshots: snapshots.value
    }
    await saveHistory(doc.vaultRoot, loadedPath.value, data)
  }

  /** 防抖持久化 */
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void persist()
    }, 1500)
  }

  // ===== 快照采集 =====

  /** 采集一个快照 */
  function captureSnapshot(label: string, type: ReplaySnapshot['type'] = 'auto') {
    if (!config.value.enabled) return
    if (!loadedPath.value) return

    const snapshot: ReplaySnapshot = {
      id: uuid(),
      timestamp: Date.now(),
      label,
      type,
      blocks: cloneBlocks(doc.blocks)
    }
    snapshots.value.push(snapshot)
    schedulePersist()
  }

  /** 手动标记里程碑快照 */
  function markMilestone(label: string = '里程碑') {
    captureSnapshot(label, 'milestone')
  }

  /** 更新快照标签（用于重命名里程碑） */
  function updateSnapshotLabel(id: string, label: string) {
    const snap = snapshots.value.find(s => s.id === id)
    if (snap) {
      snap.label = label
      schedulePersist()
    }
  }

  /** 更新快照类型（切换里程碑/普通） */
  function updateSnapshotType(id: string, type: ReplaySnapshot['type']) {
    const snap = snapshots.value.find(s => s.id === id)
    if (snap) {
      snap.type = type
      schedulePersist()
    }
  }

  /** 手动快照 */
  function captureManual(label: string = '手动快照') {
    captureSnapshot(label, 'manual')
  }

  // ===== 定时自动采集 =====

  function startAutoCapture() {
    stopAutoCapture()
    if (!config.value.enabled || config.value.autoIntervalSec <= 0) return
    autoTimer = setInterval(() => {
      captureSnapshot('自动快照', 'auto')
    }, config.value.autoIntervalSec * 1000)
  }

  function stopAutoCapture() {
    if (autoTimer) {
      clearInterval(autoTimer)
      autoTimer = null
    }
  }

  // ===== 加载/卸载 =====

  /** 加载请求 ID,用于异步竞态保护:快速切 tab 时旧请求结果不覆盖新文档状态 */
  let loadReqId = 0

  /** 加载文档的 history(打开文档时调用) */
  async function loadForDoc(mdPath: string) {
    stopAutoCapture()
    loaded.value = false

    if (!doc.vaultRoot || !mdPath) {
      // 空文档:同步清理状态,不参与竞态
      loadedPath.value = mdPath || null
      snapshots.value = []
      return
    }

    // 占位赋值,确保后续 persist 等逻辑能拿到当前路径
    loadedPath.value = mdPath
    const reqId = ++loadReqId

    const data = await loadHistory(doc.vaultRoot, mdPath)
    // 异步竞态保护:如果中间又触发了新的 loadForDoc,丢弃本次结果
    if (reqId !== loadReqId) return

    if (data) {
      snapshots.value = data.snapshots
      config.value = data.config
      // 兼容旧数据:enabled=true 但 autoIntervalSec<=0 时补默认值,避免 startAutoCapture 静默失效
      if (config.value.enabled && config.value.autoIntervalSec <= 0) {
        config.value = { ...config.value, autoIntervalSec: 60 }
        schedulePersist()
      }
    } else {
      // 新文档:初始化空 history,采集初始快照
      snapshots.value = []
      const initData = createEmptyHistoryData(mdPath, getDocTitle())
      config.value = initData.config
      // 采集初始快照
      const initSnapshot: ReplaySnapshot = {
        id: uuid(),
        timestamp: Date.now(),
        label: '文档初始状态',
        type: 'manual',
        blocks: cloneBlocks(doc.blocks)
      }
      snapshots.value.push(initSnapshot)
      void persist()
    }

    loaded.value = true
    startAutoCapture()
  }

  /** 卸载(关闭文档/切换 tab 时调用) */
  async function unload() {
    stopAutoCapture()
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    // 同步收集数据快照,避免清空后异步 persist 引用到空状态
    const pathToSave = loadedPath.value
    if (doc.vaultRoot && pathToSave) {
      const data: HistoryFileData = {
        version: FILE_VERSION,
        docPath: pathToSave,
        title: getDocTitle(),
        config: config.value,
        snapshots: snapshots.value
      }
      // 同步清空状态,再异步写入(不阻塞 UI)
      snapshots.value = []
      currentIndex.value = -1
      isPlaying.value = false
      loaded.value = false
      loadedPath.value = null
      await saveHistory(doc.vaultRoot, pathToSave, data)
    } else {
      // 没有可持久化内容,仅清空状态
      snapshots.value = []
      currentIndex.value = -1
      isPlaying.value = false
      loaded.value = false
      loadedPath.value = null
    }
  }

  // ===== 回放控制 =====

  /** 开始回放 */
  function play() {
    if (snapshots.value.length < 2) return
    if (currentIndex.value < 0) currentIndex.value = 0
    isPlaying.value = true
  }

  /** 暂停回放 */
  function pause() {
    isPlaying.value = false
  }

  /** 跳到指定快照 */
  function jumpTo(index: number) {
    if (index < 0 || index >= snapshots.value.length) return
    currentIndex.value = index
  }

  /** 上一个快照 */
  function prev() {
    if (currentIndex.value > 0) currentIndex.value--
  }

  /** 下一个快照 */
  function next() {
    if (currentIndex.value < snapshots.value.length - 1) currentIndex.value++
  }

  /** 退出回放 */
  function exitReplay() {
    isPlaying.value = false
    currentIndex.value = -1
  }

  // ===== 配置更新 =====

  function updateConfig(patch: Partial<ReplayConfig>) {
    const wasEnabled = config.value.enabled
    const newEnabled = patch.enabled ?? wasEnabled
    // 开启时如果间隔为 0,默认设为 60 秒(1分钟)
    if (newEnabled && !wasEnabled && config.value.autoIntervalSec <= 0) {
      config.value = { ...config.value, ...patch, autoIntervalSec: 60 }
    } else {
      config.value = { ...config.value, ...patch }
    }
    // 如果间隔或启用状态变化,重启定时器
    if ('autoIntervalSec' in patch || 'enabled' in patch) {
      startAutoCapture()
    }
    schedulePersist()
  }

  // ===== 清理 =====
  function dispose() {
    stopAutoCapture()
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
  }

  return {
    // state
    snapshots,
    config,
    loaded,
    loadedPath,
    isPlaying,
    currentIndex,
    playSpeed,
    // computed
    snapshotCount,
    canPlay,
    hasSnapshots,
    currentSnapshot,
    // 采集
    captureSnapshot,
    markMilestone,
    updateSnapshotLabel,
    updateSnapshotType,
    captureManual,
    // 加载
    loadForDoc,
    unload,
    // 回放控制
    play,
    pause,
    jumpTo,
    prev,
    next,
    exitReplay,
    // 配置
    updateConfig,
    // 生命周期
    dispose
  }
})
