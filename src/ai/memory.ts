/**
 * AI 记忆引擎
 * 负责：记忆注入构建、事实提取、检索匹配
 */

import type { UserProfile, MemoryFact, MemoryCategory } from './types'
import { MEMORY_CATEGORY_LABELS } from './types'
import { useAiMemoryStore } from '@/stores/aiMemory'

const MAX_INJECT_PROFILE = 600
const MAX_INJECT_FACTS = 5
const MAX_FACT_CONTENT_LENGTH = 500

export function buildMemoryInject(userInput: string): string {
  const memoryStore = useAiMemoryStore()
  const lines: string[] = []

  const profileSection = buildProfileSection(memoryStore.profile)
  if (profileSection) {
    lines.push('# 用户画像')
    lines.push(profileSection)
    lines.push('')
  }

  const relevantFacts = memoryStore.searchFacts(userInput, MAX_INJECT_FACTS)
  if (relevantFacts.length > 0) {
    lines.push('# 相关记忆')
    relevantFacts.forEach((f, i) => {
      const label = MEMORY_CATEGORY_LABELS[f.category] ?? f.category
      const truncated = f.content.length > MAX_FACT_CONTENT_LENGTH
        ? f.content.slice(0, MAX_FACT_CONTENT_LENGTH) + '…'
        : f.content
      lines.push(`${i + 1}. [${label}] ${truncated}`)
    })
    lines.push('')
  }

  return lines.join('\n')
}

function buildProfileSection(profile: UserProfile): string {
  const parts: string[] = []

  if (profile.name) parts.push(`姓名: ${profile.name}`)
  if (profile.aliases && profile.aliases.length > 0) {
    parts.push(`别称: ${profile.aliases.join('、')}`)
  }
  if (profile.writingStyle) parts.push(`写作风格: ${profile.writingStyle}`)
  if (profile.formatPreferences && profile.formatPreferences.length > 0) {
    parts.push(`格式偏好: ${profile.formatPreferences.join('、')}`)
  }
  if (profile.themes && profile.themes.length > 0) {
    parts.push(`关注主题: ${profile.themes.join('、')}`)
  }
  if (profile.techStack && profile.techStack.length > 0) {
    parts.push(`技术栈: ${profile.techStack.join('、')}`)
  }
  if (profile.notes) parts.push(`备注: ${profile.notes}`)

  if (parts.length === 0) return ''
  return parts.join('\n')
}

const PROFILE_FIELD_MAP: Record<string, keyof UserProfile> = {
  name: 'name',
  '姓名': 'name',
  alias: 'aliases',
  '别称': 'aliases',
  '叫': 'aliases',
  style: 'writingStyle',
  '风格': 'writingStyle',
  '偏好': 'formatPreferences',
  '喜欢': 'formatPreferences',
  theme: 'themes',
  '主题': 'themes',
  '关注': 'themes',
  tech: 'techStack',
  '技术': 'techStack',
  'tech stack': 'techStack',
  note: 'notes',
  '备注': 'notes',
}

const FACT_CATEGORY_MAP: Record<string, MemoryCategory> = {
  personal: 'personal',
  '个人': 'personal',
  '个人信息': 'personal',
  project: 'project',
  '项目': 'project',
  knowledge: 'knowledge',
  '知识': 'knowledge',
  preference: 'preference',
  '偏好': 'preference',
  other: 'other',
  '其他': 'other',
}

export function parseAndSaveFact(
  content: string,
  categoryHint?: string,
  tagsHint?: string[],
  source: string = 'agent'
): MemoryFact | null {
  const memoryStore = useAiMemoryStore()

  let category: MemoryCategory = 'knowledge'
  if (categoryHint) {
    category = FACT_CATEGORY_MAP[categoryHint.toLowerCase()] ?? 'knowledge'
  } else {
    category = detectCategory(content)
  }

  const tags = tagsHint && tagsHint.length > 0
    ? tagsHint
    : extractTags(content, category)

  return memoryStore.addFact(content, category, tags, source)
}

function detectCategory(content: string): MemoryCategory {
  const lower = content.toLowerCase()
  if (/我叫|我是|我叫啥|朕|我的|本人/.test(content)) return 'personal'
  if (/项目|工程|project|仓库|代码库/.test(lower)) return 'project'
  if (/喜欢|偏好|习惯|风格|常用|爱用/.test(content)) return 'preference'
  return 'knowledge'
}

function extractTags(content: string, category: MemoryCategory): string[] {
  const tags: string[] = [MEMORY_CATEGORY_LABELS[category]]

  const techKeywords = ['TypeScript', 'Vue', 'Rust', 'Tauri', 'React', 'Python', 'Node.js', 'Go', '代码', '编程']
  for (const kw of techKeywords) {
    if (content.includes(kw)) tags.push(kw)
  }

  return tags
}

export function extractProfileFromConversation(userMessages: string[]): Partial<UserProfile> | null {
  const updates: Partial<UserProfile> = {}
  let found = false

  const recentText = userMessages.slice(-5).join(' ')

  const nameMatch = recentText.match(/(?:我叫|我是|我的名字是|朕叫|朕是)\s*([^\s，。,.\n]{2,10})/)
  if (nameMatch) {
    updates.name = nameMatch[1]
    found = true
  }

  const aliasMatch = recentText.match(/(?:你可以叫我|叫我|我自称)\s*([^\s，。,.\n]{2,10})/)
  if (aliasMatch) {
    updates.aliases = [aliasMatch[1]]
    found = true
  }

  if (found) return updates
  return null
}

export function searchAndFormatMemories(query: string, maxResults: number = 10): string {
  const memoryStore = useAiMemoryStore()
  const facts = memoryStore.searchFacts(query, maxResults)

  if (facts.length === 0) {
    return '【记忆检索】未找到相关记忆。'
  }

  const lines: string[] = [`【记忆检索】找到 ${facts.length} 条相关记忆:`]
  facts.forEach((f, i) => {
    const label = MEMORY_CATEGORY_LABELS[f.category] ?? f.category
    lines.push(`${i + 1}. [${label}] ${f.content}`)
  })
  return lines.join('\n')
}

export function listAllMemories(): string {
  const memoryStore = useAiMemoryStore()
  const facts = memoryStore.facts

  if (facts.length === 0) {
    return '【记忆列表】暂无记忆。'
  }

  const lines: string[] = [`【记忆列表】共 ${facts.length} 条记忆:`]
  const grouped: Record<string, MemoryFact[]> = {}

  for (const f of facts) {
    const cat = MEMORY_CATEGORY_LABELS[f.category] ?? f.category
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(f)
  }

  Object.entries(grouped).forEach(([cat, items]) => {
    lines.push(`\n## ${cat} (${items.length}条)`)
    items.forEach((f) => {
      const short = f.content.length > 80 ? f.content.slice(0, 80) + '…' : f.content
      lines.push(`- ${f.id.slice(0, 8)}... [重要度:${f.importance.toFixed(1)}] ${short}`)
    })
  })

  return lines.join('\n')
}
