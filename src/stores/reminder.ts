/**
 * 提醒系统 Store
 * 管理自唤醒/定时提醒，支持：
 *   - 一次性提醒（30分钟后、明天下午3点等）
 *   - 周期性提醒（每天6点、每周一早上等）
 *   - 系统通知 + 对话内消息双通知
 *   - 持久化（Tauri 文件 / Web localStorage）
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isTauri } from '@/core/serializer/markdownFile'
import type { ChatMessage } from '@/ai/types'

/** 提醒触发类型 */
export type ReminderTriggerType = 'once' | 'daily' | 'weekly' | 'interval'

/** 提醒状态 */
export type ReminderStatus = 'active' | 'paused' | 'done' | 'cancelled'

/** 提醒数据结构 */
export interface Reminder {
  id: string
  title: string
  message: string
  triggerType: ReminderTriggerType
  /** ISO 时间戳（一次性提醒的触发时间 或 周期提醒的基准时间） */
  triggerAt: number
  /** 周期配置（仅周期性提醒使用） */
  repeatConfig?: {
    /** 周几触发（0=周日 ~ 6=周六），weekly 类型必填 */
    weekdays?: number[]
    /** 间隔毫秒数（interval 类型） */
    intervalMs?: number
  }
  status: ReminderStatus
  createdAt: number
  /** 上次触发时间（用于周期判断） */
  lastFiredAt?: number
  /** 创建提醒时所在的会话 ID，到期时在该会话发消息 */
  conversationId?: string
}

/** 动态导入 Tauri invoke */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** localStorage key（Web 环境） */
const STORAGE_KEY = 'unidoc-reminders'

/**
 * 触发系统通知
 * Tauri 环境用 @tauri-apps/plugin-notification，Web 用浏览器 Notification API
 */
async function fireSystemNotification(title: string, body: string): Promise<void> {
  try {
    if (isTauri()) {
      const { sendNotification, isPermissionGranted, requestPermission } =
        await import('@tauri-apps/plugin-notification')
      if (!(await isPermissionGranted())) {
        await requestPermission()
      }
      sendNotification({ title, body })
    } else {
      const Notif = (globalThis as { Notification?: typeof window.Notification }).Notification
      if (typeof Notif !== 'undefined') {
        if (Notif.permission === 'default') {
          await Notif.requestPermission()
        }
        if (Notif.permission === 'granted') {
          new Notif(title, { body, icon: '/favicon.ico' })
        }
      }
    }
  } catch (e) {
    console.error('系统通知失败:', e)
  }
}

export const useReminderStore = defineStore('reminder', () => {
  const reminders = ref<Reminder[]>([])
  const loaded = ref(false)

  /** 调度器定时器句柄 */
  let schedulerTimer: ReturnType<typeof setInterval> | null = null

  // ===== 计算属性 =====

  const activeReminders = computed(() =>
    reminders.value.filter((r) => r.status === 'active' || r.status === 'paused'),
  )

  const sortedReminders = computed(() =>
    [...activeReminders.value].sort((a, b) => a.triggerAt - b.triggerAt),
  )

  // ===== 核心方法 =====

  /**
   * 创建一个新提醒
   * @param title 提醒标题
   * @param message 提醒消息内容
   * @param triggerType 触发类型
   * @param triggerAt 触发的 ISO 时间戳
   * @param repeatConfig 周期配置（可选）
   * @param conversationId 关联的会话 ID（可选）
   */
  function createReminder(
    title: string,
    message: string,
    triggerType: ReminderTriggerType,
    triggerAt: number,
    repeatConfig?: Reminder['repeatConfig'],
    conversationId?: string,
  ): Reminder {
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      title,
      message,
      triggerType,
      triggerAt,
      repeatConfig,
      status: 'active',
      createdAt: Date.now(),
      conversationId,
    }
    reminders.value.push(reminder)
    save()
    ensureScheduler()
    return reminder
  }

  /** 取消/删除提醒 */
  function cancelReminder(id: string): boolean {
    const idx = reminders.value.findIndex((r) => r.id === id)
    if (idx === -1) return false
    reminders.value[idx].status = 'cancelled'
    reminders.value.splice(idx, 1)
    save()
    return true
  }

  /** 暂停提醒 */
  function pauseReminder(id: string): boolean {
    const r = reminders.value.find((r) => r.id === id)
    if (!r || r.status !== 'active') return false
    r.status = 'paused'
    save()
    return true
  }

  /** 恢复暂停的提醒 */
  function resumeReminder(id: string): boolean {
    const r = reminders.value.find((r) => r.id === id)
    if (!r || r.status !== 'paused') return false
    r.status = 'active'
    save()
    ensureScheduler()
    return true
  }

  /** 根据 ID 查找提醒 */
  function getReminder(id: string): Reminder | undefined {
    return reminders.value.find((r) => r.id === id)
  }

  /** 列出所有未取消的提醒 */
  function listReminders(): Reminder[] {
    return [...sortedReminders.value]
  }

  // ===== 调度器 =====

  /** 确保调度器正在运行 */
  function ensureScheduler() {
    if (schedulerTimer !== null) return
    schedulerTimer = setInterval(tick, 1000)
  }

  /** 停止调度器 */
  function stopScheduler() {
    if (schedulerTimer !== null) {
      clearInterval(schedulerTimer)
      schedulerTimer = null
    }
  }

  /** 每次 tick（每秒）检查到期提醒 */
  async function tick() {
    const now = Date.now()
    const due: Reminder[] = []

    for (const r of reminders.value) {
      if (r.status !== 'active') continue

      if (r.triggerType === 'once') {
        if (now >= r.triggerAt) {
          due.push(r)
        }
      } else if (r.triggerType === 'daily') {
        const lastFired = r.lastFiredAt ?? 0
        const nextFire = computeNextDaily(r.triggerAt, lastFired)
        if (now >= nextFire) {
          due.push(r)
        }
      } else if (r.triggerType === 'weekly') {
        const lastFired = r.lastFiredAt ?? 0
        const nextFire = computeNextWeekly(r.triggerAt, r.repeatConfig?.weekdays ?? [], lastFired)
        if (now >= nextFire) {
          due.push(r)
        }
      } else if (r.triggerType === 'interval') {
        const intervalMs = r.repeatConfig?.intervalMs ?? 3600_000
        const lastFired = r.lastFiredAt ?? r.createdAt
        if (now >= lastFired + intervalMs) {
          due.push(r)
        }
      }
    }

    for (const r of due) {
      await fireReminder(r)
    }

    // 如果没有任何活跃提醒，停止调度器省电
    const hasActive = reminders.value.some((r) => r.status === 'active')
    if (!hasActive) stopScheduler()
  }

  /** 触发一个提醒（发系统通知 + 会话消息） */
  async function fireReminder(reminder: Reminder) {
    // 1. 系统通知
    fireSystemNotification(reminder.title, reminder.message)

    // 2. 在关联会话中发消息
    if (reminder.conversationId) {
      try {
        const { useAiConversationStore } = await import('@/stores/aiConversation')
        const convStore = useAiConversationStore()
        const msg: ChatMessage = {
          role: 'assistant',
          content: `⏰ **${reminder.title}**\n\n${reminder.message}`,
        }
        convStore.addMessage(reminder.conversationId, msg)
        convStore.flushSave()
      } catch (e) {
        console.error('向会话发送提醒消息失败:', e)
      }
    }

    // 3. 更新状态
    if (reminder.triggerType === 'once') {
      reminder.status = 'done'
      // 一次性提醒触发后从列表移除（但保留在历史中）
      const idx = reminders.value.findIndex((r) => r.id === reminder.id)
      if (idx !== -1) reminders.value.splice(idx, 1)
    } else {
      reminder.lastFiredAt = Date.now()
    }
    save()
  }

  // ===== 持久化 =====

  function save() {
    const json = JSON.stringify(reminders.value)
    if (isTauri()) {
      tauriInvoke('save_reminders', { json }).catch((e) => console.error('保存提醒数据失败:', e))
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, json)
      } catch (e) {
        console.error('保存提醒数据失败:', e)
      }
    }
  }

  async function load() {
    if (loaded.value) return
    try {
      let json: string | null = null
      if (isTauri()) {
        const raw = await tauriInvoke<string>('load_reminders')
        json = raw && raw.length > 0 ? raw : null
      } else {
        json = localStorage.getItem(STORAGE_KEY)
      }

      if (json) {
        const parsed = JSON.parse(json)
        if (Array.isArray(parsed)) {
          reminders.value = parsed.filter(
            (r) => r && r.id && r.status !== 'cancelled' && r.status !== 'done',
          )
        }
      }
    } catch (e) {
      console.error('加载提醒数据失败:', e)
    } finally {
      loaded.value = true
      if (reminders.value.some((r) => r.status === 'active')) {
        ensureScheduler()
      }
    }
  }

  return {
    // state
    reminders,
    loaded,
    // computed
    activeReminders,
    sortedReminders,
    // actions
    createReminder,
    cancelReminder,
    pauseReminder,
    resumeReminder,
    getReminder,
    listReminders,
    load,
    save,
  }
})

// ===== 时间计算辅助函数 =====

/** 计算每日提醒的下次触发时间 */
function computeNextDaily(baseTriggerAt: number, lastFiredAt: number): number {
  const baseDate = new Date(baseTriggerAt)
  const hours = baseDate.getHours()
  const minutes = baseDate.getMinutes()
  const seconds = baseDate.getSeconds()

  const now = new Date()
  let next = new Date(now)
  next.setHours(hours, minutes, seconds, 0)

  // 如果今天这个时间已经过了（或在 lastFired 之后 1 分钟内刚触发过），推到明天
  const justFired = lastFiredAt > 0 && Date.now() - lastFiredAt < 60_000
  if (next.getTime() <= Date.now() || justFired) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime()
}

/** 计算每周提醒的下次触发时间 */
function computeNextWeekly(baseTriggerAt: number, weekdays: number[], lastFiredAt: number): number {
  if (weekdays.length === 0) return computeNextDaily(baseTriggerAt, lastFiredAt)

  const baseDate = new Date(baseTriggerAt)
  const hours = baseDate.getHours()
  const minutes = baseDate.getMinutes()
  const seconds = baseDate.getSeconds()

  const now = new Date()
  const justFired = lastFiredAt > 0 && Date.now() - lastFiredAt < 60_000

  // 从今天开始往后找 14 天内第一个匹配的 weekday
  for (let i = 0; i < 14; i++) {
    const candidate = new Date(now)
    candidate.setDate(candidate.getDate() + i)
    candidate.setHours(hours, minutes, seconds, 0)

    if (!weekdays.includes(candidate.getDay())) continue
    if (candidate.getTime() <= Date.now() && i === 0 && !justFired) continue
    if (justFired && i === 0) continue

    return candidate.getTime()
  }

  // 兜底：一周后
  return Date.now() + 7 * 24 * 3600_000
}
