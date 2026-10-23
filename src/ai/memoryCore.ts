/**
 * AI 记忆纯函数层
 *
 * 负责：数据校验与迁移、检索排序、清理与容量淘汰、去重合并、导入导出、
 * 启发式抽取、时间/来源格式化。
 *
 * 约束：本文件不依赖 Vue / Pinia / localStorage / Tauri，便于被
 * scripts/ai-render-tests 直接单测；store 只做状态与持久化编排。
 */

import type {
  GlobalMemory,
  MemoryCategory,
  MemoryExport,
  MemoryFact,
  MemoryOrigin,
  MemorySettings,
  UserProfile,
} from './types'
import { DEFAULT_MEMORY_SETTINGS, MEMORY_CATEGORY_LABELS, MEMORY_VERSION } from './types'

/** 事实总数上限（超出时按价值淘汰，置顶项受保护） */
export const MAX_FACTS = 200
/** 时间衰减半衰期基准（天） */
export const DECAY_THRESHOLD_DAYS = 90
/** 单条事实注入/写入的最大长度 */
export const MAX_FACT_CONTENT_LENGTH = 500
/** 默认每次注入条数 / 单条注入长度 */
export const DEFAULT_MAX_INJECT_FACTS = 5
export const DEFAULT_MAX_FACT_CHARS = 500
/** 去重判定阈值（0-1，规范化文本相似度） */
export const DUPLICATE_SIMILARITY = 0.72
/** 导出信封标识 */
export const MEMORY_EXPORT_FORMAT = 'unidoc-ai-memory' as const
export const MEMORY_EXPORT_FORMAT_VERSION = 1

const DAY_MS = 86_400_000
const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g
const LATIN_WORD_RE = /[a-z0-9][a-z0-9.+#_]*[a-z0-9+#]|[a-z0-9]{2,}/g
const QUERY_SEPARATOR_RE = /[\s,.;:!?，。；：！？、"'“”‘’()（）[\]【】<>《》/\\|~`@#$%^&*+={}\-_]+/
const NORMALIZE_STRIP_RE = /[\s.,;:!?'"`~@#$%^&*()+={}[\]<>《》【】、，。；：！？·…—\-_/\\|]/g

const MEMORY_CATEGORIES: MemoryCategory[] = [
  'personal',
  'project',
  'knowledge',
  'preference',
  'other',
]

// ===================== 基础工具 =====================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = isFiniteNumber(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

function asTrimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

function asTagList(value: unknown, maxItems = 20, maxItemLength = 60): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const tag = asTrimmedString(item, maxItemLength)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= maxItems) break
  }
  return out
}

/** 规范化标签列表（去空、去重、截断），供 store/UI 复用 */
export function normalizeTagList(value: unknown, maxItems = 20, maxItemLength = 60): string[] {
  return asTagList(value, maxItems, maxItemLength)
}

// ===================== 校验与迁移 =====================

export function normalizeMemorySettings(raw: unknown): MemorySettings {
  const record = isRecord(raw) ? raw : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_MEMORY_SETTINGS.enabled,
    autoExtract:
      typeof record.autoExtract === 'boolean'
        ? record.autoExtract
        : DEFAULT_MEMORY_SETTINGS.autoExtract,
    maxInjectFacts: Math.round(clampNumber(record.maxInjectFacts, 1, 10, DEFAULT_MAX_INJECT_FACTS)),
    maxFactChars: Math.round(clampNumber(record.maxFactChars, 100, 2000, DEFAULT_MAX_FACT_CHARS)),
    autoCleanup:
      typeof record.autoCleanup === 'boolean'
        ? record.autoCleanup
        : DEFAULT_MEMORY_SETTINGS.autoCleanup,
  }
}

export function normalizeUserProfile(raw: unknown): UserProfile {
  const record = isRecord(raw) ? raw : {}
  const profile: UserProfile = {}
  const name = asTrimmedString(record.name, 60)
  if (name) profile.name = name
  const aliases = asTagList(record.aliases, 10, 30)
  if (aliases.length) profile.aliases = aliases
  const writingStyle = asTrimmedString(record.writingStyle, 300)
  if (writingStyle) profile.writingStyle = writingStyle
  const formatPreferences = asTagList(record.formatPreferences, 20, 40)
  if (formatPreferences.length) profile.formatPreferences = formatPreferences
  const themes = asTagList(record.themes, 20, 40)
  if (themes.length) profile.themes = themes
  const techStack = asTagList(record.techStack, 20, 40)
  if (techStack.length) profile.techStack = techStack
  const notes = asTrimmedString(record.notes, 1000)
  if (notes) profile.notes = notes
  return profile
}

export type NormalizedCategory = MemoryCategory

export function normalizeCategory(raw: unknown): MemoryCategory {
  return MEMORY_CATEGORIES.includes(raw as MemoryCategory) ? (raw as MemoryCategory) : 'knowledge'
}

export function normalizeImportance(raw: unknown): number {
  return Math.min(1, Math.max(0, isFiniteNumber(raw) ? raw : 0.5))
}

export function inferMemoryOrigin(source: unknown): MemoryOrigin {
  switch (typeof source === 'string' ? source.trim() : '') {
    case 'manual':
      return 'manual'
    case 'auto-extract':
      return 'auto-extract'
    case 'import':
      return 'import'
    case 'agent':
    default:
      return 'agent'
  }
}

export interface MemoryNormalizeOptions {
  /** 当前时间（测试可注入） */
  now?: number
  /** 生成缺失/重复 id（测试可注入） */
  idFactory?: () => string
}

export interface MemoryNormalizeResult {
  memory: GlobalMemory
  /** 是否发生了 v1 → v2 迁移 */
  migrated: boolean
  warnings: string[]
  /** 因内容为空/格式非法被丢弃的条目数 */
  dropped: number
}

export function normalizeMemoryFact(
  raw: unknown,
  options: MemoryNormalizeOptions = {},
  usedIds?: Set<string>,
): MemoryFact | null {
  if (!isRecord(raw)) return null
  const now = options.now ?? Date.now()
  const idFactory = options.idFactory ?? (() => `mem-${Math.random().toString(36).slice(2, 10)}`)
  const content = typeof raw.content === 'string' ? raw.content.trim() : ''
  if (!content) return null

  let id = asTrimmedString(raw.id, 80) ?? ''
  if (!id || (usedIds && usedIds.has(id))) id = idFactory()

  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : now
  const updatedAt = isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt
  const lastAccessedAt = isFiniteNumber(raw.lastAccessedAt) ? raw.lastAccessedAt : createdAt
  const source = asTrimmedString(raw.source, 40) ?? 'agent'
  const origin = inferMemoryOrigin(raw.origin ?? source)

  const fact: MemoryFact = {
    ...(raw as Record<string, unknown>),
    id,
    category: normalizeCategory(raw.category),
    content: content.slice(0, MAX_FACT_CONTENT_LENGTH),
    tags: asTagList(raw.tags),
    source,
    createdAt,
    lastAccessedAt,
    accessCount: Math.max(0, Math.round(isFiniteNumber(raw.accessCount) ? raw.accessCount : 0)),
    confidence: clampNumber(raw.confidence, 0, 1, 1),
    importance: normalizeImportance(raw.importance),
    updatedAt,
    pinned: raw.pinned === true,
    enabled: raw.enabled !== false,
    origin,
  }
  const conversationId = asTrimmedString(raw.sourceConversationId, 80)
  if (conversationId) fact.sourceConversationId = conversationId
  return fact
}

export function normalizeMemory(
  raw: unknown,
  options: MemoryNormalizeOptions = {},
): MemoryNormalizeResult {
  if (!isRecord(raw)) {
    throw new Error('记忆数据格式无效：期望 JSON 对象')
  }
  const warnings: string[] = []
  const version = isFiniteNumber(raw.version) ? raw.version : 1
  if (version > MEMORY_VERSION) {
    warnings.push(`记忆数据版本 v${version} 高于当前应用支持的 v${MEMORY_VERSION}，已尽力兼容`)
  }
  const migrated = version < MEMORY_VERSION

  let dropped = 0
  const rawFacts = Array.isArray(raw.facts) ? raw.facts : []
  if (raw.facts !== undefined && !Array.isArray(raw.facts)) {
    warnings.push('facts 字段不是数组，已忽略')
  }
  const usedIds = new Set<string>()
  const facts: MemoryFact[] = []
  for (const rawFact of rawFacts) {
    const fact = normalizeMemoryFact(rawFact, options, usedIds)
    if (!fact) {
      dropped++
      continue
    }
    usedIds.add(fact.id)
    facts.push(fact)
  }

  const memory: GlobalMemory = {
    version: MEMORY_VERSION,
    profile: normalizeUserProfile(raw.profile),
    facts,
    settings: normalizeMemorySettings(raw.settings),
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : 0,
  }
  return { memory, migrated, warnings, dropped }
}

// ===================== 检索与排序 =====================

/**
 * 分词：拉丁词按分隔符切分；中文按二元组（bigram）切分。
 * 现有的按空格切分对中文完全失效，这里改为确定性 CJK bigram。
 */
export function tokenizeQuery(query: string): string[] {
  const text = (query ?? '').toLowerCase().trim()
  if (!text) return []
  const tokens = new Set<string>()
  for (const part of text.split(QUERY_SEPARATOR_RE)) {
    if (!part) continue
    const latinWords = part.match(LATIN_WORD_RE) ?? []
    for (const word of latinWords) {
      if (word.length > 1) tokens.add(word)
    }
    const cjkRuns = part.match(CJK_RUN_RE) ?? []
    for (const run of cjkRuns) {
      if (run.length === 1) continue
      if (run.length === 2) {
        tokens.add(run)
        continue
      }
      for (let i = 0; i + 2 <= run.length; i++) {
        tokens.add(run.slice(i, i + 2))
      }
    }
  }
  return [...tokens].slice(0, 48)
}

export function scoreFact(fact: MemoryFact, keywords: string[], now: number): number {
  const contentLower = (fact.content ?? '').toLowerCase()
  const tagsLower = (fact.tags ?? []).map((tag) => tag.toLowerCase())
  let keywordScore = 0
  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) keywordScore += 3
    if (tagsLower.some((tag) => tag.includes(keyword))) keywordScore += 5
  }
  if (keywordScore > 0) {
    const daysSinceAccess = Math.max(0, (now - fact.lastAccessedAt) / DAY_MS)
    keywordScore *= Math.exp(-daysSinceAccess / DECAY_THRESHOLD_DAYS)
  }
  let score = keywordScore + fact.importance * 2 + Math.min(fact.accessCount * 0.1, 2)
  if (fact.pinned) score += 5
  return score
}

export interface RankFactsOptions {
  maxResults?: number
}

/** 统一排序：关键词命中 × 时间衰减 + 重要度 + 访问次数 + 置顶加成；过滤停用项 */
export function rankFacts(
  facts: MemoryFact[],
  query: string,
  now = Date.now(),
  options: RankFactsOptions = {},
): MemoryFact[] {
  const keywords = tokenizeQuery(query)
  const visible = facts.filter((fact) => fact.enabled !== false)
  const scored = visible.map((fact) => ({
    fact,
    score:
      keywords.length > 0
        ? scoreFact(fact, keywords, now)
        : fact.importance + (fact.pinned ? 2 : 0) + Math.min(fact.accessCount * 0.1, 1),
  }))
  scored.sort((a, b) => b.score - a.score || b.fact.createdAt - a.fact.createdAt)
  const limit = options.maxResults ?? scored.length
  return scored.slice(0, Math.max(0, limit)).map((item) => item.fact)
}

// ===================== 清理与容量 =====================

export interface CleanupResult {
  kept: MemoryFact[]
  removed: MemoryFact[]
}

function factKeepScore(fact: MemoryFact, now: number): number {
  const ageDays = Math.max(0, (now - fact.createdAt) / DAY_MS)
  return (
    fact.importance +
    Math.min(fact.accessCount * 0.1, 1) -
    ageDays / 365 +
    (fact.pinned ? 100 : 0) -
    (fact.enabled === false ? 10 : 0)
  )
}

/** 清理低价值记忆；pinned 永不删除。返回被删除清单供 UI 预览 */
export function cleanupFacts(
  facts: MemoryFact[],
  now = Date.now(),
  maxFacts = MAX_FACTS,
): CleanupResult {
  const oneYear = 365 * DAY_MS
  const removed: MemoryFact[] = []
  let kept = facts.filter((fact) => {
    if (fact.pinned) return true
    const age = now - fact.createdAt
    const daysSinceAccess = (now - fact.lastAccessedAt) / DAY_MS
    if (age > oneYear && fact.importance < 0.3 && fact.accessCount === 0) {
      removed.push(fact)
      return false
    }
    if (daysSinceAccess > DECAY_THRESHOLD_DAYS * 2 && fact.importance < 0.2) {
      removed.push(fact)
      return false
    }
    return true
  })

  if (kept.length > maxFacts) {
    const removable = kept
      .filter((fact) => !fact.pinned)
      .sort((a, b) => factKeepScore(a, now) - factKeepScore(b, now))
    const dropCount = Math.min(removable.length, kept.length - maxFacts)
    const dropIds = new Set(removable.slice(0, dropCount).map((fact) => fact.id))
    removed.push(...kept.filter((fact) => dropIds.has(fact.id)))
    kept = kept.filter((fact) => !dropIds.has(fact.id))
  }
  return { kept, removed }
}

/** 仅做容量淘汰（新增记忆前腾出空间），不执行时间规则 */
export function evictOverflow(
  facts: MemoryFact[],
  maxFacts = MAX_FACTS,
  now = Date.now(),
): CleanupResult {
  if (facts.length <= maxFacts) return { kept: [...facts], removed: [] }
  const removable = facts
    .filter((fact) => !fact.pinned)
    .sort((a, b) => factKeepScore(a, now) - factKeepScore(b, now))
  const dropCount = Math.min(removable.length, facts.length - maxFacts)
  const dropIds = new Set(removable.slice(0, dropCount).map((fact) => fact.id))
  return {
    kept: facts.filter((fact) => !dropIds.has(fact.id)),
    removed: facts.filter((fact) => dropIds.has(fact.id)),
  }
}

// ===================== 去重与合并 =====================

/** 规范化文本：小写 + 去掉空白与中英文标点，用于比较 */
export function normalizeFactText(text: string): string {
  return (text ?? '').toLowerCase().replace(NORMALIZE_STRIP_RE, '')
}

function bigramSet(text: string): Set<string> {
  const set = new Set<string>()
  if (text.length <= 2) {
    if (text) set.add(text)
    return set
  }
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2))
  return set
}

/** 文本相似度（0-1）：完全相等 1；包含关系按长度比；否则 bigram Jaccard */
export function textSimilarity(a: string, b: string): number {
  const left = normalizeFactText(a)
  const right = normalizeFactText(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) {
    // 包含关系（如「喜欢Vue」与「喜欢Vue，常用Vue3」）按重复处理，避免扩充内容后反复入库
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length)
    return Math.max(ratio, 0.8)
  }
  const leftGrams = bigramSet(left)
  const rightGrams = bigramSet(right)
  let intersection = 0
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) intersection++
  }
  const union = leftGrams.size + rightGrams.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** 找到与 content 重复的第一条记忆（用于保存前查重） */
export function findDuplicateOf(facts: MemoryFact[], content: string): MemoryFact | null {
  if (!normalizeFactText(content)) return null
  for (const fact of facts) {
    if (textSimilarity(content, fact.content) >= DUPLICATE_SIMILARITY) return fact
  }
  return null
}

export interface DuplicateGroup {
  /** 合并后保留的条目 id */
  keepId: string
  /** 将被合并掉的条目 id */
  duplicateIds: string[]
  facts: MemoryFact[]
}

function pickKeepFact(group: MemoryFact[]): MemoryFact {
  const sorted = [...group].sort((a, b) => {
    const pinnedDiff = Number(b.pinned === true) - Number(a.pinned === true)
    if (pinnedDiff !== 0) return pinnedDiff
    if (b.importance !== a.importance) return b.importance - a.importance
    if (b.content.length !== a.content.length) return b.content.length - a.content.length
    return a.createdAt - b.createdAt
  })
  return sorted[0]
}

export function findDuplicateGroups(
  facts: MemoryFact[],
  threshold = DUPLICATE_SIMILARITY,
): DuplicateGroup[] {
  const assigned = new Set<string>()
  const groups: DuplicateGroup[] = []
  for (let i = 0; i < facts.length; i++) {
    const head = facts[i]
    if (assigned.has(head.id)) continue
    const group = [head]
    for (let j = i + 1; j < facts.length; j++) {
      const other = facts[j]
      if (assigned.has(other.id)) continue
      if (textSimilarity(head.content, other.content) >= threshold) {
        group.push(other)
        assigned.add(other.id)
      }
    }
    if (group.length > 1) {
      assigned.add(head.id)
      const keep = pickKeepFact(group)
      groups.push({
        keepId: keep.id,
        duplicateIds: group.filter((fact) => fact.id !== keep.id).map((fact) => fact.id),
        facts: group,
      })
    }
  }
  return groups
}

const ORIGIN_PRIORITY: Record<MemoryOrigin, number> = {
  manual: 4,
  agent: 3,
  'auto-extract': 2,
  import: 1,
}

/** 把一组重复记忆合并成一条（保留信息最全的内容、标签并集、最大重要度等） */
export function mergeFactGroup(group: MemoryFact[]): MemoryFact {
  if (group.length === 0) throw new Error('mergeFactGroup 需要至少一条记忆')
  const keep = pickKeepFact(group)
  const longest = [...group].sort((a, b) => b.content.trim().length - a.content.trim().length)[0]
  const tags: string[] = []
  const seenTags = new Set<string>()
  for (const fact of group) {
    for (const tag of fact.tags ?? []) {
      const key = tag.toLowerCase()
      if (seenTags.has(key)) continue
      seenTags.add(key)
      tags.push(tag)
    }
  }
  const origin = group
    .map((fact) => fact.origin ?? inferMemoryOrigin(fact.source))
    .sort((a, b) => ORIGIN_PRIORITY[b] - ORIGIN_PRIORITY[a])[0]
  return {
    ...keep,
    content: longest.content.trim(),
    tags: tags.slice(0, 20),
    importance: Math.max(...group.map((fact) => fact.importance)),
    confidence: Math.max(...group.map((fact) => fact.confidence ?? 1)),
    accessCount: group.reduce((sum, fact) => sum + (fact.accessCount ?? 0), 0),
    pinned: group.some((fact) => fact.pinned === true),
    enabled: group.some((fact) => fact.enabled !== false),
    createdAt: Math.min(...group.map((fact) => fact.createdAt)),
    updatedAt: Math.max(...group.map((fact) => fact.updatedAt ?? fact.createdAt)),
    lastAccessedAt: Math.max(...group.map((fact) => fact.lastAccessedAt)),
    origin,
  }
}

// ===================== 导入 / 导出 =====================

export function createMemoryExport(memory: GlobalMemory, now = Date.now()): MemoryExport {
  return {
    format: MEMORY_EXPORT_FORMAT,
    formatVersion: MEMORY_EXPORT_FORMAT_VERSION,
    exportedAt: now,
    memory,
  }
}

export interface ParseMemoryExportResult {
  memory: GlobalMemory
  wasEnvelope: boolean
}

/** 解析导出文件：支持带信封的新格式，也兼容直接导出的 GlobalMemory JSON */
export function parseMemoryExport(
  raw: unknown,
  options: MemoryNormalizeOptions = {},
): ParseMemoryExportResult {
  if (!isRecord(raw)) throw new Error('导入文件格式无效：期望 JSON 对象')
  if (isRecord(raw.memory)) {
    if (raw.format !== undefined && raw.format !== MEMORY_EXPORT_FORMAT) {
      throw new Error('不是 UniDoc 记忆导出文件（format 不匹配）')
    }
    if (!isFiniteNumber(raw.formatVersion)) {
      throw new Error('导入文件缺少 formatVersion')
    }
    if (raw.formatVersion > MEMORY_EXPORT_FORMAT_VERSION) {
      throw new Error('导入文件版本过高，请先升级应用')
    }
    return {
      memory: normalizeMemory(raw.memory, options).memory,
      wasEnvelope: true,
    }
  }
  return {
    memory: normalizeMemory(raw, options).memory,
    wasEnvelope: false,
  }
}

// ===================== 启发式抽取（自动提取降级方案） =====================

/** 自动提取产生的一条候选事实（尚未写入 store） */
export interface MemoryCandidate {
  content: string
  category: MemoryCategory
  tags: string[]
  tag: string
}

export interface MemoryExtractionResult {
  profile: Partial<UserProfile> | null
  candidates: MemoryCandidate[]
}

const PROFILE_NAME_RE =
  /(?:我叫|我的名字是|我的名字叫)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_-]{1,11})/
const PROFILE_ALIAS_RE =
  /(?:你可以叫我|就叫我|以后叫我|叫我)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_-]{1,11})/

/** 从最近几条用户消息中保守提取画像（不再把「我是…」当作姓名） */
export function extractProfileCandidates(userMessages: string[]): Partial<UserProfile> | null {
  const recent = userMessages.slice(-5).join(' ')
  const updates: Partial<UserProfile> = {}
  const nameMatch = recent.match(PROFILE_NAME_RE)
  if (nameMatch) updates.name = nameMatch[1]
  const aliasMatch = recent.match(PROFILE_ALIAS_RE)
  if (aliasMatch) updates.aliases = [aliasMatch[1]]
  return Object.keys(updates).length > 0 ? updates : null
}

const HEURISTIC_RULES: Array<{
  category: MemoryCategory
  tag: string
  pattern: RegExp
}> = [
  {
    category: 'preference',
    tag: '偏好',
    pattern: /我(?:很|比较|更|最|特别)?(?:喜欢|偏好|习惯|常用|爱用)([^\n，。,.!?！？；;：:]{2,20})/,
  },
  {
    category: 'project',
    tag: '项目',
    pattern:
      /(?:我的|我们的|这个|当前的)?项目(?:是|叫|叫做|名称是|：|:)\s*([^\n，。,.!?！？；;]{2,30})/,
  },
  {
    category: 'knowledge',
    tag: '技术',
    pattern: /(?:我的)?技术栈(?:是|：|:)\s*([^\n，。,.!?！？；;]{2,40})/,
  },
  {
    category: 'knowledge',
    tag: '决定',
    pattern: /(?:以后|今后|从此)(?:都|就|一律)[^\n，。,.!?！？；;]{2,30}/,
  },
]

/** 从最近几条用户消息中启发式提取候选事实（写库前由 store 统一查重） */
export function extractHeuristicCandidates(userMessages: string[]): MemoryExtractionResult {
  const recent = userMessages.slice(-3).join(' ')
  const candidates: MemoryCandidate[] = []
  const seen = new Set<string>()
  for (const rule of HEURISTIC_RULES) {
    const match = recent.match(rule.pattern)
    if (!match) continue
    const content = (match[0] ?? '').trim().slice(0, MAX_FACT_CONTENT_LENGTH)
    const key = normalizeFactText(content)
    if (!key || seen.has(key)) continue
    seen.add(key)
    candidates.push({
      content,
      category: rule.category,
      tags: [rule.tag],
      tag: rule.tag,
    })
    if (candidates.length >= 5) break
  }
  return { profile: extractProfileCandidates(userMessages), candidates }
}

// ===================== 展示辅助 =====================

export function memoryOriginLabel(fact: Pick<MemoryFact, 'origin' | 'source'>): string {
  const origin = fact.origin ?? inferMemoryOrigin(fact.source)
  switch (origin) {
    case 'manual':
      return '手动添加'
    case 'auto-extract':
      return '对话自动提取'
    case 'import':
      return '导入'
    case 'agent':
    default:
      return 'AI 主动记住'
  }
}

export function memoryCategoryLabel(category: string): string {
  return MEMORY_CATEGORY_LABELS[category as MemoryCategory] ?? category
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp || timestamp <= 0) return '从未'
  const diff = Math.max(0, now - timestamp)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < DAY_MS * 30) return `${Math.floor(diff / DAY_MS)} 天前`
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
