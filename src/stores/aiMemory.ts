/**
 * AI 全局记忆 Store
 * 管理用户画像、事实知识库与记忆行为设置
 * 持久化到 ~/.unidoc/ai_memory.json (Tauri) 或 localStorage (Web)
 *
 * 数据校验/排序/清理/去重/导入导出等纯逻辑在 @/ai/memoryCore，
 * 本 store 负责状态、持久化与生命周期。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isTauri } from '@/core/serializer/markdownFile'
import type {
  GlobalMemory,
  MemoryCategory,
  MemoryExport,
  MemoryFact,
  MemoryOrigin,
  MemorySettings,
  UserProfile,
} from '@/ai/types'
import { DEFAULT_MEMORY_SETTINGS, MEMORY_CATEGORY_LABELS, MEMORY_VERSION } from '@/ai/types'
import {
  MAX_FACTS,
  MAX_FACT_CONTENT_LENGTH,
  cleanupFacts,
  createMemoryExport,
  evictOverflow,
  findDuplicateGroups,
  findDuplicateOf,
  inferMemoryOrigin,
  mergeFactGroup,
  normalizeCategory,
  normalizeImportance,
  normalizeMemory,
  normalizeMemorySettings,
  normalizeTagList,
  normalizeUserProfile,
  parseMemoryExport,
  rankFacts,
  type DuplicateGroup,
} from '@/ai/memoryCore'

/** Web 端 localStorage key（保持稳定，兼容历史数据） */
export const MEMORY_STORAGE_KEY = 'unidoc-ai-memory'

const SAVE_DEBOUNCE_MS = 500

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** 安全生成 id：局域网 http 等非安全上下文下 crypto.randomUUID 不可用 */
function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // 回退到随机字符串
  }
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function createEmptyMemory(): GlobalMemory {
  return {
    version: MEMORY_VERSION,
    profile: {},
    facts: [],
    settings: { ...DEFAULT_MEMORY_SETTINGS },
    updatedAt: 0,
  }
}

/** addFact 的可选参数 */
export interface AddFactOptions {
  origin?: MemoryOrigin
  sourceConversationId?: string
  /** 指定 id（测试/导入用，正常不传） */
  id?: string
}

/** 导入结果，供 UI 展示 */
export interface ImportMemoryResult {
  mode: 'merge' | 'replace'
  added: number
  updated: number
  skipped: number
  total: number
}

export const useAiMemoryStore = defineStore('aiMemory', () => {
  const memory = ref<GlobalMemory>(createEmptyMemory())
  const loaded = ref(false)
  const loadError = ref<string | null>(null)
  const loadWarnings = ref<string[]>([])

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let loadPromise: Promise<void> | null = null
  let lifecycleBound = false

  const profile = computed(() => memory.value.profile)
  const facts = computed(() => memory.value.facts)
  const settings = computed(() => memory.value.settings)
  const enabled = computed(() => memory.value.settings.enabled !== false)
  const stats = computed(() => {
    const all = memory.value.facts
    const byCategory: Record<string, number> = {}
    for (const category of Object.keys(MEMORY_CATEGORY_LABELS)) byCategory[category] = 0
    for (const fact of all) {
      byCategory[fact.category] = (byCategory[fact.category] ?? 0) + 1
    }
    const profileFields = Object.values(memory.value.profile).filter((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    ).length
    return {
      total: all.length,
      enabled: all.filter((fact) => fact.enabled !== false).length,
      pinned: all.filter((fact) => fact.pinned === true).length,
      profileFields,
      byCategory,
      capacity: MAX_FACTS,
    }
  })

  // ===================== 持久化 =====================

  function touch() {
    memory.value.updatedAt = Date.now()
  }

  /** 防抖保存；未成功加载前不写盘，避免用空数据覆盖磁盘 */
  function save() {
    if (!loaded.value) return
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
  }

  async function persist() {
    try {
      const json = JSON.stringify(memory.value)
      if (isTauri()) {
        await tauriInvoke('save_ai_memory', { json })
      } else {
        localStorage.setItem(MEMORY_STORAGE_KEY, json)
      }
    } catch (e) {
      console.error('保存AI记忆数据失败:', e)
    }
  }

  /** 立即落盘（关闭窗口/破坏性操作/离开页面时调用） */
  async function flushSave() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!loaded.value) return
    await persist()
  }

  function bindLifecycle() {
    if (lifecycleBound || typeof window === 'undefined') return
    lifecycleBound = true
    window.addEventListener('beforeunload', () => {
      void flushSave()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushSave()
    })
  }

  /** 备份当前记忆（清空/导入替换/迁移前使用） */
  async function backupMemory(): Promise<void> {
    try {
      const json = JSON.stringify(memory.value)
      if (isTauri()) {
        await tauriInvoke('save_ai_memory_backup', { json })
      } else {
        localStorage.setItem(`${MEMORY_STORAGE_KEY}-backup`, json)
      }
    } catch (e) {
      console.warn('备份记忆失败:', e)
    }
  }

  // ===================== 加载 / 迁移 =====================

  function load(): Promise<void> {
    if (loaded.value) return Promise.resolve()
    if (loadPromise) return loadPromise
    loadPromise = doLoad().finally(() => {
      loadPromise = null
    })
    return loadPromise
  }

  async function doLoad(): Promise<void> {
    try {
      let json: string | null = null
      if (isTauri()) {
        const raw = await tauriInvoke<string>('load_ai_memory')
        json = raw && raw.length > 0 ? raw : null
      } else {
        json = localStorage.getItem(MEMORY_STORAGE_KEY)
      }

      if (!json) {
        memory.value = createEmptyMemory()
        loaded.value = true
        loadError.value = null
        loadWarnings.value = []
        bindLifecycle()
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch {
        throw new Error('记忆文件不是合法 JSON，已停止自动保存以保护原文件')
      }

      const result = normalizeMemory(parsed, { now: Date.now(), idFactory: generateId })
      if (result.migrated) {
        // 迁移前先留一份原始备份（失败不阻塞加载）
        await backupRaw(json)
      }

      memory.value = result.memory
      loadWarnings.value = result.warnings
      loaded.value = true
      loadError.value = null
      bindLifecycle()

      let needsSave = result.migrated || result.dropped > 0
      if (memory.value.facts.length > 0) {
        const { kept, removed } = cleanupFacts(memory.value.facts, Date.now(), MAX_FACTS)
        if (removed.length > 0) {
          memory.value.facts = kept
          touch()
          needsSave = true
        }
      }
      if (needsSave) save()
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e)
      loaded.value = false
      console.error('加载AI记忆数据失败:', e)
    }
  }

  async function backupRaw(json: string): Promise<void> {
    try {
      if (isTauri()) {
        await tauriInvoke('save_ai_memory_backup', { json })
      } else {
        localStorage.setItem(`${MEMORY_STORAGE_KEY}-backup`, json)
      }
    } catch (e) {
      console.warn('记忆备份失败（继续加载）:', e)
    }
  }

  /** 强制重新读取（loadError 后重试 / 外部修改后刷新） */
  async function reload(): Promise<void> {
    loaded.value = false
    loadError.value = null
    loadWarnings.value = []
    loadPromise = null
    await load()
  }

  /** 放弃损坏文件，以空记忆重新开始（用户在错误态明确确认后调用） */
  async function forceReset(): Promise<void> {
    memory.value = createEmptyMemory()
    loaded.value = true
    loadError.value = null
    loadWarnings.value = []
    bindLifecycle()
    await flushSave()
  }

  // ===================== 画像 =====================

  function updateProfile(patch: Partial<UserProfile>) {
    memory.value.profile = normalizeUserProfile({ ...memory.value.profile, ...patch })
    touch()
    save()
  }

  // ===================== 设置 =====================

  function updateMemorySettings(patch: Partial<MemorySettings>) {
    memory.value.settings = normalizeMemorySettings({ ...memory.value.settings, ...patch })
    touch()
    save()
  }

  // ===================== 事实 CRUD =====================

  function addFact(
    content: string,
    category: MemoryCategory = 'knowledge',
    tags: string[] = [],
    source: string = 'unknown',
    importance = 0.5,
    options: AddFactOptions = {},
  ): MemoryFact {
    const now = Date.now()
    const trimmed = (content ?? '').trim()
    if (!trimmed) throw new Error('记忆内容不能为空')

    if (memory.value.facts.length >= MAX_FACTS) {
      const { kept } = evictOverflow(memory.value.facts, MAX_FACTS - 1, now)
      memory.value.facts = kept
    }

    const fact: MemoryFact = {
      id: options.id ?? generateId(),
      category: normalizeCategory(category),
      content: trimmed.slice(0, MAX_FACT_CONTENT_LENGTH),
      tags: normalizeTagList(tags),
      source,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      confidence: 1,
      importance: normalizeImportance(importance),
      updatedAt: now,
      pinned: false,
      enabled: true,
      origin: options.origin ?? inferMemoryOrigin(source),
    }
    if (options.sourceConversationId) {
      fact.sourceConversationId = options.sourceConversationId
    }
    memory.value.facts.push(fact)
    touch()
    save()
    return fact
  }

  function updateFact(
    id: string,
    patch: Partial<Omit<MemoryFact, 'id' | 'createdAt'>>,
  ): MemoryFact | null {
    const index = memory.value.facts.findIndex((fact) => fact.id === id)
    if (index === -1) return null
    const current = memory.value.facts[index]
    const content = patch.content !== undefined ? String(patch.content).trim() : current.content
    if (!content) throw new Error('记忆内容不能为空')
    const next: MemoryFact = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      category: patch.category !== undefined ? normalizeCategory(patch.category) : current.category,
      content: content.slice(0, MAX_FACT_CONTENT_LENGTH),
      tags: patch.tags !== undefined ? normalizeTagList(patch.tags) : current.tags,
      importance:
        patch.importance !== undefined ? normalizeImportance(patch.importance) : current.importance,
      pinned: patch.pinned !== undefined ? patch.pinned === true : current.pinned === true,
      enabled: patch.enabled !== undefined ? patch.enabled !== false : current.enabled !== false,
      updatedAt: Date.now(),
    }
    memory.value.facts[index] = next
    touch()
    save()
    return next
  }

  function deleteFact(id: string) {
    const index = memory.value.facts.findIndex((fact) => fact.id === id)
    if (index === -1) return
    memory.value.facts.splice(index, 1)
    touch()
    save()
  }

  function deleteFacts(ids: string[]) {
    if (!ids.length) return
    const idSet = new Set(ids)
    const next = memory.value.facts.filter((fact) => !idSet.has(fact.id))
    if (next.length === memory.value.facts.length) return
    memory.value.facts = next
    touch()
    save()
  }

  /** 撤销删除：把之前删除的条目放回列表末尾 */
  function restoreFact(fact: MemoryFact) {
    if (memory.value.facts.some((item) => item.id === fact.id)) return
    if (memory.value.facts.length >= MAX_FACTS) {
      const { kept } = evictOverflow(memory.value.facts, MAX_FACTS - 1, Date.now())
      memory.value.facts = kept
    }
    memory.value.facts.push(fact)
    touch()
    save()
  }

  function togglePin(id: string) {
    const fact = memory.value.facts.find((item) => item.id === id)
    if (!fact) return
    updateFact(id, { pinned: !fact.pinned })
  }

  function toggleEnabled(id: string) {
    const fact = memory.value.facts.find((item) => item.id === id)
    if (!fact) return
    updateFact(id, { enabled: fact.enabled === false })
  }

  function getFact(id: string): MemoryFact | null {
    return memory.value.facts.find((fact) => fact.id === id) ?? null
  }

  function findSimilarFact(content: string): MemoryFact | null {
    return findDuplicateOf(memory.value.facts, content)
  }

  // ===================== 检索 / 访问统计 =====================

  function searchFacts(query: string, maxResults = 10): MemoryFact[] {
    return rankFacts(memory.value.facts, query, Date.now(), { maxResults })
  }

  /** 注入后记录访问，让「最近使用 / 访问次数」排序和衰减有意义 */
  function trackInjection(ids: string[]) {
    if (!ids.length) return
    const idSet = new Set(ids)
    const now = Date.now()
    let changed = false
    for (const fact of memory.value.facts) {
      if (!idSet.has(fact.id)) continue
      fact.accessCount += 1
      fact.lastAccessedAt = now
      changed = true
    }
    if (changed) {
      touch()
      save()
    }
  }

  // ===================== 清理 / 去重 =====================

  function previewCleanup(): number {
    return cleanupFacts(memory.value.facts, Date.now(), MAX_FACTS).removed.length
  }

  function cleanup(): number {
    const { kept, removed } = cleanupFacts(memory.value.facts, Date.now(), MAX_FACTS)
    if (removed.length === 0) return 0
    memory.value.facts = kept
    touch()
    save()
    return removed.length
  }

  function findDuplicates(): DuplicateGroup[] {
    return findDuplicateGroups(memory.value.facts)
  }

  function mergeDuplicates(): number {
    const groups = findDuplicateGroups(memory.value.facts)
    if (groups.length === 0) return 0
    const facts = [...memory.value.facts]
    let mergedCount = 0
    for (const group of groups) {
      const merged = mergeFactGroup(group.facts)
      const removeIds = new Set(group.duplicateIds)
      const keepIndex = facts.findIndex((fact) => fact.id === group.keepId)
      if (keepIndex !== -1) facts[keepIndex] = merged
      for (let i = facts.length - 1; i >= 0; i--) {
        if (removeIds.has(facts[i].id)) facts.splice(i, 1)
      }
      mergedCount += group.duplicateIds.length
    }
    memory.value.facts = facts
    touch()
    save()
    return mergedCount
  }

  // ===================== 清空 =====================

  function clearFacts() {
    if (memory.value.facts.length === 0) return
    memory.value.facts = []
    touch()
    save()
  }

  function clearProfile() {
    memory.value.profile = {}
    touch()
    save()
  }

  /** 清空画像 + 全部事实，但保留用户的记忆设置 */
  function clearAll() {
    memory.value.profile = {}
    memory.value.facts = []
    touch()
    save()
  }

  // ===================== 导入 / 导出 =====================

  function exportMemory(): MemoryExport {
    return createMemoryExport({
      ...memory.value,
      profile: { ...memory.value.profile },
      facts: memory.value.facts.map((fact) => ({ ...fact, tags: [...fact.tags] })),
      settings: { ...memory.value.settings },
    })
  }

  async function importMemory(
    raw: unknown,
    mode: 'merge' | 'replace' = 'merge',
  ): Promise<ImportMemoryResult> {
    if (!loaded.value) await load()
    if (!loaded.value) {
      throw new Error('记忆尚未加载成功，请先重试或重置后再导入')
    }
    const parsed = parseMemoryExport(raw, { now: Date.now(), idFactory: generateId })

    if (mode === 'replace') {
      await backupMemory()
      memory.value = {
        ...parsed.memory,
        facts: parsed.memory.facts,
        settings: normalizeMemorySettings(parsed.memory.settings),
      }
      touch()
      await flushSave()
      return {
        mode,
        added: parsed.memory.facts.length,
        updated: 0,
        skipped: 0,
        total: parsed.memory.facts.length,
      }
    }

    let added = 0
    let updated = 0
    let skipped = 0
    memory.value.profile = normalizeUserProfile({
      ...memory.value.profile,
      ...parsed.memory.profile,
    })

    for (const incoming of parsed.memory.facts) {
      const byId = memory.value.facts.find((fact) => fact.id === incoming.id)
      if (byId) {
        byId.importance = Math.max(byId.importance, incoming.importance)
        byId.tags = normalizeTagList([...byId.tags, ...incoming.tags])
        byId.updatedAt = Math.max(
          byId.updatedAt ?? byId.createdAt,
          incoming.updatedAt ?? incoming.createdAt,
        )
        byId.pinned = byId.pinned === true || incoming.pinned === true
        updated++
        continue
      }
      if (findDuplicateOf(memory.value.facts, incoming.content)) {
        skipped++
        continue
      }
      memory.value.facts.push(incoming)
      added++
    }

    const overflow = evictOverflow(memory.value.facts, MAX_FACTS, Date.now())
    if (overflow.removed.length > 0) memory.value.facts = overflow.kept

    touch()
    await flushSave()
    return {
      mode,
      added,
      updated,
      skipped,
      total: parsed.memory.facts.length,
    }
  }

  return {
    // state
    memory,
    profile,
    facts,
    settings,
    enabled,
    stats,
    loaded,
    loadError,
    loadWarnings,
    // lifecycle
    load,
    reload,
    forceReset,
    backupMemory,
    // profile / settings
    updateProfile,
    updateMemorySettings,
    // facts
    addFact,
    updateFact,
    deleteFact,
    deleteFacts,
    restoreFact,
    togglePin,
    toggleEnabled,
    getFact,
    findSimilarFact,
    searchFacts,
    trackInjection,
    // cleanup / dedupe
    previewCleanup,
    cleanup,
    findDuplicates,
    mergeDuplicates,
    // clear
    clearFacts,
    clearProfile,
    clearAll,
    // import / export
    exportMemory,
    importMemory,
    // persistence
    save,
    flushSave,
  }
})
