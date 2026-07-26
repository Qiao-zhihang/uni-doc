<script setup lang="ts">
/**
 * 提醒管理页面（独立路由）
 * 类似设置页面，通过 Ribbon 提醒按钮跳转
 */
import { onMounted } from 'vue'
import { ArrowLeft, Bell } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useReminderStore } from '@/stores/reminder'
import type { Reminder } from '@/stores/reminder'
import {
  BellRing,
  Pause,
  Play,
  Trash2,
  Clock,
  Calendar,
  RefreshCw,
} from 'lucide-vue-next'

const router = useRouter()
const reminderStore = useReminderStore()

onMounted(() => {
  void reminderStore.load()
})

function backToEditor() {
  router.push('/editor')
}

function formatTriggerTime(r: Reminder): string {
  const d = new Date(r.triggerAt)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()

  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  if (r.triggerType === 'once') {
    if (isToday) return `今天 ${timeStr}`
    if (isTomorrow) return `明天 ${timeStr}`
    return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`
  }
  if (r.triggerType === 'daily') return `每天 ${timeStr}`
  if (r.triggerType === 'weekly') {
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const days = r.repeatConfig?.weekdays ?? []
    if (days.length === 0) return `每周 ${timeStr}`
    if (days.length === 7) return `每天 ${timeStr}`
    const label = days.map((d) => weekdayNames[d]).join('、')
    return `${label} ${timeStr}`
  }
  if (r.triggerType === 'interval') {
    const ms = r.repeatConfig?.intervalMs ?? 3600_000
    const mins = Math.round(ms / 60_000)
    if (mins >= 60 && mins % 60 === 0) return `每 ${mins / 60} 小时`
    return `每 ${mins} 分钟`
  }
  return timeStr
}

function getTypeIcon(r: Reminder) {
  switch (r.triggerType) {
    case 'once':
      return Clock
    case 'daily':
      return Calendar
    case 'weekly':
      return Calendar
    case 'interval':
      return RefreshCw
    default:
      return Bell
  }
}

function togglePause(r: Reminder) {
  if (r.status === 'active') {
    reminderStore.pauseReminder(r.id)
  } else if (r.status === 'paused') {
    reminderStore.resumeReminder(r.id)
  }
}

function remove(r: Reminder) {
  reminderStore.cancelReminder(r.id)
}
</script>

<template>
  <main class="reminders-page">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <button class="icon-btn" title="返回编辑器" @click="backToEditor">
          <ArrowLeft :size="18" />
        </button>
        <h1 class="page-title">提醒</h1>
      </div>
    </header>

    <div class="main-body">
      <div class="content">
        <p class="section-desc">
          在 AI 对话框中向 UU鲨 说明需要提醒的内容和时间即可创建提醒，支持一次性、每日、每周和间隔重复等模式。
        </p>

        <div v-if="reminderStore.sortedReminders.length" class="reminder-list">
          <div
            v-for="r in reminderStore.sortedReminders"
            :key="r.id"
            class="reminder-item"
            :class="{ paused: r.status === 'paused' }"
          >
            <div class="reminder-icon">
              <component :is="r.status === 'active' ? BellRing : Bell" :size="18" />
            </div>
            <div class="reminder-body">
              <div class="reminder-title">{{ r.title }}</div>
              <div class="reminder-meta">
                <component :is="getTypeIcon(r)" :size="13" />
                <span>{{ formatTriggerTime(r) }}</span>
                <span class="status-dot" :class="r.status"></span>
                <span class="status-text">{{ r.status === 'active' ? '运行中' : '已暂停' }}</span>
              </div>
              <div v-if="r.message" class="reminder-msg">{{ r.message }}</div>
            </div>
            <div class="reminder-actions">
              <button
                class="action-btn"
                :title="r.status === 'active' ? '暂停' : '恢复'"
                @click="togglePause(r)"
              >
                <component :is="r.status === 'active' ? Pause : Play" :size="16" />
              </button>
              <button class="action-btn danger" title="删除" @click="remove(r)">
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>

        <div v-else class="empty">
          <Bell :size="40" class="empty-icon" />
          <div class="empty-title">暂无提醒</div>
          <div class="empty-desc">
            在 AI 对话框中向 UU鲨 说明需要提醒的内容和时间
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.reminders-page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--titlebar-height);
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--sidebar-border);
  background: var(--sidebar);
  -webkit-app-region: drag;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  border-radius: var(--radius-button);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.icon-btn:hover {
  background: var(--sidebar-accent);
  color: var(--sidebar-foreground);
}
.page-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.main-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.content {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}
.section-desc {
  font-size: 13px;
  color: var(--muted-foreground);
  line-height: 1.6;
  margin: 0 0 20px;
}
.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.reminder-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--sidebar);
  border: 1px solid var(--sidebar-border);
  transition: border-color 0.15s ease;
}
.reminder-item:hover {
  border-color: var(--brand-500);
}
.reminder-item.paused {
  opacity: 0.55;
}
.reminder-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-500);
  background: rgba(var(--brand-500-rgb, 99, 102, 241), 0.12);
  border-radius: 8px;
  margin-top: 1px;
}
.reminder-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.reminder-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sidebar-foreground);
  line-height: 1.4;
  word-break: break-word;
}
.reminder-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-foreground);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: 4px;
}
.status-dot.active {
  background: #22c55e;
}
.status-dot.paused {
  background: #a3a3a3;
}
.status-text {
  margin-left: 2px;
}
.reminder-msg {
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.5;
  word-break: break-word;
  margin-top: 2px;
}
.reminder-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
}
.action-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  border-radius: 8px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.action-btn:hover {
  background: var(--sidebar-accent);
  color: var(--sidebar-foreground);
}
.action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 80px 24px;
  text-align: center;
}
.empty-icon {
  color: var(--muted-foreground);
  opacity: 0.3;
  margin-bottom: 8px;
}
.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--sidebar-foreground);
}
.empty-desc {
  font-size: 13px;
  color: var(--muted-foreground);
  line-height: 1.7;
}
</style>
