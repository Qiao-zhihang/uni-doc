<script setup lang="ts">
/**
 * 分隔线 Block
 * 参考 PRD §11.2 / §11.4:divider 无内容,Markdown 序列化为 ---
 * 右键菜单:替换为分页符(单条/全部)
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { Block } from '@/core/blocks/types'
import { useDocumentStore } from '@/stores/document'
import { createPageBreakBlock } from '@/core/blocks/factory'

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

function replaceCurrent() {
  doc.updateBlock(props.block.id, { type: 'page_break', content: createPageBreakBlock().content, props: createPageBreakBlock().props }, '替换为分页符')
  closeContextMenu()
}

function replaceAll() {
  const tab = doc.openTabs.find((t) => t.id === doc.activeTabId)
  if (!tab) return
  const pb = createPageBreakBlock()
  const updatedBlocks = tab.blocks.map((b) => {
    if (b.type === 'divider') {
      return { ...b, type: 'page_break' as const, content: pb.content, props: pb.props, updated_at: new Date().toISOString() }
    }
    return b
  })
  tab.blocks = updatedBlocks
  tab.savedStatus = 'unsaved'
  tab.meta.updated_at = new Date().toISOString()
  tab.history.push(tab.blocks, '全部替换为分页符')
  // 显式触发自动保存:replaceAll 绕过 store.commit,需手动调度
  doc.scheduleAutoSave(tab.id)
  closeContextMenu()
}

onMounted(() => {
  // capture 阶段:先于目标元素处理,不受 stopPropagation 影响
  window.addEventListener('click', handleOutside, true)
  // 右键他处也关闭当前菜单(新目标的 contextmenu 仍正常打开)
  window.addEventListener('contextmenu', handleOutside, true)
  // Esc 关闭
  window.addEventListener('keydown', handleEsc)
})
onUnmounted(() => {
  window.removeEventListener('click', handleOutside, true)
  window.removeEventListener('contextmenu', handleOutside, true)
  window.removeEventListener('keydown', handleEsc)
})

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') closeContextMenu()
}
</script>

<template>
  <div class="divider-block" @contextmenu="onContextmenu">
    <hr />

    <!-- 右键上下文菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="divider-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button class="menu-item" @click="replaceCurrent">替换为分页符</button>
        <button class="menu-item" @click="replaceAll">全部替换为分页符</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.divider-block {
  margin: 12px 0;
  padding: 12px 0;
  cursor: context-menu;
  position: relative;
}
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0;
}
</style>

<style>
/* 右键菜单(非 scoped,因为 Teleport 到 body) */
.divider-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  padding: 4px 0;
  background: var(--popover, #fff);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-family: var(--font-sans, system-ui);
  font-size: 13px;
}
.divider-context-menu .menu-item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  color: var(--foreground, #333);
  font-family: inherit;
  font-size: inherit;
}
.divider-context-menu .menu-item:hover {
  background: var(--secondary, #f5f5f5);
}
</style>
