/**
 * AI 记忆引擎
 * 负责：记忆注入构建、启发式抽取、检索结果格式化
 *
 * 纯逻辑（排序/校验/迁移等）在 @/ai/memoryCore，本文件负责读取 store 并拼装 AI 可读文本。
 */

import type { UserProfile, MemoryFact, MemoryCategory } from './types'
import { MEMORY_CATEGORY_LABELS } from './types'
import { useAiMemoryStore } from '@/stores/aiMemory'
import { extractProfileCandidates, inferMemoryOrigin, memoryCategoryLabel } from './memoryCore'

/** 画像单个字段拼接时的最大长度，防止手工编辑出超长提示词 */
const MAX_PROFILE_VALUE_LENGTH = 300

/** 记忆总开关是否开启（注入 / 工具 / 自动提取统一受控；未成功加载时同样视为不可用） */
export function isMemoryEnabled(): boolean {
  const memoryStore = useAiMemoryStore()
  return memoryStore.loaded && memoryStore.settings.enabled !== false
}

/**
 * 构建注入到 system prompt 的记忆文本（画像 + 相关事实）。
 * 关闭记忆或没有可注入内容时返回空字符串。
 */
export function buildMemoryInject(userInput: string): string {
  const memoryStore = useAiMemoryStore()
  if (!memoryStore.loaded || memoryStore.settings.enabled === false) return ''

  const lines: string[] = []

  const profileSection = buildProfileSection(memoryStore.profile)
  if (profileSection) {
    lines.push('# 用户画像')
    lines.push(profileSection)
    lines.push('')
  }

  const maxResults = memoryStore.settings.maxInjectFacts
  const maxChars = memoryStore.settings.maxFactChars
  const relevantFacts = memoryStore.searchFacts(userInput, maxResults)
  if (relevantFacts.length > 0) {
    lines.push('# 相关记忆')
    relevantFacts.forEach((fact, index) => {
      const label = memoryCategoryLabel(fact.category)
      const truncated =
        fact.content.length > maxChars ? `${fact.content.slice(0, maxChars)}…` : fact.content
      const pinned = fact.pinned ? '（置顶）' : ''
      lines.push(`${index + 1}. [${label}]${pinned} ${truncated}`)
    })
    lines.push('')
    // 记录访问，让「最近使用 / 访问次数」排序与时间衰减真正生效
    memoryStore.trackInjection(relevantFacts.map((fact) => fact.id))
  }

  return lines.join('\n')
}

/** 把用户画像渲染为固定顺序的文本行 */
function buildProfileSection(profile: UserProfile): string {
  const parts: string[] = []
  const push = (label: string, value: string) => {
    parts.push(`${label}: ${value.slice(0, MAX_PROFILE_VALUE_LENGTH)}`)
  }

  if (profile.name) push('姓名', profile.name)
  if (profile.aliases && profile.aliases.length > 0) {
    push('别称', profile.aliases.join('、'))
  }
  if (profile.writingStyle) push('写作风格', profile.writingStyle)
  if (profile.formatPreferences && profile.formatPreferences.length > 0) {
    push('格式偏好', profile.formatPreferences.join('、'))
  }
  if (profile.themes && profile.themes.length > 0) push('关注主题', profile.themes.join('、'))
  if (profile.techStack && profile.techStack.length > 0) {
    push('技术栈', profile.techStack.join('、'))
  }
  if (profile.notes) push('备注', profile.notes)

  return parts.join('\n')
}

const FACT_CATEGORY_MAP: Record<string, MemoryCategory> = {
  personal: 'personal',
  个人: 'personal',
  个人信息: 'personal',
  project: 'project',
  项目: 'project',
  knowledge: 'knowledge',
  知识: 'knowledge',
  preference: 'preference',
  偏好: 'preference',
  other: 'other',
  其他: 'other',
}

/**
 * 旧接口兼容：按内容保存一条事实（自动推断分类/标签）。
 * 新代码建议直接用 store.addFact / memoryCore 的候选抽取。
 */
export function parseAndSaveFact(
  content: string,
  categoryHint?: string,
  tagsHint?: string[],
  source: string = 'agent',
): MemoryFact | null {
  const memoryStore = useAiMemoryStore()
  const trimmed = (content ?? '').trim()
  if (!trimmed) return null

  let category: MemoryCategory
  if (categoryHint) {
    category = FACT_CATEGORY_MAP[categoryHint.toLowerCase()] ?? 'knowledge'
  } else {
    category = detectCategory(trimmed)
  }
  const tags = tagsHint && tagsHint.length > 0 ? tagsHint : extractTags(trimmed, category)
  return memoryStore.addFact(trimmed, category, tags, source, 0.5, {
    origin: inferMemoryOrigin(source),
  })
}

function detectCategory(content: string): MemoryCategory {
  const lower = content.toLowerCase()
  if (/我叫|我是|我的名字|本人/.test(content)) return 'personal'
  if (/项目|工程|project|仓库|代码库/.test(lower)) return 'project'
  if (/喜欢|偏好|习惯|风格|常用|爱用/.test(content)) return 'preference'
  return 'knowledge'
}

function extractTags(content: string, category: MemoryCategory): string[] {
  const tags: string[] = [MEMORY_CATEGORY_LABELS[category]]
  const techKeywords = [
    'TypeScript',
    'Vue',
    'Rust',
    'Tauri',
    'React',
    'Python',
    'Node.js',
    'Go',
    '代码',
    '编程',
  ]
  for (const keyword of techKeywords) {
    if (content.includes(keyword)) tags.push(keyword)
  }
  return tags
}

/** 旧接口兼容：从最近用户消息中提取画像（实现已迁移到 memoryCore，更保守） */
export function extractProfileFromConversation(
  userMessages: string[],
): Partial<UserProfile> | null {
  return extractProfileCandidates(userMessages)
}

/** 把检索结果格式化为 AI 可读文本（search_memory 工具用） */
export function searchAndFormatMemories(query: string, maxResults: number = 10): string {
  const memoryStore = useAiMemoryStore()
  const facts = memoryStore.searchFacts(query, maxResults)

  if (facts.length === 0) {
    return '【记忆检索】未找到相关记忆。'
  }

  const lines: string[] = [`【记忆检索】找到 ${facts.length} 条相关记忆:`]
  facts.forEach((fact, index) => {
    const label = memoryCategoryLabel(fact.category)
    lines.push(`${index + 1}. [${label}] ${fact.content}`)
  })
  return lines.join('\n')
}

/** 把全部记忆格式化为 AI 可读文本（list_memory 工具用，包含画像） */
export function listAllMemories(): string {
  const memoryStore = useAiMemoryStore()
  const facts = memoryStore.facts

  if (facts.length === 0 && Object.keys(memoryStore.profile).length === 0) {
    return '【记忆列表】暂无记忆。'
  }

  const lines: string[] = [
    `【记忆列表】共 ${facts.length} 条记忆，画像 ${Object.keys(memoryStore.profile).length} 个字段:`,
  ]

  const profileSection = buildProfileSection(memoryStore.profile)
  if (profileSection) {
    lines.push('', '# 用户画像', profileSection)
  }

  const grouped: Record<string, MemoryFact[]> = {}
  for (const fact of facts) {
    const category = memoryCategoryLabel(fact.category)
    if (!grouped[category]) grouped[category] = []
    grouped[category].push(fact)
  }

  Object.entries(grouped).forEach(([category, items]) => {
    lines.push(`\n## ${category} (${items.length}条)`)
    items.forEach((fact) => {
      const short = fact.content.length > 80 ? `${fact.content.slice(0, 80)}…` : fact.content
      const flags = `${fact.pinned ? ' 置顶' : ''}${fact.enabled === false ? ' 停用' : ''}`
      lines.push(
        `- ${fact.id.slice(0, 8)}... [重要度:${fact.importance.toFixed(1)}${flags}] ${short}`,
      )
    })
  })

  return lines.join('\n')
}
