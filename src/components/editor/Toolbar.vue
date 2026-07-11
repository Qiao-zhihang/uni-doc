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
  FolderOpen,
  Plus,
  Presentation
} from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import type { BlockType } from '@/core/blocks/types'

const emit = defineEmits<{ (e: 'presentation'): void }>()

const doc = useDocumentStore()
const editor = useEditorStore()

const showHeadingMenu = ref(false)
const showInsertMenu = ref(false)

/** 是否有活动文档(无文档时编辑类按钮禁用) */
const hasActiveTab = computed(() => doc.activeTabId !== '')

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
}

function closeMenus() {
  showHeadingMenu.value = false
  showInsertMenu.value = false
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

function insertAfter(type: BlockType) {
  const id = editor.selectedBlockId
  const newId = doc.insertBlockAfter(id, type, `插入${type}`)
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
      <button class="tool-btn" title="无序列表" :disabled="!hasActiveTab" @click="insertAfter('list')">
        <List :size="16" />
      </button>
      <button class="tool-btn" title="有序列表" :disabled="!hasActiveTab" @click="insertAfter('list')">
        <ListOrdered :size="16" />
      </button>
      <button class="tool-btn" title="任务列表" :disabled="!hasActiveTab" @click="insertAfter('list')">
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
      <button class="tool-btn" title="打开 .md" @click="doc.openFromFile()">
        <FolderOpen :size="16" />
      </button>
      <button class="tool-btn" title="保存为 .md(Ctrl+S)" :disabled="!hasActiveTab" @click="doc.saveToFile()">
        <Save :size="16" />
      </button>
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
</style>
