<script setup lang="ts">
/**
 * 文档回放播放器
 * 视频播放器风格:顶部极简 + 左侧目录 + 中间内容 + 底部悬浮控制栏
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Film,
  List,
  Edit3,
  Check,
  X as XIcon,
  Flag,
  Undo2
} from 'lucide-vue-next'
import { useReplayStore } from '@/stores/replay'
import { useDocumentStore } from '@/stores/document'
import { confirmDialog } from '@/composables/useDialog'
import BlockRenderer from './BlockRenderer.vue'
import type { Block } from '@/core/blocks/types'

const replay = useReplayStore()
const doc = useDocumentStore()
const emit = defineEmits<{ (e: 'exit'): void }>()

// ===== 状态 =====
const zoom = ref(100)
const controlsVisible = ref(true)
const showOutline = ref(false)
const contentRef = ref<HTMLElement | null>(null)
const timelineRef = ref<HTMLElement | null>(null)

const editingLabel = ref('')
const isEditing = ref(false)
const labelHovered = ref(false)
const skipBlurSave = ref(false)

let hideTimer: ReturnType<typeof setTimeout> | null = null
const HIDE_DELAY = 2500

// ===== 缩放 =====
const zoomStyle = computed(() => ({
  width: `calc(var(--a4-width) * ${zoom.value / 100})`,
  maxWidth: '100%'
}))

function zoomIn() {
  zoom.value = Math.min(200, zoom.value + 10)
}
function zoomOut() {
  zoom.value = Math.max(50, zoom.value - 10)
}
function zoomReset() {
  zoom.value = 100
}

// ===== 控制栏自动隐藏 =====
function resetHideTimer() {
  controlsVisible.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (!isEditing.value) {
      controlsVisible.value = false
    }
  }, HIDE_DELAY)
}

function onMouseMove() {
  resetHideTimer()
}

// ===== 文档目录大纲 =====
const outlineItems = computed(() => {
  const snap = replay.currentSnapshot
  if (!snap) return []
  const items: { id: string; text: string; level: number; blockId: string }[] = []
  snap.blocks.forEach((block: Block) => {
    if (block.type === 'heading') {
      const content = block.content as { text: string }
      const props = block.props as { level: number }
      items.push({
        id: block.id,
        text: content.text || '(无标题)',
        level: props.level,
        blockId: block.id
      })
    }
  })
  return items
})

function scrollToHeading(blockId: string) {
  if (!contentRef.value) return
  const el = contentRef.value.querySelector(`[data-block-id="${blockId}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function toggleOutline() {
  showOutline.value = !showOutline.value
}

// ===== 显示内容 =====
const displayBlocks = computed(() => {
  const snap = replay.currentSnapshot
  return snap ? snap.blocks : []
})

const firstTs = computed(() => replay.snapshots[0]?.timestamp ?? 0)

const currentInfo = computed(() => {
  const snap = replay.currentSnapshot
  if (!snap) return null
  return {
    label: snap.label,
    time: formatTime(snap.timestamp),
    relative: formatRelative(snap.timestamp, firstTs.value),
    type: snap.type,
    index: replay.currentIndex + 1,
    total: replay.snapshots.length,
    id: snap.id
  }
})

const progress = computed(() => {
  if (replay.snapshots.length <= 1) return 0
  return (replay.currentIndex / (replay.snapshots.length - 1)) * 100
})

// ===== 时间格式化 =====
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

// ===== 时间轴拖拽 =====
const isDragging = ref(false)

function onTimelineMousedown(e: MouseEvent) {
  isDragging.value = true
  handleTimelineClick(e)
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value || !timelineRef.value) return
  e.preventDefault()
  const rect = timelineRef.value.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const idx = Math.round(ratio * (replay.snapshots.length - 1))
  replay.jumpTo(Math.max(0, Math.min(replay.snapshots.length - 1, idx)))
}

function onDragEnd() {
  isDragging.value = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
}

function handleTimelineClick(e: MouseEvent) {
  if (!timelineRef.value) return
  const rect = timelineRef.value.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const idx = Math.round(ratio * (replay.snapshots.length - 1))
  replay.jumpTo(Math.max(0, Math.min(replay.snapshots.length - 1, idx)))
}

// ===== 播放控制 =====
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

watch(
  () => replay.currentIndex,
  (idx) => {
    if (idx >= replay.snapshots.length - 1 && replay.isPlaying) {
      replay.pause()
    }
    // 切换快照时退出编辑模式
    if (isEditing.value) {
      saveLabel()
    }
  }
)

function togglePlay() {
  if (replay.isPlaying) replay.pause()
  else replay.play()
}

function cycleSpeed() {
  const speeds = [0.5, 1, 2, 4]
  const cur = speeds.indexOf(replay.playSpeed)
  replay.playSpeed = speeds[(cur + 1) % speeds.length]
}

// ===== 标签编辑 =====
function startEdit() {
  if (!currentInfo.value) return
  editingLabel.value = currentInfo.value.label
  isEditing.value = true
  labelHovered.value = false
}

function saveLabel() {
  if (!currentInfo.value || !isEditing.value) return
  if (skipBlurSave.value) {
    skipBlurSave.value = false
    return
  }
  const label = editingLabel.value.trim()
  if (label && label !== currentInfo.value.label) {
    replay.updateSnapshotLabel(currentInfo.value.id, label)
  }
  isEditing.value = false
  editingLabel.value = ''
}

function cancelEdit() {
  skipBlurSave.value = true
  isEditing.value = false
  editingLabel.value = ''
}

function toggleMilestone() {
  if (!currentInfo.value) return
  const newType = currentInfo.value.type === 'milestone' ? 'auto' : 'milestone'
  replay.updateSnapshotType(currentInfo.value.id, newType)
}

// ===== 版本回退 =====
async function revertToCurrentSnapshot() {
  const snap = replay.currentSnapshot
  if (!snap) return

  const ok = await confirmDialog(
    `确定要将文档回退到「${snap.label}」版本吗？\n当前内容会被覆盖，但可以通过撤销恢复。`,
    '回退版本'
  )
  if (!ok) return

  const newBlocks = JSON.parse(JSON.stringify(snap.blocks))
  doc.replaceBlocks(newBlocks, `回退到：${snap.label}`)
  doc.renderTick++

  replay.exitReplay()
  clearPlayTimer()
  if (hideTimer) clearTimeout(hideTimer)
  emit('exit')
}

// ===== 退出 =====
function handleExit() {
  replay.exitReplay()
  clearPlayTimer()
  if (hideTimer) clearTimeout(hideTimer)
  emit('exit')
}

// ===== 键盘导航 =====
function onKeydown(e: KeyboardEvent) {
  if (isEditing.value) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveLabel()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
    return
  }
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault()
      if (replay.isPlaying) replay.pause()
      replay.next()
      break
    case 'ArrowLeft':
      e.preventDefault()
      replay.pause()
      replay.prev()
      break
    case ' ':
      e.preventDefault()
      togglePlay()
      break
    case 'Enter':
      e.preventDefault()
      togglePlay()
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
    case 'o':
    case 'O':
      e.preventDefault()
      toggleOutline()
      break
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  resetHideTimer()
  // 进入后跳到第一个快照，默认暂停
  if (replay.currentIndex < 0 && replay.snapshots.length > 0) {
    replay.jumpTo(0)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  clearPlayTimer()
  if (hideTimer) clearTimeout(hideTimer)
  onDragEnd()
})

const typeColor = (type: string) => {
  switch (type) {
    case 'milestone': return 'var(--primary, #3b82f6)'
    case 'manual': return '#f59e0b'
    default: return 'rgba(255,255,255,0.5)'
  }
}
</script>

<template>
  <div
    class="replay-player"
    @mousemove="onMouseMove"
  >
    <!-- 顶部栏 -->
    <div class="top-bar" :class="{ hidden: !controlsVisible }" @click.stop>
      <div class="top-left">
        <Film :size="16" class="title-icon" />
        <span class="title">文档回放</span>
        <span v-if="currentInfo" class="meta">
          {{ currentInfo.index }} / {{ currentInfo.total }} · {{ currentInfo.relative }}
        </span>
      </div>
      <div class="top-right">
        <!-- 缩放控制 -->
        <div class="zoom-controls">
          <button class="icon-btn" title="缩小" @click="zoomOut">
            <ZoomOut :size="16" />
          </button>
          <span class="zoom-label">{{ zoom }}%</span>
          <button class="icon-btn" title="放大" @click="zoomIn">
            <ZoomIn :size="16" />
          </button>
          <button class="icon-btn" title="重置缩放" @click="zoomReset">
            <RotateCcw :size="16" />
          </button>
        </div>
        <button
          class="icon-btn revert-btn"
          title="回退到此版本"
          @click="revertToCurrentSnapshot"
        >
          <Undo2 :size="16" />
        </button>
        <button
          class="icon-btn"
          :class="{ active: showOutline }"
          title="目录 (O)"
          @click="toggleOutline"
        >
          <List :size="18" />
        </button>
        <button class="icon-btn exit" title="退出回放 (Esc)" @click="handleExit">
          <X :size="18" />
        </button>
      </div>
    </div>

    <!-- 左侧目录大纲 -->
    <transition name="outline-fade">
      <div v-if="showOutline" class="outline-panel" @click.stop>
        <div class="outline-header">
          <List :size="14" />
          <span>文档目录</span>
          <span class="outline-count">{{ outlineItems.length }}</span>
        </div>
        <div class="outline-body">
          <div v-if="outlineItems.length === 0" class="outline-empty">
            当前快照无标题
          </div>
          <div
            v-for="item in outlineItems"
            :key="item.id"
            class="outline-item"
            :class="`level-${item.level}`"
            @click="scrollToHeading(item.blockId)"
          >
            {{ item.text }}
          </div>
        </div>
      </div>
    </transition>

    <!-- 内容展示区 -->
    <div ref="contentRef" class="content-area" :class="{ 'with-outline': showOutline }">
      <div class="paper-wrap" :style="zoomStyle">
        <div class="a4-paper">
          <div
            v-for="block in displayBlocks"
            :key="block.id"
            class="block-row"
            :data-block-id="block.id"
          >
            <div class="block-content">
              <BlockRenderer :block="block" />
            </div>
          </div>
          <div v-if="displayBlocks.length === 0" class="empty-hint">
            没有快照可显示
          </div>
          <div class="end-area"></div>
        </div>
      </div>
    </div>

    <!-- 底部悬浮控制栏 -->
    <div class="bottom-controls" :class="{ hidden: !controlsVisible }" @click.stop>
      <!-- 快照标签 + 编辑 -->
      <div class="snapshot-info">
        <div
          v-if="currentInfo"
          class="label-wrapper"
          :class="{ hovered: labelHovered || isEditing }"
          @mouseenter="labelHovered = true"
          @mouseleave="!isEditing && (labelHovered = false)"
        >
          <span class="label-dot" :style="{ background: typeColor(currentInfo.type) }"></span>

          <!-- 编辑模式 -->
          <div v-if="isEditing" class="label-edit">
            <input
              v-model="editingLabel"
              class="edit-input"
              @keydown.enter="saveLabel"
              @keydown.esc="cancelEdit"
              @blur="saveLabel"
            />
            <button class="edit-ok" title="保存" @mousedown.prevent @click="saveLabel">
              <Check :size="12" />
            </button>
            <button class="edit-cancel" title="取消" @mousedown.prevent @click="cancelEdit">
              <XIcon :size="12" />
            </button>
          </div>

          <!-- 显示模式（hover 显示暗框 + 编辑图标） -->
          <div v-else class="label-display" @click="startEdit">
            <span class="label-text">{{ currentInfo.label }}</span>
            <Edit3 v-if="labelHovered" :size="12" class="edit-icon" />
          </div>

          <!-- 里程碑复选框（hover 时显示） -->
          <label v-if="labelHovered && !isEditing" class="milestone-check">
            <input
              type="checkbox"
              :checked="currentInfo.type === 'milestone'"
              @change="toggleMilestone"
            />
            <Flag :size="11" />
            <span>里程碑</span>
          </label>
        </div>
        <span v-if="currentInfo" class="info-time">{{ currentInfo.time }}</span>
      </div>

      <!-- 时间轴 -->
      <div
        ref="timelineRef"
        class="timeline"
        :class="{ dragging: isDragging }"
        @mousedown="onTimelineMousedown"
      >
        <div class="timeline-track"></div>
        <div class="timeline-progress" :style="{ width: `${progress}%` }"></div>
        <div class="timeline-thumb" :style="{ left: `${progress}%` }"></div>
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
      </div>

      <!-- 控制按钮 -->
      <div class="controls">
        <button
          class="ctrl-btn prev"
          title="上一个 (←)"
          :disabled="replay.currentIndex <= 0"
          @click="replay.pause(); replay.prev()"
        >
          <SkipBack :size="18" />
        </button>
        <button
          class="ctrl-btn play"
          :title="replay.isPlaying ? '暂停 (空格)' : '播放 (空格)'"
          @click="togglePlay"
        >
          <Pause v-if="replay.isPlaying" :size="22" />
          <Play v-else :size="22" />
        </button>
        <button
          class="ctrl-btn next"
          title="下一个 (→)"
          :disabled="replay.currentIndex >= replay.snapshots.length - 1"
          @click="replay.pause(); replay.next()"
        >
          <SkipForward :size="18" />
        </button>
        <button class="speed-btn" title="播放速度 (点击切换)" @click="cycleSpeed">
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
  background: #000;
  display: flex;
  flex-direction: column;
  font-family: var(--font-sans);
  color: #fff;
  user-select: none;
  overflow: hidden;
}

/* ===== 顶部栏 ===== */
.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), transparent);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.top-bar.hidden {
  opacity: 0;
  transform: translateY(-10px);
  pointer-events: none;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
}
.title-icon {
  opacity: 0.8;
}
.title {
  font-weight: 600;
  font-size: 14px;
}
.meta {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}
.top-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
  padding-right: 8px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}
.zoom-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  min-width: 42px;
  text-align: center;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;
}
.icon-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}
.icon-btn.active {
  background: var(--primary, #3b82f6);
}
.icon-btn.exit:hover {
  background: rgba(239, 68, 68, 0.3);
}
.icon-btn.revert-btn:hover {
  background: rgba(245, 158, 11, 0.3);
  color: #f59e0b;
}

/* ===== 左侧目录大纲 ===== */
.outline-panel {
  position: absolute;
  top: 60px;
  left: 20px;
  bottom: 100px;
  width: 220px;
  z-index: 5;
  background: rgba(20, 20, 20, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.outline-fade-enter-active,
.outline-fade-leave-active {
  transition: all 0.25s ease;
}
.outline-fade-enter-from,
.outline-fade-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
.outline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.outline-count {
  margin-left: auto;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-family: var(--font-mono);
}
.outline-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.outline-body::-webkit-scrollbar {
  width: 4px;
}
.outline-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}
.outline-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
}
.outline-item {
  padding: 6px 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.outline-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.outline-item.level-1 {
  font-weight: 600;
  font-size: 14px;
}
.outline-item.level-2 {
  padding-left: 20px;
  font-weight: 500;
}
.outline-item.level-3 {
  padding-left: 34px;
  font-size: 12px;
  opacity: 0.9;
}
.outline-item.level-4,
.outline-item.level-5,
.outline-item.level-6 {
  padding-left: 46px;
  font-size: 12px;
  opacity: 0.75;
}

/* ===== 内容区 ===== */
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 60px 24px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  transition: padding 0.25s ease;
}
.content-area.with-outline {
  padding-left: 270px;
}
.content-area::-webkit-scrollbar {
  width: 8px;
}
.content-area::-webkit-scrollbar-track {
  background: transparent;
}
.content-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}
.content-area::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
.paper-wrap {
  margin: 0 auto;
}
.a4-paper {
  width: 100%;
  min-height: var(--a4-min-height);
  padding: 48px 48px 24px;
  background: var(--card);
  color: var(--card-foreground);
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.block-row {
  position: relative;
  border-radius: 4px;
}
.block-content {
  position: relative;
}
.end-area {
  min-height: 80px;
}
.a4-paper :deep(.paragraph-block) {
  font-size: 16px;
  line-height: 1.8;
  margin: 12px 0;
}
.a4-paper :deep(.heading-block) {
  font-size: 24px;
  margin: 24px 0 12px;
}
.a4-paper :deep(.list-block) {
  font-size: 16px;
  line-height: 1.8;
}
.a4-paper :deep(.quote-block) {
  font-size: 16px;
  padding: 12px 20px;
  border-left: 4px solid var(--primary);
  background: var(--secondary);
}
.a4-paper :deep(.code-block) {
  font-size: 14px;
}
.empty-hint {
  text-align: center;
  color: var(--muted-foreground);
  padding: 40px;
  font-size: 14px;
}

/* ===== 底部控制栏 ===== */
.bottom-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  padding: 16px 24px 20px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.bottom-controls.hidden {
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
}

.snapshot-info {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
.label-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  transition: background 0.15s;
  cursor: pointer;
  max-width: 50vw;
}
.label-wrapper.hovered {
  background: rgba(255, 255, 255, 0.08);
}
.label-display {
  display: flex;
  align-items: center;
  gap: 8px;
}
.label-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: 2px;
}
.label-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.edit-icon {
  opacity: 0.6;
  flex-shrink: 0;
}

/* 里程碑复选框 */
.milestone-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  user-select: none;
}
.milestone-check input[type="checkbox"] {
  width: 12px;
  height: 12px;
  cursor: pointer;
  accent-color: var(--primary, #3b82f6);
}

/* 编辑模式 */
.label-edit {
  display: flex;
  align-items: center;
  gap: 6px;
}
.edit-input {
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: 12px;
  font-family: inherit;
  width: 220px;
}
.edit-input:focus {
  outline: none;
  border-color: var(--primary, #3b82f6);
}
.edit-ok,
.edit-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;
}
.edit-ok {
  background: rgba(34, 197, 94, 0.3);
}
.edit-ok:hover {
  background: rgba(34, 197, 94, 0.5);
}
.edit-cancel {
  background: rgba(239, 68, 68, 0.3);
}
.edit-cancel:hover {
  background: rgba(239, 68, 68, 0.5);
}
.info-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  padding-top: 6px;
}

/* 时间轴 */
.timeline {
  position: relative;
  height: 20px;
  margin-bottom: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.timeline:hover .timeline-track,
.timeline.dragging .timeline-track {
  height: 6px;
}
.timeline:hover .timeline-progress,
.timeline.dragging .timeline-progress {
  height: 6px;
}
.timeline:hover .timeline-thumb,
.timeline.dragging .timeline-thumb {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.timeline-track {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  transform: translateY(-50%);
  transition: height 0.15s ease;
}
.timeline-progress {
  position: absolute;
  top: 50%;
  left: 0;
  height: 4px;
  background: #fff;
  border-radius: 2px;
  transform: translateY(-50%);
  transition: width 0.1s ease, height 0.15s ease;
}
.timeline-thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0.6);
  opacity: 0;
  transition: all 0.15s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
.timeline-marker {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  transform: translate(-50%, -50%);
  transition: all 0.15s;
  cursor: pointer;
  z-index: 2;
}
.timeline-marker:hover {
  background: #fff;
  transform: translate(-50%, -50%) scale(1.4);
}
.timeline-marker.manual {
  background: #f59e0b;
}
.timeline-marker.milestone {
  background: var(--primary, #3b82f6);
  width: 8px;
  height: 8px;
}
.timeline-marker.active {
  background: #fff;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
}

/* 控制按钮 */
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;
}
.ctrl-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(1.05);
}
.ctrl-btn:active:not(:disabled) {
  transform: scale(0.95);
}
.ctrl-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.ctrl-btn.play {
  width: 52px;
  height: 52px;
  background: #fff;
  color: #000;
}
.ctrl-btn.play:hover {
  background: rgba(255, 255, 255, 0.9);
  transform: scale(1.08);
}
.speed-btn {
  position: absolute;
  right: 24px;
  bottom: 26px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: all 0.15s;
}
.speed-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
