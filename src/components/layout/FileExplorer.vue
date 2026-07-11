<script setup lang="ts">
/**
 * 文件浏览器(改造版)
 * 参考 UI 改造方案 §3.2.B 和设计稿 file-explorer.html
 * 220px 宽,接入真实 vault 文件系统
 *
 * 状态:
 *   - 无 vault:显示"打开文件夹"按钮
 *   - 有 vault 但无 .md:显示"新建文件"按钮
 *   - 有文件:显示文件树
 *
 * 交互:
 *   - 单击文件:打开(开新 tab)
 *   - 单击文件夹:展开/折叠
 *   - 右键:重命名/删除/复制路径
 *   - 顶部 + 按钮:新建文件/文件夹
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  FilePlus,
  FolderOpen,
  RefreshCw,
  Pencil,
  Trash2,
  Copy,
  Library
} from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import ContextMenu, { type MenuItem } from '@/components/common/ContextMenu.vue'
import VaultTreeNode from '@/components/layout/VaultTreeNode.vue'
import VaultManagerDialog from '@/components/common/VaultManagerDialog.vue'
import { confirmDialog, promptDialog } from '@/composables/useDialog'
import {
  pickVaultFolder,
  readVaultTree,
  renameVaultEntry,
  deleteVaultEntry,
  createVaultFile,
  copyPathToClipboard,
  type VaultNode
} from '@/core/vault/vault'

const doc = useDocumentStore()

const tree = ref<VaultNode[]>([])
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const showVaultManager = ref(false)

// 展开/折叠状态(用 path 作为 key)
const expanded = ref<Set<string>>(new Set())

// 右键菜单
const menu = ref<{ visible: boolean; x: number; y: number; node: VaultNode | null }>({
  visible: false,
  x: 0,
  y: 0,
  node: null
})

const hasVault = computed(() => doc.vaultRoot !== null)
const isEmpty = computed(() => hasVault.value && tree.value.length === 0)
// 高亮规则:只有当前激活 tab 对应的文件高亮(而非所有已打开的 tab)
const openedPaths = computed(() => {
  const activeTab = doc.openTabs.find((t) => t.id === doc.activeTabId)
  return new Set(activeTab?.path ? [activeTab.path] : [])
})

/** 选择并加载 vault */
async function selectVault() {
  loading.value = true
  errorMsg.value = null
  try {
    const root = await pickVaultFolder()
    if (!root) {
      loading.value = false
      return
    }
    doc.setVaultRoot(root)
    await refreshTree()
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    loading.value = false
  }
}

/** 监听 vaultRoot 变化,自动刷新文件树(仓库切换时触发) */
watch(
  () => doc.vaultRoot,
  (newRoot: string | null) => {
    if (newRoot) {
      void refreshTree()
    } else {
      tree.value = []
      expanded.value = new Set()
    }
  }
)

/** 组件挂载时若已有 vaultRoot(如从设置返回),自动重新加载文件树 */
onMounted(() => {
  if (doc.vaultRoot && tree.value.length === 0) {
    void refreshTree()
  }
})

/** 重新扫描 vault */
async function refreshTree() {
  if (!doc.vaultRoot) return
  loading.value = true
  errorMsg.value = null
  try {
    const data = await readVaultTree(doc.vaultRoot)
    tree.value = data
    // 同步到 store,供 wikilink 等功能使用
    doc.vaultTree.splice(0, doc.vaultTree.length, ...data)
    // 默认展开所有文件夹,让用户立刻看到完整文件树
    expanded.value = collectAllDirPaths(data)
  } catch (e) {
    errorMsg.value = String(e)
    tree.value = []
  } finally {
    loading.value = false
  }
}

/** 递归收集所有文件夹 path,用于默认展开 */
function collectAllDirPaths(nodes: VaultNode[]): Set<string> {
  const paths = new Set<string>()
  function walk(arr: VaultNode[]) {
    for (const n of arr) {
      if (n.isDir) {
        paths.add(n.path)
        if (n.children) walk(n.children)
      }
    }
  }
  walk(nodes)
  return paths
}

/** 切换文件夹展开/折叠(用 path 作为 key) */
function toggleExpandByPath(path: string) {
  // reassign Set 触发响应式更新
  const next = new Set(expanded.value)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  expanded.value = next
}

/** 打开文件(开新 tab) */
function onOpenFile(path: string) {
  doc.openVaultFile(path)
}

function onContextmenu(e: MouseEvent, node: VaultNode) {
  e.preventDefault()
  e.stopPropagation()
  menu.value = { visible: true, x: e.clientX, y: e.clientY, node }
}

const menuItems = computed<MenuItem[]>(() => {
  const node = menu.value.node
  if (!node) return []
  const items: MenuItem[] = []
  if (!node.isDir) {
    items.push({ key: 'open', label: '打开' })
    items.push({ type: 'separator' })
  }
  items.push({ key: 'rename', label: '重命名', icon: Pencil })
  items.push({ key: 'copy-path', label: '复制路径', icon: Copy })
  if (node.isDir) {
    items.push({ type: 'separator' })
    items.push({ key: 'new-file', label: '在此处新建文件', icon: FilePlus })
  }
  items.push({ type: 'separator' })
  items.push({ key: 'delete', label: '删除', icon: Trash2, danger: true })
  return items
})

async function onMenuSelect(key: string) {
  const node = menu.value.node
  if (!node || !doc.vaultRoot) return
  switch (key) {
    case 'open':
      if (!node.isDir) doc.openVaultFile(node.path)
      break
    case 'rename':
      await renameNode(node)
      break
    case 'copy-path':
      await copyPathToClipboard(doc.vaultRoot, node.path)
      break
    case 'new-file':
      await newFileInDir(node.path)
      break
    case 'delete':
      await deleteNode(node)
      break
  }
  menu.value.visible = false
}

async function renameNode(node: VaultNode) {
  const newName = await promptDialog('重命名为:', node.name, '重命名')
  if (!newName || newName === node.name) return
  const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
  const newPath = parent ? `${parent}/${newName}` : newName
  try {
    await renameVaultEntry(doc.vaultRoot!, node.path, newPath)
    // 同步更新已打开 tab 的 path
    const tab = doc.openTabs.find((t) => t.path === node.path)
    if (tab) tab.path = newPath
    await refreshTree()
  } catch (e) {
    await confirmDialog('重命名失败: ' + String(e), '错误')
  }
}

async function deleteNode(node: VaultNode) {
  const ok = await confirmDialog(`确认删除 "${node.name}"?`, '删除确认')
  if (!ok) return
  try {
    await deleteVaultEntry(doc.vaultRoot!, node.path)
    // 关闭对应 tab(如果开着)
    const tab = doc.openTabs.find((t) => t.path === node.path)
    if (tab) doc.closeTab(tab.id)
    await refreshTree()
  } catch (e) {
    await confirmDialog('删除失败: ' + String(e), '错误')
  }
}

async function newFileInDir(dirPath: string) {
  const name = await promptDialog('新文件名(含 .md 扩展名):', '新文件.md', '新建文件')
  if (!name) return
  const rel = dirPath ? `${dirPath}/${name}` : name
  try {
    await createVaultFile(doc.vaultRoot!, rel, `# ${name.replace(/\.md$/i, '')}\n`)
    await refreshTree()
    await doc.openVaultFile(rel)
  } catch (e) {
    await confirmDialog('新建文件失败: ' + String(e), '错误')
  }
}

async function newFileAtRoot() {
  if (!doc.vaultRoot) return
  const name = await promptDialog('新文件名(含 .md 扩展名):', '新文件.md', '新建文件')
  if (!name) return
  try {
    await createVaultFile(doc.vaultRoot, name, `# ${name.replace(/\.md$/i, '')}\n`)
    await refreshTree()
    await doc.openVaultFile(name)
  } catch (e) {
    await confirmDialog('新建文件失败: ' + String(e), '错误')
  }
}

function closeMenu() {
  menu.value.visible = false
}
</script>

<template>
  <aside class="file-explorer">
    <!-- 标题栏 -->
    <div class="header">
      <span class="title">
        {{ hasVault ? (doc.vaultRoot?.split(/[\\/]/).pop() ?? 'vault') : 'uni-doc' }}
      </span>
      <div class="actions" v-if="hasVault">
        <button class="icon-btn" title="新建文件" @click="newFileAtRoot">
          <FilePlus :size="14" />
        </button>
        <button class="icon-btn" title="刷新" @click="refreshTree">
          <RefreshCw :size="14" />
        </button>
      </div>
    </div>

    <!-- 无 vault 空状态 -->
    <div v-if="!hasVault" class="empty-state">
      <FolderOpen :size="36" class="empty-icon" />
      <div class="empty-title">未选择 Vault</div>
      <div class="empty-desc">选择一个文件夹作为文档库根目录</div>
      <button class="empty-btn" :disabled="loading" @click="selectVault">
        <FolderOpen :size="14" />
        <span>{{ loading ? '加载中...' : '打开文件夹' }}</span>
      </button>
    </div>

    <!-- 有 vault 但无文件 -->
    <div v-else-if="isEmpty" class="empty-state">
      <FileText :size="36" class="empty-icon" />
      <div class="empty-title">Vault 为空</div>
      <div class="empty-desc">在该文件夹内未找到 .md 文件</div>
      <button class="empty-btn" @click="newFileAtRoot">
        <FilePlus :size="14" />
        <span>新建文件</span>
      </button>
    </div>

    <!-- 错误 -->
    <div v-else-if="errorMsg" class="empty-state">
      <div class="empty-title error">加载失败</div>
      <div class="empty-desc">{{ errorMsg }}</div>
      <button class="empty-btn" @click="selectVault">重新选择</button>
    </div>

    <!-- 文件树(递归,任意深度) -->
    <div v-else class="tree-wrap no-scrollbar" role="tree">
      <ul class="tree" role="tree">
        <VaultTreeNode
          v-for="node in tree"
          :key="node.path"
          :node="node"
          :depth="0"
          :expanded="expanded"
          :opened-paths="openedPaths"
          @toggle-expand="toggleExpandByPath"
          @open-file="onOpenFile"
          @contextmenu="onContextmenu"
        />
      </ul>
    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      v-if="menu.visible"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onMenuSelect"
      @close="closeMenu"
    />

    <!-- 底部固定:管理仓库按钮 -->
    <div class="vault-manager-bar" @click="showVaultManager = true">
      <Library :size="14" />
      <span class="vault-manager-text">管理仓库</span>
    </div>

    <!-- 仓库管理弹窗 -->
    <VaultManagerDialog v-if="showVaultManager" @close="showVaultManager = false" />
  </aside>
</template>

<style scoped>
.file-explorer {
  display: flex;
  flex-direction: column;
  width: var(--file-explorer-width);
  flex-shrink: 0;
  background: var(--sidebar);
  border-right: 1px solid var(--sidebar-border);
  user-select: none;
  position: relative;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--titlebar-height);
  padding: 0 8px 0 12px;
  flex-shrink: 0;
}
.title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}
.actions {
  display: flex;
  gap: 2px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-button);
  color: var(--muted-foreground);
}
.icon-btn:hover {
  background: var(--sidebar-accent);
  color: var(--sidebar-foreground);
}
.tree-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 4px 4px 12px;
}
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
}
.icon.folder {
  color: var(--muted-foreground);
}
.icon.file {
  color: var(--muted-foreground);
}
.node.active .icon {
  color: var(--brand-500);
}
.name {
  flex: 1;
  min-width: 0;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 8px;
  flex: 1;
  text-align: center;
}
.empty-icon {
  color: var(--muted-foreground);
  opacity: 0.5;
  margin-bottom: 4px;
}
.empty-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--sidebar-foreground);
}
.empty-title.error {
  color: var(--destructive);
}
.empty-desc {
  font-size: 11px;
  color: var(--muted-foreground);
  line-height: 1.5;
  margin-bottom: 8px;
}
.empty-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-button);
  font-size: 12px;
  background: var(--brand-500);
  color: var(--primary-foreground);
}
.empty-btn:hover:not(:disabled) {
  filter: brightness(0.96);
}
.empty-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* 底部管理仓库按钮 */
.vault-manager-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  flex-shrink: 0;
  border-top: 1px solid var(--sidebar-border);
  color: var(--muted-foreground);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.vault-manager-bar:hover {
  background: var(--sidebar-accent);
  color: var(--sidebar-foreground);
}
.vault-manager-text {
  font-weight: 500;
}
</style>
