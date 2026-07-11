<script setup lang="ts">
/**
 * 仓库管理对话框
 * 参考 Obsidian 的 vault switcher 逻辑:
 *   - 列出所有已注册仓库
 *   - 新建仓库(选择父目录 + 输入名称)
 *   - 打开已有文件夹作为仓库
 *   - 删除仓库(仅从列表移除,不删磁盘文件)
 *   - 切换到指定仓库
 */
import { ref } from 'vue'
import { FolderPlus, FolderOpen, Trash2, Check, Folder } from 'lucide-vue-next'
import { useVaultStore, type VaultEntry } from '@/stores/vault'
import { confirmDialog } from '@/composables/useDialog'

const vaultStore = useVaultStore()

const creating = ref(false)
const switching = ref(false)

/** 切换到指定仓库 */
async function onSwitch(vault: VaultEntry) {
  if (switching.value) return
  switching.value = true
  try {
    await vaultStore.switchVault(vault.path)
    emit('close')
  } catch (e) {
    await confirmDialog('打开仓库失败: ' + String(e), '错误')
  } finally {
    switching.value = false
  }
}

/** 打开文件夹添加为仓库 */
async function onOpenFolder() {
  if (creating.value) return
  creating.value = true
  try {
    const path = await vaultStore.pickAndAddVault()
    if (path) emit('close')
  } catch (e) {
    await confirmDialog('添加仓库失败: ' + String(e), '错误')
  } finally {
    creating.value = false
  }
}

/** 新建仓库 */
async function onCreateNew() {
  if (creating.value) return
  creating.value = true
  try {
    const path = await vaultStore.createNewVault()
    if (path) emit('close')
  } catch (e) {
    await confirmDialog('新建仓库失败: ' + String(e), '错误')
  } finally {
    creating.value = false
  }
}

/** 从列表中移除仓库 */
async function onRemove(vault: VaultEntry) {
  const ok = await confirmDialog(
    `从仓库列表中移除 "${vault.name}"?\n(不会删除磁盘上的文件)`,
    '移除仓库'
  )
  if (!ok) return
  vaultStore.removeVault(vault.path)
}

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <div class="dialog-mask" @pointerdown.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <span class="dialog-title">管理仓库</span>
        <button class="close-btn" @click="emit('close')">×</button>
      </div>

      <!-- 操作按钮 -->
      <div class="action-bar">
        <button class="action-btn" :disabled="creating" @click="onCreateNew">
          <FolderPlus :size="14" />
          <span>新建仓库</span>
        </button>
        <button class="action-btn" :disabled="creating" @click="onOpenFolder">
          <FolderOpen :size="14" />
          <span>打开文件夹</span>
        </button>
      </div>

      <!-- 仓库列表 -->
      <div class="vault-list no-scrollbar">
        <div v-if="vaultStore.vaults.length === 0" class="empty-vaults">
          <Folder :size="32" class="empty-icon" />
          <div class="empty-text">尚无仓库</div>
          <div class="empty-hint">点击上方按钮新建或打开仓库</div>
        </div>

        <div
          v-for="vault in vaultStore.vaults"
          :key="vault.path"
          class="vault-item"
          :class="{ active: vaultStore.currentVaultPath === vault.path }"
          @click="onSwitch(vault)"
        >
          <Folder :size="16" class="vault-icon" />
          <div class="vault-info">
            <div class="vault-name">{{ vault.name }}</div>
            <div class="vault-path">{{ vault.path }}</div>
          </div>
          <div class="vault-actions" @click.stop>
            <span v-if="vaultStore.currentVaultPath === vault.path" class="current-badge">
              <Check :size="12" />
              <span>当前</span>
            </span>
            <button class="remove-btn" title="从列表移除" @click="onRemove(vault)">
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  animation: mask-fade 0.12s ease;
}
@keyframes mask-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.dialog {
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: 520px;
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: dialog-pop 0.15s ease;
}
@keyframes dialog-pop {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
}
.dialog-title {
  font-size: 13px;
  font-weight: 600;
}
.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 16px;
  line-height: 1;
  border-radius: var(--radius-button);
  color: var(--muted-foreground);
}
.close-btn:hover {
  background: var(--accent);
  color: var(--foreground);
}
.action-bar {
  display: flex;
  gap: 8px;
  padding: 0 16px 12px;
  flex-shrink: 0;
}
.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-button);
  font-size: 12px;
  background: var(--secondary);
  color: var(--foreground);
  transition: background 0.12s ease;
}
.action-btn:hover:not(:disabled) {
  background: var(--accent);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.vault-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
}
.empty-vaults {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  gap: 6px;
}
.empty-icon {
  color: var(--muted-foreground);
  opacity: 0.4;
}
.empty-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted-foreground);
}
.empty-hint {
  font-size: 11px;
  color: var(--muted-foreground);
  opacity: 0.7;
}
.vault-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-button);
  cursor: pointer;
  transition: background 0.1s ease;
}
.vault-item:hover {
  background: var(--accent);
}
.vault-item.active {
  background: var(--brand-50, var(--accent));
}
.vault-icon {
  color: var(--muted-foreground);
  flex-shrink: 0;
}
.vault-info {
  flex: 1;
  min-width: 0;
}
.vault-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vault-path {
  font-size: 11px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}
.vault-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.current-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--brand-500);
  font-weight: 600;
}
.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-button);
  color: var(--muted-foreground);
  opacity: 0;
  transition: opacity 0.1s ease, background 0.1s ease;
}
.vault-item:hover .remove-btn {
  opacity: 1;
}
.remove-btn:hover {
  background: var(--destructive);
  color: white;
}
</style>
