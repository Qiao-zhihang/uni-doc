/**
 * AI 多会话 store
 * 管理会话列表、活跃会话、消息历史
 * 持久化到 ~/.unidoc/ai_conversations.json (Tauri) 或 localStorage (Web)
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isTauri } from '@/core/serializer/markdownFile'
import type { ChatMessage, MessageContent } from '@/ai/types'

/** 会话数据结构 */
export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  profileId: string
  createdAt: number
  updatedAt: number
}

/** 持久化结构 */
interface ConversationsPayload {
  conversations: Conversation[]
  activeConversationId: string | null
}

/** 动态导入 Tauri invoke */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** localStorage key (Web 环境) */
const STORAGE_KEY = 'unidoc-ai-conversations'

/** 旧版历史 key (用于数据迁移) */
const OLD_HISTORY_KEY = 'unidoc-ai-history'

/** 将多模态内容转为纯文本（持久化时去除 base64 图片） */
function normalizeContentForSave(content: string | MessageContent[]): string {
  if (!content) return ''
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(' ')
  }
  return String(content)
}

export const useAiConversationStore = defineStore('aiConversation', () => {
  const conversations = ref<Conversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const loaded = ref(false)

  // save 防抖句柄
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 当前活跃会话 */
  const activeConversation = computed(() =>
    conversations.value.find((c) => c.id === activeConversationId.value) ?? null
  )

  /** 按最后更新时间降序排列的会话列表 */
  const sortedConversations = computed(() =>
    [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt)
  )

  /** 创建新会话，返回新会话 ID */
  function createConversation(profileId: string): string {
    const id = crypto.randomUUID()
    const now = Date.now()
    const conv: Conversation = {
      id,
      title: '新对话',
      messages: [],
      profileId,
      createdAt: now,
      updatedAt: now,
    }
    conversations.value.push(conv)
    activeConversationId.value = id
    save()
    return id
  }

  /** 删除会话 */
  function deleteConversation(id: string) {
    const idx = conversations.value.findIndex((c) => c.id === id)
    if (idx === -1) return
    conversations.value.splice(idx, 1)
    // 如果删除的是活跃会话，切换到列表第一个（或 null）
    if (activeConversationId.value === id) {
      activeConversationId.value = conversations.value.length > 0
        ? [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
        : null
    }
    save()
  }

  /** 切换活跃会话 */
  function switchConversation(id: string) {
    activeConversationId.value = id
    save()
  }

  /** 重命名会话 */
  function renameConversation(id: string, title: string) {
    const conv = conversations.value.find((c) => c.id === id)
    if (conv) {
      conv.title = title
      conv.updatedAt = Date.now()
      save()
    }
  }

  /** 向会话添加消息 */
  function addMessage(conversationId: string, message: ChatMessage) {
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) return
    conv.messages.push(message)
    conv.updatedAt = Date.now()
    // 如果是第一条用户消息，更新标题
    if (message.role === 'user' && conv.title === '新对话') {
      const text = typeof message.content === 'string'
        ? message.content
        : message.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join(' ')
      conv.title = text.slice(0, 20) || '新对话'
    }
    save()
  }

  /** 更新会话中最后一条消息的内容（用于流式输出） */
  function updateLastMessage(conversationId: string, content: string) {
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv || conv.messages.length === 0) return
    const last = conv.messages[conv.messages.length - 1]
    last.content = content
    conv.updatedAt = Date.now()
    // 流式更新不触发 save（太频繁），由调用方在完成后调 save
  }

  /** 触发保存（带防抖） */
  function save() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(async () => {
      saveTimer = null
      // 持久化时去除 base64 图片数据，只保留文本
      const toSave: ConversationsPayload = {
        conversations: conversations.value.map((c) => ({
          ...c,
          messages: c.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              ...m,
              content: normalizeContentForSave(m.content),
            })),
        })),
        activeConversationId: activeConversationId.value,
      }
      const json = JSON.stringify(toSave)
      try {
        if (isTauri()) {
          await tauriInvoke('save_ai_conversations', { json })
        } else {
          localStorage.setItem(STORAGE_KEY, json)
        }
      } catch (e) {
        console.error('保存AI会话数据失败:', e)
      }
    }, 500)
  }

  /** 立即保存（跳过防抖） */
  async function flushSave() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const toSave: ConversationsPayload = {
      conversations: conversations.value.map((c) => ({
        ...c,
        messages: c.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            ...m,
            content: normalizeContentForSave(m.content),
          })),
      })),
      activeConversationId: activeConversationId.value,
    }
    const json = JSON.stringify(toSave)
    try {
      if (isTauri()) {
        await tauriInvoke('save_ai_conversations', { json })
      } else {
        localStorage.setItem(STORAGE_KEY, json)
      }
    } catch (e) {
      console.error('保存AI会话数据失败:', e)
    }
  }

  /** 从磁盘加载 */
  async function load() {
    try {
      let json: string | null = null
      if (isTauri()) {
        const raw = await tauriInvoke<string>('load_ai_conversations')
        json = raw && raw.length > 0 ? raw : null
      } else {
        json = localStorage.getItem(STORAGE_KEY)
      }

      if (json) {
        const parsed = JSON.parse(json) as ConversationsPayload
        // 清洗数据：确保每条消息的 content 有效，过滤掉异常消息
        conversations.value = (parsed.conversations ?? []).map((c) => ({
          ...c,
          messages: c.messages
            .filter((m) => m && m.role && m.content != null)
            .map((m) => ({
              ...m,
              content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
            })),
        }))
        activeConversationId.value = parsed.activeConversationId ?? null
        // 如果活跃会话 ID 无效，切到第一个
        if (activeConversationId.value && !conversations.value.find((c) => c.id === activeConversationId.value)) {
          activeConversationId.value = conversations.value.length > 0
            ? [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
            : null
        }
      } else {
        // 尝试从旧版历史迁移
        await migrateFromOldHistory()
      }
    } catch (e) {
      console.error('加载AI会话数据失败:', e)
      // 加载失败时清空数据，避免卡死
      conversations.value = []
      activeConversationId.value = null
    } finally {
      loaded.value = true
    }
  }

  /** 从旧版单会话历史迁移 */
  async function migrateFromOldHistory() {
    try {
      let json: string | null = null
      if (isTauri()) {
        const raw = await tauriInvoke<string>('load_ai_history')
        json = raw && raw.length > 0 ? raw : null
      } else {
        json = localStorage.getItem(OLD_HISTORY_KEY)
      }
      if (!json) return

      const oldMessages = JSON.parse(json) as ChatMessage[]
      if (!Array.isArray(oldMessages) || oldMessages.length === 0) return

      // 清洗旧消息：确保 content 有效
      const cleanMessages = oldMessages
        .filter((m) => m && m.role && m.content != null)
        .map((m) => ({
          ...m,
          content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
        }))
        .filter((m) => m.role !== 'system')

      if (cleanMessages.length === 0) return

      const id = crypto.randomUUID()
      const now = Date.now()
      const firstUserMsg = cleanMessages.find((m) => m.role === 'user')
      const title = firstUserMsg
        ? (typeof firstUserMsg.content === 'string'
            ? firstUserMsg.content
            : String(firstUserMsg.content ?? '')
          ).slice(0, 20)
        : '迁移的对话'

      conversations.value.push({
        id,
        title: title || '迁移的对话',
        messages: cleanMessages,
        profileId: '',
        createdAt: now,
        updatedAt: now,
      })
      activeConversationId.value = id
      save()
    } catch (e) {
      console.error('迁移旧版对话历史失败:', e)
    }
  }

  /** 清空所有会话 */
  function clearAll() {
    conversations.value = []
    activeConversationId.value = null
    save()
  }

  return {
    conversations,
    activeConversationId,
    activeConversation,
    sortedConversations,
    loaded,
    createConversation,
    deleteConversation,
    switchConversation,
    renameConversation,
    addMessage,
    updateLastMessage,
    save,
    flushSave,
    load,
    clearAll,
  }
})
