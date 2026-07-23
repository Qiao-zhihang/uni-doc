/**
 * AI 全局记忆 Store
 * 管理用户画像、事实知识库
 * 持久化到 ~/.unidoc/ai_memory.json (Tauri) 或 localStorage (Web)
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isTauri } from '@/core/serializer/markdownFile'
import type { UserProfile, MemoryFact, MemoryCategory, GlobalMemory } from '@/ai/types'
import { DEFAULT_MEMORY } from '@/ai/types'

const STORAGE_KEY = 'unidoc-ai-memory'

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

const DECAY_THRESHOLD_DAYS = 90
const MAX_FACTS = 200

export const useAiMemoryStore = defineStore('aiMemory', () => {
  const memory = ref<GlobalMemory>({ ...DEFAULT_MEMORY, facts: [], profile: {} })
  const loaded = ref(false)

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const profile = computed(() => memory.value.profile)
  const facts = computed(() => memory.value.facts)

  function updateProfile(patch: Partial<UserProfile>) {
    memory.value.profile = { ...memory.value.profile, ...patch }
    memory.value.updatedAt = Date.now()
    save()
  }

  function addFact(
    content: string,
    category: MemoryCategory = 'knowledge',
    tags: string[] = [],
    source: string = 'unknown',
    importance: number = 0.5
  ): MemoryFact {
    const now = Date.now()
    const fact: MemoryFact = {
      id: crypto.randomUUID(),
      category,
      content,
      tags,
      source,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      confidence: 1,
      importance: Math.max(0, Math.min(1, importance)),
    }
    memory.value.facts.push(fact)
    memory.value.updatedAt = now
    save()
    return fact
  }

  function updateFact(id: string, patch: Partial<Omit<MemoryFact, 'id' | 'createdAt'>>) {
    const idx = memory.value.facts.findIndex((f) => f.id === id)
    if (idx === -1) return
    memory.value.facts[idx] = { ...memory.value.facts[idx], ...patch }
    memory.value.updatedAt = Date.now()
    save()
  }

  function deleteFact(id: string) {
    const idx = memory.value.facts.findIndex((f) => f.id === id)
    if (idx === -1) return
    memory.value.facts.splice(idx, 1)
    memory.value.updatedAt = Date.now()
    save()
  }

  function getFact(id: string): MemoryFact | null {
    const f = memory.value.facts.find((x) => x.id === id)
    if (!f) return null
    f.lastAccessedAt = Date.now()
    f.accessCount++
    return f
  }

  function searchFacts(query: string, maxResults: number = 10): MemoryFact[] {
    const now = Date.now()
    const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 1)
    if (keywords.length === 0) {
      return [...memory.value.facts]
        .sort((a, b) => b.importance * 0.5 + b.accessCount * 0.1 - (a.importance * 0.5 + a.accessCount * 0.1))
        .slice(0, maxResults)
    }

    const scored = memory.value.facts.map((fact) => {
      const contentLower = fact.content.toLowerCase()
      const tagsLower = fact.tags.map((t) => t.toLowerCase())
      let score = 0
      for (const kw of keywords) {
        if (contentLower.includes(kw)) score += 3
        if (tagsLower.some((t) => t.includes(kw))) score += 5
      }
      const daysSinceAccess = (now - fact.lastAccessedAt) / (1000 * 60 * 60 * 24)
      const decay = Math.exp(-daysSinceAccess / DECAY_THRESHOLD_DAYS)
      score *= decay
      score += fact.importance * 2
      score += Math.min(fact.accessCount * 0.1, 2)
      return { fact, score }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, maxResults).map((s) => s.fact)
  }

  function cleanup() {
    const now = Date.now()
    const oneYear = 365 * 24 * 60 * 60 * 1000
    const before = memory.value.facts.length

    memory.value.facts = memory.value.facts.filter((f) => {
      const age = now - f.createdAt
      const notImportant = f.importance < 0.3
      const neverAccessed = f.accessCount === 0
      const tooOld = age > oneYear
      if (tooOld && notImportant && neverAccessed) return false

      const daysSinceAccess = (now - f.lastAccessedAt) / (1000 * 60 * 60 * 24)
      if (daysSinceAccess > DECAY_THRESHOLD_DAYS * 2 && f.importance < 0.2) return false
      return true
    })

    if (memory.value.facts.length > MAX_FACTS) {
      memory.value.facts.sort((a, b) => {
        const scoreA = a.importance + Math.min(a.accessCount * 0.1, 1) - (now - a.lastAccessedAt) / (1000 * 60 * 60 * 24 * 365)
        const scoreB = b.importance + Math.min(b.accessCount * 0.1, 1) - (now - b.lastAccessedAt) / (1000 * 60 * 60 * 24 * 365)
        return scoreA - scoreB
      })
      const excess = memory.value.facts.length - MAX_FACTS
      memory.value.facts = memory.value.facts.slice(excess)
    }

    const removed = before - memory.value.facts.length
    if (removed > 0) {
      memory.value.updatedAt = now
      save()
    }
    return removed
  }

  function clearAll() {
    memory.value = { ...DEFAULT_MEMORY, facts: [], profile: {} }
    save()
  }

  function save() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(async () => {
      saveTimer = null
      try {
        const json = JSON.stringify(memory.value)
        if (isTauri()) {
          await tauriInvoke('save_ai_memory', { json })
        } else {
          localStorage.setItem(STORAGE_KEY, json)
        }
      } catch (e) {
        console.error('保存AI记忆数据失败:', e)
      }
    }, 500)
  }

  async function flushSave() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      const json = JSON.stringify(memory.value)
      if (isTauri()) {
        await tauriInvoke('save_ai_memory', { json })
      } else {
        localStorage.setItem(STORAGE_KEY, json)
      }
    } catch (e) {
      console.error('保存AI记忆数据失败:', e)
    }
  }

  async function load() {
    try {
      let json: string | null = null
      if (isTauri()) {
        const raw = await tauriInvoke<string>('load_ai_memory')
        json = raw && raw.length > 0 ? raw : null
      } else {
        json = localStorage.getItem(STORAGE_KEY)
      }

      if (json) {
        const parsed = JSON.parse(json) as GlobalMemory
        memory.value = {
          version: parsed.version ?? 1,
          profile: parsed.profile ?? {},
          facts: (parsed.facts ?? []).filter((f) => f && f.content).map((f) => ({
            ...f,
            lastAccessedAt: f.lastAccessedAt ?? f.createdAt ?? Date.now(),
            accessCount: f.accessCount ?? 0,
            confidence: f.confidence ?? 1,
            importance: f.importance ?? 0.5,
          })),
          updatedAt: parsed.updatedAt ?? 0,
        }
        cleanup()
      }
    } catch (e) {
      console.error('加载AI记忆数据失败:', e)
      memory.value = { ...DEFAULT_MEMORY, facts: [], profile: {} }
    } finally {
      loaded.value = true
    }
  }

  return {
    memory,
    profile,
    facts,
    loaded,
    updateProfile,
    addFact,
    updateFact,
    deleteFact,
    getFact,
    searchFacts,
    cleanup,
    clearAll,
    save,
    flushSave,
    load,
  }
})
