<script setup lang="ts">
/**
 * 分页标记 Block
 * 参考 PRD §11.2 / §11.4 / §12.1:page_break 在编辑态显示为虚线分隔
 * 演示模式下作为幻灯片边界
 * 右键菜单:替换回分隔符(单条/全部),与 DividerBlock 对称
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { Block } from '@/core/blocks/types'
import { useDocumentStore } from '@/stores/document'
import { createDividerBlock } from '@/core/blocks/factory'

const props = defineProps<{ block: Block }>()
const doc = useDocumentStore()

const contextMenu = ref<{ visible: boolean; x: number; y: number }>({
  visible: false,
  x: 0,
  y: 0
})

function onContextmenu(e: MouseEvent) {
  e.preventDefault()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

/** 全局关闭:capture 阶段触发,避免被块组件 stopPropagation 吞掉;菜单内点击不关闭 */
function handleOutside(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target && target.closest('.divider-context-menu')) return
  closeContextMenu()
}

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') closeContextMenu()
}

function replaceCurrent() {
  const d = createDividerBlock()
  doc.updateBlock(props.block.id, { type: 'divider', content: d.content, props: d.props }, '替换为分隔符')
  closeContextMenu()
}

function replaceAll() {
  const tab = doc.openTabs.find((t) => t.id === doc.activeTabId)
  if (!tab) return
  const d = createDividerBlock()
  const updatedBlocks = tab.blocks.map((b) => {
    if (b.type === 'page_break') {
      return { ...b, type: 'divider' as const, content: d.content, props: d.props, updated_at: new Date().toISOString() }
    }
    return b
  })
  tab.blocks = updatedBlocks
  tab.savedStatus = 'unsaved'
  tab.meta.updated_at = new Date().toISOString()
  tab.history.push(tab.blocks, '全部替换为分隔符')
  closeContextMenu()
}

onMounted(() => {
  window.addEventListener('click', handleOutside, true)
  window.addEventListener('contextmenu', handleOutside, true)
  window.addEventListener('keydown', handleEsc)
})
onUnmounted(() => {
  window.removeEventListener('click', handleOutside, true)
  window.removeEventListener('contextmenu', handleOutside, true)
  window.removeEventListener('keydown', handleEsc)
})
</script>

<template>
  <div class="page-break" @contextmenu="onContextmenu">
    <div class="line"></div>
    <span class="label">--- 分页 ---</span>
    <div class="line"></div>

    <!-- 右键上下文菜单(复用 DividerBlock 的全局 .divider-context-menu 样式) -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="divider-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button class="menu-item" @click="replaceCurrent">替换为分隔符</button>
        <button class="menu-item" @click="replaceAll">全部替换为分隔符</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page-break {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 24px 0;
  padding: 12px 0;
  cursor: context-menu;
  position: relative;
}
.line {
  flex: 1;
  border-top: 2px dashed var(--brand-300);
  opacity: 0.5;
}
.label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--brand-500);
}
</style>
