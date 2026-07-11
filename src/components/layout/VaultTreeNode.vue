<script setup lang="ts">
/**
 * Vault 文件树递归节点
 * 渲染单个 VaultNode 及其所有子孙(任意深度)
 *
 * 用法:
 *   <VaultTreeNode
 *     :node="node"
 *     :depth="0"
 *     :expanded="expanded"
 *     :opened-paths="openedPaths"
 *     @toggle-expand="..."
 *     @open-file="..."
 *     @contextmenu="..."
 *   />
 */
import { computed } from 'vue'
import { Folder, FileText, ChevronRight } from 'lucide-vue-next'
import type { VaultNode } from '@/core/vault/vault'

// 递归组件需显式声明 name 才能在 template 中自引用
defineOptions({ name: 'VaultTreeNode' })

const props = defineProps<{
  node: VaultNode
  /** 当前深度(0=顶层),用于计算缩进 */
  depth: number
  /** 展开状态集合(用 path 作为 key) */
  expanded: Set<string>
  /** 已打开文件路径集合(用于高亮 active) */
  openedPaths: Set<string | null>
}>()

const emit = defineEmits<{
  (e: 'toggle-expand', path: string): void
  (e: 'open-file', path: string): void
  (e: 'contextmenu', event: MouseEvent, node: VaultNode): void
}>()

const isExpanded = computed(() => props.expanded.has(props.node.path))
const isActive = computed(
  () => !props.node.isDir && props.openedPaths.has(props.node.path)
)
const indentStyle = computed(() => ({
  paddingLeft: `${8 + props.depth * 20}px`
}))

function onClick() {
  if (props.node.isDir) {
    emit('toggle-expand', props.node.path)
  } else {
    emit('open-file', props.node.path)
  }
}

function onContextmenu(e: MouseEvent) {
  emit('contextmenu', e, props.node)
}

// 递归子节点事件转发
function onChildToggle(path: string) {
  emit('toggle-expand', path)
}
function onChildOpen(path: string) {
  emit('open-file', path)
}
function onChildContextmenu(e: MouseEvent, node: VaultNode) {
  emit('contextmenu', e, node)
}
</script>

<template>
  <li role="treeitem" :aria-expanded="node.isDir ? isExpanded : undefined">
    <div
      class="node"
      :class="{ 'is-dir': node.isDir, active: isActive }"
      :style="indentStyle"
      @click="onClick"
      @contextmenu="onContextmenu"
    >
      <ChevronRight
        v-if="node.isDir"
        :size="12"
        class="chevron"
        :class="{ expanded: isExpanded }"
      />
      <span v-else class="chevron-placeholder"></span>
      <Folder v-if="node.isDir" :size="14" class="icon folder" />
      <FileText v-else :size="14" class="icon file" />
      <span class="name truncate">{{ node.name }}</span>
    </div>

    <!-- 递归渲染子节点 -->
    <ul
      v-if="node.isDir && isExpanded && node.children && node.children.length"
      class="tree"
      role="group"
    >
      <VaultTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :expanded="expanded"
        :opened-paths="openedPaths"
        @toggle-expand="onChildToggle"
        @open-file="onChildOpen"
        @contextmenu="onChildContextmenu"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
.node {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding-right: 8px;
  border-radius: var(--radius-button);
  font-size: 13px;
  color: var(--sidebar-foreground);
  cursor: pointer;
  transition: background 0.12s ease;
}
.node:hover {
  background: var(--sidebar-accent);
}
.node.active {
  background: var(--sidebar-accent);
  color: var(--brand-500);
  font-weight: 500;
  box-shadow: inset 2px 0 0 0 var(--brand-500);
}
.chevron {
  flex-shrink: 0;
  color: var(--muted-foreground);
  transition: transform 0.15s ease;
}
.chevron.expanded {
  transform: rotate(90deg);
}
.chevron-placeholder {
  width: 12px;
  flex-shrink: 0;
}
.icon {
  flex-shrink: 0;
  color: var(--muted-foreground);
}
.node.active .icon {
  color: var(--brand-500);
}
.name {
  flex: 1;
  min-width: 0;
}
</style>
