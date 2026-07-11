/**
 * Vault 仓库管理 Store
 * 管理仓库列表、当前仓库、切换/新建/删除
 * 仓库列表持久化到 localStorage
 */
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useDocumentStore } from './document'
import { pickVaultFolder, createVaultDir } from '@/core/vault/vault'

export interface VaultEntry {
  /** 仓库根路径(绝对路径) */
  path: string
  /** 仓库名称(从路径末段提取) */
  name: string
  /** 最后打开时间(timestamp) */
  lastOpened: number
}

const STORAGE_KEY = 'uni-doc-vaults'

function loadVaults(): VaultEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as VaultEntry[]
  } catch {
    return []
  }
}

function saveVaults(vaults: VaultEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vaults))
}

export const useVaultStore = defineStore('vault', () => {
  const doc = useDocumentStore()

  /** 所有已注册的仓库列表 */
  const vaults = ref<VaultEntry[]>(loadVaults())

  /** 当前仓库路径(与 document store 的 vaultRoot 同步) */
  const currentVaultPath = computed(() => doc.vaultRoot)

  /** 当前仓库条目 */
  const currentVault = computed(() =>
    vaults.value.find((v) => v.path === currentVaultPath.value) ?? null
  )

  /** 添加一个仓库到列表(如果不存在) */
  function addVault(path: string, name?: string) {
    const existing = vaults.value.find((v) => v.path === path)
    if (existing) return existing
    const entry: VaultEntry = {
      path,
      name: name ?? path.split(/[\\/]/).pop() ?? 'vault',
      lastOpened: Date.now()
    }
    vaults.value.unshift(entry)
    saveVaults(vaults.value)
    return entry
  }

  /** 从列表中删除一个仓库(不删除磁盘文件) */
  function removeVault(path: string) {
    vaults.value = vaults.value.filter((v) => v.path !== path)
    saveVaults(vaults.value)
    // 如果删除的是当前仓库,关闭当前仓库
    if (currentVaultPath.value === path) {
      void doc.setVaultRoot(null)
    }
  }

  /** 切换到指定仓库 */
  async function switchVault(path: string) {
    const entry = vaults.value.find((v) => v.path === path)
    if (!entry) return
    entry.lastOpened = Date.now()
    // 重新排序:最近使用的在最前
    vaults.value.sort((a, b) => b.lastOpened - a.lastOpened)
    saveVaults(vaults.value)
    await doc.setVaultRoot(path)
  }

  /** 选择文件夹添加为仓库 */
  async function pickAndAddVault(): Promise<string | null> {
    const path = await pickVaultFolder()
    if (!path) return null
    const entry = addVault(path)
    await switchVault(entry.path)
    return entry.path
  }

  /** 新建仓库:选择父目录,创建子文件夹,添加到列表并切换 */
  async function createNewVault(): Promise<string | null> {
    // 选择父目录
    const parentPath = await pickVaultFolder()
    if (!parentPath) return null

    // 用 promptDialog 让用户输入仓库名
    const { promptDialog, confirmDialog } = await import('@/composables/useDialog')
    const name = await promptDialog('输入仓库名称:', '我的仓库', '新建仓库')
    if (!name) return null

    // 检查路径是否合法(不含特殊字符)
    if (/[<>:"|?*]/.test(name)) {
      await confirmDialog('仓库名称包含非法字符', '错误')
      return null
    }

    const fullPath = parentPath + '/' + name.replace(/[\\/]/g, '_')

    // 创建文件夹
    await createVaultDir(parentPath, name.replace(/[\\/]/g, '_'))

    const entry = addVault(fullPath, name)
    await switchVault(entry.path)
    return entry.path
  }

  return {
    vaults,
    currentVaultPath,
    currentVault,
    addVault,
    removeVault,
    switchVault,
    pickAndAddVault,
    createNewVault
  }
})
