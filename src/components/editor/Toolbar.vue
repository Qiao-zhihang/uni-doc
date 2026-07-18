<script setup lang="ts">
/**
 * 工具栏
 * 参考 PRD §10.1(布局结构)和 §10.4(快捷键体系)
 * 含:格式化、标题下拉、插入工具、撤销重做、源码/可视化切换
 */
import { computed, ref } from 'vue'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  ChevronDown,
  Image,
  Table,
  Code,
  SeparatorHorizontal,
  Undo2,
  Redo2,
  Eye,
  Code2,
  List,
  ListOrdered,
  ListChecks,
  Save,
  Plus,
  Presentation,
  Film,
  Flag,
  Play,
  Settings,
  X
} from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import { useReplayStore } from '@/stores/replay'
import type { BlockType, ListType } from '@/core/blocks/types'

const emit = defineEmits<{ (e: 'presentation'): void; (e: 'replay'): void }>()

const replay = useReplayStore()

const doc = useDocumentStore()
const editor = useEditorStore()

const showHeadingMenu = ref(false)
const showInsertMenu = ref(false)
const showHistoryMenu = ref(false)
const showReplaySettings = ref(false)
const milestoneAnimating = ref(false)

/** 是否有活动文档(无文档时编辑类按钮禁用) */
const hasActiveTab = computed(() => doc.activeTabId !== '')

/** 当前文档文件名（用于设置弹窗提示） */
const historyFileName = computed(() => {
  const path = doc.activeTabPath
  if (!path) return ''
  const name = path.split('/').pop() || path.split('\\').pop() || path
  return `${name}.history.json`
})

const headingOptions = [
  { label: '正文', type: 'paragraph' as BlockType },
  { label: '标题 1', type: 'heading' as BlockType, level: 1 },
  { label: '标题 2', type: 'heading' as BlockType, level: 2 },
  { label: '标题 3', type: 'heading' as BlockType, level: 3 },
  { label: '标题 4', type: 'heading' as BlockType, level: 4 },
  { label: '标题 5', type: 'heading' as BlockType, level: 5 },
  { label: '标题 6', type: 'heading' as BlockType, level: 6 }
]

const selectedBlock = computed(() => {
  if (!editor.selectedBlockId) return null
  return doc.blocks.find((b) => b.id === editor.selectedBlockId) ?? null
})

const currentTypeLabel = computed(() => {
  const b = selectedBlock.value
  if (!b) return '正文'
  if (b.type === 'heading') {
    return `标题 ${(b.props as { level: number }).level}`
  }
  return '正文'
})

function toggleHeadingMenu() {
  showHeadingMenu.value = !showHeadingMenu.value
  showInsertMenu.value = false
}

function toggleInsertMenu() {
  showInsertMenu.value = !showInsertMenu.value
  showHeadingMenu.value = false
  showHistoryMenu.value = false
}

function toggleHistoryMenu() {
  showHistoryMenu.value = !showHistoryMenu.value
  showHeadingMenu.value = false
  showInsertMenu.value = false
}

function closeMenus() {
  showHeadingMenu.value = false
  showInsertMenu.value = false
  showHistoryMenu.value = false
}

function convertTo(opt: { type: BlockType; level?: number }) {
  const id = editor.selectedBlockId
  if (!id) {
    // 无选中时追加
    const newId = doc.appendBlock(opt.type)
    editor.selectBlock(newId)
    if (opt.type === 'heading' && opt.level) {
      doc.updateBlock(newId, { props: { level: opt.level, align: 'left' } }, '设置标题级别')
    }
  } else {
    doc.convertBlock(id, opt.type, '转换区块类型')
    if (opt.type === 'heading' && opt.level) {
      doc.updateBlock(id, { props: { level: opt.level, align: 'left' } }, '设置标题级别')
    }
  }
  closeMenus()
}

function insertAfter(type: BlockType, listType?: ListType) {
  const id = editor.selectedBlockId
  const newId = doc.insertBlockAfter(id, type, `插入${type}`, listType)
  editor.selectBlock(newId)
  closeMenus()
}

function toggleMark(markType: 'bold' | 'italic' | 'underline' | 'strikethrough') {
  const b = selectedBlock.value
  if (!b || (b.type !== 'paragraph' && b.type !== 'heading')) return
  const content = b.content as { text: string; marks: { type: string; start: number; end: number }[] }
  const marks = content.marks ?? []
  // M1 简化:对全文应用标记(无选区时)
  if (content.text.length === 0) return
  const existing = marks.find((m) => m.type === markType)
  if (existing) {
    doc.updateBlock(b.id, {
      content: { text: content.text, marks: marks.filter((m) => m !== existing) }
    }, `取消${markType}`)
  } else {
    doc.updateBlock(b.id, {
      content: {
        text: content.text,
        marks: [...marks, { type: markType, start: 0, end: content.text.length }]
      }
    }, `应用${markType}`)
  }
}

function onUndo() {
  doc.undo()
}
function onRedo() {
  doc.redo()
}

function handleMarkMilestone() {
  if (!replay.config.enabled) return
  replay.markMilestone('里程碑')
  milestoneAnimating.value = true
  setTimeout(() => { milestoneAnimating.value = false }, 800)
}

function openReplaySettings() {
  showReplaySettings.value = true
  showHistoryMenu.value = false
}

function closeReplaySettings() {
  showReplaySettings.value = false
}

function handleEnterReplay() {
  if (!replay.hasSnapshots) return
  closeMenus()
  emit('replay')
}
</script>

<template>
  <div class="toolbar no-scrollbar" @click="closeMenus">
    <!-- 格式化组 -->
    <div class="group" @click.stop>
      <button class="tool-btn" title="加粗" :disabled="!hasActiveTab" @click="toggleMark('bold')">
        <Bold :size="16" />
      </button>
      <button class="tool-btn" title="斜体" :disabled="!hasActiveTab" @click="toggleMark('italic')">
        <Italic :size="16" />
      </button>
      <button class="tool-btn" title="下划线" :disabled="!hasActiveTab" @click="toggleMark('underline')">
        <Underline :size="16" />
      </button>
      <button class="tool-btn" title="删除线" :disabled="!hasActiveTab" @click="toggleMark('strikethrough')">
        <Strikethrough :size="16" />
      </button>
    </div>

    <div class="divider"></div>

    <!-- 标题下拉 -->
    <div class="heading-select" @click.stop>
      <button class="select-btn" :disabled="!hasActiveTab" @click="toggleHeadingMenu">
        <span>{{ currentTypeLabel }}</span>
        <ChevronDown :size="12" />
      </button>
      <div v-if="showHeadingMenu && hasActiveTab" class="menu">
        <button
          v-for="opt in headingOptions"
          :key="opt.label"
          class="menu-item"
          @click="convertTo(opt)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div class="divider"></div>

    <!-- 列表组 -->
    <div class="group" @click.stop>
      <button class="tool-btn" title="无序列表" :disabled="!hasActiveTab" @click="insertAfter('list', 'bullet')">
        <List :size="16" />
      </button>
      <button class="tool-btn" title="有序列表" :disabled="!hasActiveTab" @click="insertAfter('list', 'ordered')">
        <ListOrdered :size="16" />
      </button>
      <button class="tool-btn" title="任务列表" :disabled="!hasActiveTab" @click="insertAfter('list', 'task')">
        <ListChecks :size="16" />
      </button>
    </div>

    <div class="divider"></div>

    <!-- 插入下拉 -->
    <div class="heading-select" @click.stop>
      <button class="select-btn" :disabled="!hasActiveTab" @click="toggleInsertMenu">
        <Plus :size="14" />
        <span>插入</span>
        <ChevronDown :size="12" />
      </button>
      <div v-if="showInsertMenu && hasActiveTab" class="menu">
        <button class="menu-item" @click="insertAfter('image')">
          <Image :size="14" /> 图片
        </button>
        <button class="menu-item" @click="insertAfter('table')">
          <Table :size="14" /> 表格
        </button>
        <button class="menu-item" @click="insertAfter('code_block')">
          <Code :size="14" /> 代码块
        </button>
        <button class="menu-item" @click="insertAfter('quote')">
          <SeparatorHorizontal :size="14" /> 引用
        </button>
        <button class="menu-item" @click="insertAfter('divider')">
          <SeparatorHorizontal :size="14" /> 分割线
        </button>
        <button class="menu-item" @click="insertAfter('page_break')">
          <SeparatorHorizontal :size="14" /> 分页符
        </button>
      </div>
    </div>

    <div class="spacer"></div>

    <!-- 撤销重做 -->
    <div class="group" @click.stop>
      <button
        class="tool-btn"
        :class="{ disabled: !doc.canUndo() }"
        :disabled="!doc.canUndo()"
        title="撤销(Ctrl+Z)"
        @click="onUndo"
      >
        <Undo2 :size="16" />
      </button>
      <button
        class="tool-btn"
        :class="{ disabled: !doc.canRedo() }"
        :disabled="!doc.canRedo()"
        title="重做(Ctrl+Shift+Z)"
        @click="onRedo"
      >
        <Redo2 :size="16" />
      </button>
    </div>

    <div class="divider"></div>

    <!-- 文件操作 -->
    <div class="group" @click.stop>
      <button class="tool-btn" title="保存为 .md(Ctrl+S)" :disabled="!hasActiveTab" @click="doc.saveToFile()">
        <Save :size="16" />
      </button>
    </div>

    <div class="divider"></div>

    <!-- 历史菜单 -->
    <div class="history-select" @click.stop>
      <button
        class="history-btn"
        :disabled="!hasActiveTab"
        :class="{ 'milestone-flash': milestoneAnimating }"
        @click="toggleHistoryMenu"
      >
        <Film :size="15" />
      </button>
      <div v-if="showHistoryMenu && hasActiveTab" class="menu history-menu">
        <button
          class="menu-item"
          :class="{ disabled: !replay.config.enabled }"
          :disabled="!replay.config.enabled"
          @click="handleMarkMilestone"
        >
          <Flag :size="14" :class="{ 'flag-bounce': milestoneAnimating }" />
          <span>标记里程碑</span>
          <span class="menu-shortcut">Ctrl+M</span>
        </button>
        <button
          class="menu-item"
          :class="{ disabled: !replay.hasSnapshots }"
          :disabled="!replay.hasSnapshots"
          @click="handleEnterReplay"
        >
          <Play :size="14" />
          <span>文档回放</span>
          <span class="menu-shortcut">F6</span>
        </button>
        <div class="menu-divider"></div>
        <button class="menu-item" @click="openReplaySettings">
          <Settings :size="14" />
          <span>回放设置</span>
        </button>
      </div>
    </div>

    <div class="divider"></div>

    <!-- 模式切换 -->
    <button class="mode-btn" :disabled="!hasActiveTab" @click.stop="editor.toggleMode()">
      <Code2 v-if="editor.mode === 'visual'" :size="14" />
      <Eye v-else :size="14" />
      <span>{{ editor.mode === 'visual' ? '编辑' : '阅读' }}</span>
    </button>

    <div class="divider"></div>

    <!-- 演示模式 -->
    <button
      class="mode-btn"
      :disabled="!hasActiveTab"
      title="演示模式(F5)"
      @click.stop="emit('presentation')"
    >
      <Presentation :size="14" />
      <span>演示</span>
    </button>
  </div>

  <!-- 回放设置弹窗 -->
  <transition name="modal-fade">
    <div v-if="showReplaySettings" class="replay-settings-modal" @click="closeReplaySettings">
      <div class="replay-settings-card" @click.stop>
        <div class="settings-header">
          <span>回放设置</span>
          <button class="close-btn" @click="closeReplaySettings">
            <X :size="16" />
          </button>
        </div>
        <div class="settings-body">
          <div class="setting-row">
            <label>启用快照采集</label>
            <button
              class="toggle-btn"
              :class="{ on: replay.config.enabled }"
              @click="replay.updateConfig({ enabled: !replay.config.enabled })"
            >
              {{ replay.config.enabled ? '已开启' : '已关闭' }}
            </button>
          </div>
          <div class="setting-row">
            <label>自动快照间隔</label>
            <div class="interval-input">
              <input
                type="number"
                min="0"
                max="3600"
                :value="replay.config.autoIntervalSec"
                @change="replay.updateConfig({ autoIntervalSec: Math.max(0, parseInt(($event.target as HTMLInputElement).value) || 0) })"
              />
              <span class="unit">秒 (0=不自动)</span>
            </div>
          </div>
          <div class="settings-footer">
            共 {{ replay.snapshotCount }} 个快照 · 配置以「{{ historyFileName }}」保存在文档同目录
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
  padding: 0 12px;
  flex-shrink: 0;
  overflow: visible;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
.group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--foreground);
}
.tool-btn:hover:not(.disabled):not(:disabled) {
  background: var(--secondary);
}
.tool-btn.disabled,
.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--border);
  flex-shrink: 0;
}
.spacer {
  flex: 1;
}
.heading-select {
  position: relative;
  flex-shrink: 0;
}
.select-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--secondary);
  color: var(--foreground);
}
.select-btn:hover:not(:disabled) {
  background: var(--muted);
}
.select-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.menu {
  position: absolute;
  top: 32px;
  left: 0;
  z-index: 50;
  min-width: 120px;
  padding: 4px;
  border-radius: 8px;
  background: var(--popover);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  text-align: left;
  color: var(--popover-foreground);
}
.menu-item:hover:not(.disabled):not(:disabled) {
  background: var(--accent);
}
.menu-item.disabled,
.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.mode-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--primary);
  color: var(--primary-foreground);
  flex-shrink: 0;
}
.mode-btn:hover:not(:disabled) {
  filter: brightness(0.96);
}
.mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 历史菜单 */
.history-select {
  position: relative;
  flex-shrink: 0;
}
.history-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--foreground);
  background: transparent;
  transition: all 0.15s;
}
.history-btn:hover:not(:disabled) {
  background: var(--secondary);
}
.history-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.history-btn.milestone-flash {
  animation: flash 0.6s ease;
}
@keyframes flash {
  0% { background: var(--primary); color: var(--primary-foreground); }
  100% { background: transparent; color: var(--foreground); }
}
.history-menu {
  right: 0;
  left: auto;
  min-width: 160px;
}
.menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}
.menu-shortcut {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
}
.flag-bounce {
  animation: flagBounce 0.6s ease;
}
@keyframes flagBounce {
  0%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px) scale(1.1); }
  60% { transform: translateY(1px); }
}

/* 回放设置弹窗 */
.replay-settings-modal {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
}
.replay-settings-card {
  width: 360px;
  max-width: 90vw;
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  font-weight: 600;
}
.close-btn {
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
.close-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.settings-body {
  padding: 16px;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  font-size: 13px;
}
.setting-row + .setting-row {
  border-top: 1px solid var(--border);
}
.toggle-btn {
  padding: 5px 14px;
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
  gap: 6px;
}
.interval-input input {
  width: 56px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  color: var(--foreground);
  font-size: 12px;
  font-family: var(--font-mono);
  text-align: center;
}
.interval-input input:focus {
  outline: none;
  border-color: var(--primary);
}
.unit {
  font-size: 11px;
  color: var(--muted-foreground);
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
  background: var(--secondary);
}
.speed-option.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.settings-footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted-foreground);
  text-align: center;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: all 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-from .replay-settings-card,
.modal-fade-leave-to .replay-settings-card {
  transform: scale(0.95);
  opacity: 0;
}
</style>
