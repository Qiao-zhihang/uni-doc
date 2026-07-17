<script setup lang="ts">
/**
 * 文档回放播放器
 * 全屏覆盖,展示文档从创建到当前的完整编辑历程
 * 底部时间轴 + 播放/暂停/倍速/跳转
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Play, Pause, SkipBack, SkipForward, X, Flag, Settings } from 'lucide-vue-next'
import { useReplayStore } from '@/stores/replay'
import BlockRenderer from './BlockRenderer.vue'

const replay = useReplayStore()

const emit = defineEmits<{ (e: 'exit'): void }>()

/** 设置面板可见性 */
const showSettings = ref(false)

/** 当前显示的 blocks(回放中的快照 blocks,非回放时为 null) */
const displayBlocks = computed(() => {
  const snap = replay.currentSnapshot
  return snap ? snap.blocks : []
})

/** 时间轴格式化 */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatRelative(ts: number, firstTs: number): string {
  const diff = ts - firstTs
  if (diff < 60000) return `${Math.round(diff / 1000)}s`
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`
  return `${Math.round(diff / 3600000)}h`
}

/** 进度百分比 */
const progress = computed(() => {
  if (replay.snapshots.length <= 1) return 0
  return (replay.currentIndex / (replay.snapshots.length - 1)) * 100
})

/** 时间轴拖拽 */
const isDragging = ref(false)
const timelineRef = ref<HTMLElement | null>(null)

function onTimelineClick(e: MouseEvent) {
  if (!timelineRef.value) return
  const rect = timelineRef.value.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  const idx = Math.round(ratio * (replay.snapshots.length - 1))
  replay.jumpTo(Math.max(0, Math.min(replay.snapshots.length - 1, idx)))
}

// ===== 自动播放 =====
let playTimer: ReturnType<typeof setTimeout> | null = null
const PLAY_INTERVAL_MS = 1500

function clearPlayTimer() {
  if (playTimer) {
    clearTimeout(playTimer)
    playTimer = null
  }
}

watch(
  () => replay.isPlaying,
  (playing) => {
    clearPlayTimer()
    if (!playing) return
    if (replay.currentIndex < 0) replay.jumpTo(0)

    const tick = () => {
      if (!replay.isPlaying) return
      if (replay.currentIndex >= replay.snapshots.length - 1) {
        replay.pause()
        return
      }
      replay.next()
      const interval = PLAY_INTERVAL_MS / replay.playSpeed
      playTimer = setTimeout(tick, interval)
    }
    playTimer = setTimeout(tick, PLAY_INTERVAL_MS / replay.playSpeed)
  }
)

// 到达末尾自动暂停
watch(
  () => replay.currentIndex,
  (idx) => {
    if (idx >= replay.snapshots.length - 1 && replay.isPlaying) {
      replay.pause()
    }
  }
)

// ===== 键盘导航 =====
function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowRight':
    case ' ':
      e.preventDefault()
      if (replay.isPlaying) replay.pause()
      else replay.next()
      break
    case 'ArrowLeft':
      e.preventDefault()
      replay.pause()
      replay.prev()
      break
    case 'Enter':
      e.preventDefault()
      if (replay.isPlaying) replay.pause()
      else replay.play()
      break
    case 'Escape':
      e.preventDefault()
      handleExit()
      break
    case 'Home':
      e.preventDefault()
      replay.jumpTo(0)
      break
    case 'End':
      e.preventDefault()
      replay.jumpTo(replay.snapshots.length - 1)
      break
  }
}

function handleExit() {
  replay.exitReplay()
  clearPlayTimer()
  emit('exit')
}

function togglePlay() {
  if (replay.isPlaying) replay.pause()
  else replay.play()
}

function cycleSpeed() {
  const speeds = [0.5, 1, 2, 4]
  const cur = speeds.indexOf(replay.playSpeed)
  replay.playSpeed = speeds[(cur + 1) % speeds.length]
}

// ===== 标记里程碑 =====
function handleMarkMilestone() {
  const label = `回放中标记 #${replay.snapshots.filter(s => s.type === 'milestone').length + 1}`
  replay.markMilestone(label)
}

// ===== 全屏 =====
const playerEl = ref<HTMLElement | null>(null)
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  if (playerEl.value?.requestFullscreen) {
    try { await playerEl.value.requestFullscreen() } catch { /* ignore */ }
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  clearPlayTimer()
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
})

// 切换快照时重置滚动
const contentRef = ref<HTMLElement | null>(null)
watch(() => replay.currentIndex, () => {
  nextTick(() => {
    if (contentRef.value) contentRef.value.scrollTop = 0
  })
})

/** 第一个快照的时间戳(用于相对时间显示) */
const firstTs = computed(() => replay.snapshots[0]?.timestamp ?? 0)

/** 当前快照信息 */
const currentInfo = computed(() => {
  const snap = replay.currentSnapshot
  if (!snap) return null
  return {
    label: snap.label,
    time: formatTime(snap.timestamp),
    relative: formatRelative(snap.timestamp, firstTs.value),
    type: snap.type,
    index: replay.currentIndex + 1,
    total: replay.snapshots.length
  }
})

/** 类型图标颜色 */
const typeColor = (type: string) => {
  switch (type) {
    case 'milestone': return 'var(--primary)'
    case 'manual': return '#f59e0b'
    default: return 'var(--muted-foreground)'
  }
}
</script>

<template>
  <div ref="playerEl" class="replay-player">
    <!-- 顶部信息栏 -->
    <div class="top-bar">
      <div class="top-left">
        <span class="replay-icon">▶</span>
        <span class="replay-title">文档回放</span>
        <span v-if="currentInfo" class="replay-meta">
          {{ currentInfo.index }} / {{ currentInfo.total }} · {{ currentInfo.relative }}
        </span>
      </div>
      <div class="top-right">
        <button class="top-btn" title="标记里程碑" @click="handleMarkMilestone">
          <Flag :size="14" />
        </button>
        <button class="top-btn" title="回放设置" @click="showSettings = !showSettings">
          <Settings :size="14" />
        </button>
        <button class="top-btn exit" title="退出回放 (Esc)" @click="handleExit">
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- 内容展示区 -->
    <div ref="contentRef" class="content-area">
      <div class="content-paper">
        <BlockRenderer
          v-for="block in displayBlocks"
          :key="block.id"
          :block="block"
        />
        <div v-if="displayBlocks.length === 0" class="empty-hint">
          没有快照可显示
        </div>
      </div>
    </div>

    <!-- 当前快照标签 -->
    <div v-if="currentInfo" class="snapshot-label">
      <span class="label-dot" :style="{ background: typeColor(currentInfo.type) }"></span>
      <span class="label-text">{{ currentInfo.label }}</span>
      <span class="label-time">{{ currentInfo.time }}</span>
    </div>

    <!-- 设置面板(折叠式) -->
    <transition name="settings-slide">
      <div v-if="showSettings" class="settings-panel">
        <div class="settings-row">
          <label class="settings-label">启用快照采集</label>
          <button
            class="toggle-btn"
            :class="{ on: replay.config.enabled }"
            @click="replay.updateConfig({ enabled: !replay.config.enabled })"
          >
            {{ replay.config.enabled ? '已开启' : '已关闭' }}
          </button>
        </div>
        <div class="settings-row">
          <label class="settings-label">自动快照间隔</label>
          <div class="interval-input">
            <input
              type="number"
              min="0"
              max="3600"
              :value="replay.config.autoIntervalSec"
              @change="replay.updateConfig({ autoIntervalSec: Math.max(0, parseInt(($event.target as HTMLInputElement).value) || 0) })"
            />
            <span class="interval-unit">秒 (0=不自动)</span>
          </div>
        </div>
        <div class="settings-row">
          <label class="settings-label">默认播放速度</label>
          <div class="speed-options">
            <button
              v-for="s in [0.5, 1, 2, 4]"
              :key="s"
              class="speed-option"
              :class="{ active: replay.config.playbackSpeed === s }"
              @click="replay.updateConfig({ playbackSpeed: s }); replay.playSpeed = s"
            >{{ s }}x</button>
          </div>
        </div>
        <div class="settings-info">
          共 {{ replay.snapshotCount }} 个快照 · 配置随文档保存
        </div>
      </div>
    </transition>

    <!-- 底部时间轴 + 控制栏 -->
    <div class="bottom-bar">
      <!-- 时间轴 -->
      <div ref="timelineRef" class="timeline" @click="onTimelineClick">
        <!-- 快照标记点 -->
        <div
          v-for="(snap, idx) in replay.snapshots"
          :key="snap.id"
          class="timeline-marker"
          :class="{
            active: idx === replay.currentIndex,
            milestone: snap.type === 'milestone',
            manual: snap.type === 'manual'
          }"
          :style="{ left: `${replay.snapshots.length > 1 ? (idx / (replay.snapshots.length - 1)) * 100 : 0}%` }"
          :title="`${formatTime(snap.timestamp)} - ${snap.label}`"
          @click.stop="replay.jumpTo(idx)"
        ></div>
        <!-- 进度条 -->
        <div class="timeline-progress" :style="{ width: `${progress}%` }"></div>
      </div>

      <!-- 控制按钮 -->
      <div class="controls">
        <button class="ctrl-btn" title="上一个" :disabled="replay.currentIndex <= 0" @click="replay.pause(); replay.prev()">
          <SkipBack :size="16" />
        </button>
        <button class="ctrl-btn play-btn" :title="replay.isPlaying ? '暂停' : '播放'" @click="togglePlay">
          <Pause v-if="replay.isPlaying" :size="18" />
          <Play v-else :size="18" />
        </button>
        <button class="ctrl-btn" title="下一个" :disabled="replay.currentIndex >= replay.snapshots.length - 1" @click="replay.pause(); replay.next()">
          <SkipForward :size="16" />
        </button>
        <button class="speed-btn" title="切换倍速" @click="cycleSpeed">
          {{ replay.playSpeed }}x
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.replay-player {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--muted);
  display: flex;
  flex-direction: column;
  font-family: var(--font-sans);
  color: var(--foreground);
}

/* 顶部信息栏 */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.replay-icon {
  color: var(--primary);
  font-size: 14px;
}
.replay-title {
  font-weight: 600;
  color: var(--foreground);
}
.replay-meta {
  color: var(--muted-foreground);
  font-size: 12px;
}
.top-right {
  display: flex;
  gap: 4px;
}
.top-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: all 0.15s;
}
.top-btn:hover {
  background: var(--accent);
  color: var(--foreground);
}
.top-btn.exit:hover {
  background: color-mix(in srgb, var(--destructive) 20%, transparent);
  color: var(--destructive);
}

/* 内容展示区 */
.content-area {
  flex: 1;
  overflow-y: auto;
  display: flex;
  justify-content: center;
  padding: 30px 40px;
}
.content-paper {
  width: 100%;
  max-width: 794px;
  background: var(--card);
  color: var(--card-foreground);
  border-radius: 8px;
  padding: 48px 56px;
  min-height: 200px;
  box-shadow: var(--shadow-2xl);
}
.content-paper :deep(.paragraph-block) {
  font-size: 16px;
  line-height: 1.8;
  margin: 12px 0;
}
.content-paper :deep(.heading-block) {
  font-size: 24px;
  margin: 24px 0 12px;
}
.content-paper :deep(.list-block) {
  font-size: 16px;
  line-height: 1.8;
}
.content-paper :deep(.quote-block) {
  font-size: 16px;
  padding: 12px 20px;
  border-left: 4px solid var(--primary);
  background: var(--secondary);
}
.content-paper :deep(.code-block) {
  font-size: 14px;
}
.empty-hint {
  text-align: center;
  color: var(--muted-foreground);
  padding: 40px;
  font-size: 14px;
}

/* 快照标签 */
.snapshot-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 20px;
  background: var(--card);
  border-top: 1px solid var(--border);
  font-size: 12px;
  flex-shrink: 0;
}
.label-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.label-text {
  color: var(--foreground);
  font-weight: 500;
}
.label-time {
  color: var(--muted-foreground);
  margin-left: auto;
}

/* 设置面板 */
.settings-panel {
  padding: 12px 20px;
  background: var(--card);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
}
.settings-label {
  color: var(--foreground);
}
.toggle-btn {
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.toggle-btn.on {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.interval-input {
  display: flex;
  align-items: center;
  gap: 8px;
}
.interval-input input {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid var(--input);
  border-radius: 6px;
  background: var(--secondary);
  color: var(--foreground);
  font-size: 12px;
  font-family: var(--font-mono);
  text-align: center;
}
.interval-input input:focus {
  outline: none;
  border-color: var(--ring);
}
.interval-unit {
  color: var(--muted-foreground);
  font-size: 11px;
}
.speed-options {
  display: flex;
  gap: 4px;
}
.speed-option {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.speed-option:hover {
  background: var(--accent);
}
.speed-option.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.settings-info {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 11px;
}

/* 设置面板过渡 */
.settings-slide-enter-active,
.settings-slide-leave-active {
  transition: all 0.2s ease;
  max-height: 200px;
  overflow: hidden;
}
.settings-slide-enter-from,
.settings-slide-leave-to {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
}

/* 底部控制栏 */
.bottom-bar {
  padding: 12px 20px 16px;
  background: var(--card);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

/* 时间轴 */
.timeline {
  position: relative;
  height: 28px;
  margin-bottom: 10px;
  cursor: pointer;
}
.timeline::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  transform: translateY(-50%);
}
.timeline-progress {
  position: absolute;
  top: 50%;
  left: 0;
  height: 3px;
  background: var(--primary);
  border-radius: 2px;
  transform: translateY(-50%);
  transition: width 0.3s ease;
}
.timeline-marker {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted-foreground);
  border: 1px solid var(--border);
  transform: translate(-50%, -50%);
  transition: all 0.15s;
  cursor: pointer;
}
.timeline-marker:hover {
  background: var(--foreground);
  transform: translate(-50%, -50%) scale(1.3);
}
.timeline-marker.manual {
  background: #f59e0b;
  border-color: #f59e0b;
}
.timeline-marker.milestone {
  background: var(--primary);
  border-color: var(--ring);
  width: 10px;
  height: 10px;
}
.timeline-marker.active {
  background: var(--foreground);
  border-color: var(--primary);
  width: 12px;
  height: 12px;
  box-shadow: 0 0 8px color-mix(in srgb, var(--foreground) 50%, transparent);
}

/* 控制按钮 */
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: var(--foreground);
  cursor: pointer;
  transition: all 0.15s;
}
.ctrl-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.ctrl-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.ctrl-btn.play-btn {
  width: 44px;
  height: 44px;
  background: var(--primary);
  color: var(--primary-foreground);
}
.ctrl-btn.play-btn:hover {
  background: var(--ring);
}
.speed-btn {
  margin-left: 8px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--foreground);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.speed-btn:hover {
  background: var(--accent);
  color: var(--foreground);
}
</style>
