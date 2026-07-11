/**
 * Vault 文件系统操作
 * 参考 PRD §8.2(架构分层)和 UI 改造方案 §3.2.B
 *
 * Vault = 一个本地文件夹,内部组织 .md 文件
 * 所有路径用 / 分隔(跨平台一致),由 Rust 端 join 到本地路径
 *
 * Tauri 环境走 Rust command;Web 环境返回 mock 数据用于开发预览
 */

import { isTauri } from '../serializer/markdownFile'

/** Vault 文件节点 */
export interface VaultNode {
  name: string
  /** 相对 vault 根的路径,用 / 分隔 */
  path: string
  isDir: boolean
  children?: VaultNode[]
}

/** 动态导入 Tauri invoke */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** 弹出文件夹选择器,返回用户选择的 vault 根绝对路径 */
export async function pickVaultFolder(): Promise<string | null> {
  if (!isTauri()) {
    // Web 开发环境:返回 mock 路径
    return 'mock-vault'
  }
  const result = await tauriInvoke<string | null>('pick_vault_folder')
  return result
}

/** 扫描 vault 目录树 */
export async function readVaultTree(rootPath: string): Promise<VaultNode[]> {
  if (!isTauri()) {
    return mockVaultTree()
  }
  return tauriInvoke<VaultNode[]>('read_vault_tree', { rootPath })
}

/** 读取 vault 内 .md 文件内容 */
export async function readVaultFile(rootPath: string, relPath: string): Promise<string> {
  if (!isTauri()) {
    return mockFileContent(relPath)
  }
  // 复用已有的 load_md_file,需传绝对路径
  const { join } = await import('@tauri-apps/api/path')
  const abs = await join(rootPath, relPath)
  return tauriInvoke<string>('load_md_file', { filePath: abs })
}

/** 写入 vault 内 .md 文件(覆盖) */
export async function writeVaultFile(rootPath: string, relPath: string, content: string): Promise<void> {
  if (!isTauri()) {
    return
  }
  const { join } = await import('@tauri-apps/api/path')
  const abs = await join(rootPath, relPath)
  await tauriInvoke<void>('save_md_file', { filePath: abs, content })
}

/** 重命名 vault 条目 */
export async function renameVaultEntry(
  rootPath: string,
  oldRel: string,
  newRel: string
): Promise<void> {
  if (!isTauri()) return
  await tauriInvoke<void>('rename_vault_entry', { rootPath, oldRel, newRel })
}

/** 删除 vault 条目(文件或空文件夹) */
export async function deleteVaultEntry(rootPath: string, rel: string): Promise<void> {
  if (!isTauri()) return
  await tauriInvoke<void>('delete_vault_entry', { rootPath, rel })
}

/** 在 vault 内创建新 .md 文件 */
export async function createVaultFile(
  rootPath: string,
  rel: string,
  content = ''
): Promise<void> {
  if (!isTauri()) return
  await tauriInvoke<void>('create_vault_file', { rootPath, rel, content })
}

/** 在 vault 内创建文件夹 */
export async function createVaultDir(rootPath: string, rel: string): Promise<void> {
  if (!isTauri()) return
  await tauriInvoke<void>('create_vault_dir', { rootPath, rel })
}

/** 在系统文件管理器中显示该文件(通过 open 命令) */
export async function revealInExplorer(rootPath: string, rel: string): Promise<void> {
  if (!isTauri()) return
  const { join } = await import('@tauri-apps/api/path')
  const abs = await join(rootPath, rel)
  // 使用 Opener plugin 或 shell open。这里走简易路径:不实现,留待后续
  // Tauri 2 推荐 @tauri-apps/plugin-opener,但本工程未集成,先 no-op
  void abs
}

/** 弹出文件选择器选择图片,复制到"文档所在目录/assets/",返回相对路径(相对文档目录) */
export async function pickImageToVault(rootPath: string, fileRelPath: string): Promise<string | null> {
  if (!isTauri()) return null
  // 走 Rust command,绕过 fs plugin 权限作用域限制
  return tauriInvoke<string | null>('pick_image_to_vault', { rootPath, fileRelPath })
}

/**
 * 在 vault 中按文件名查找 .md 文件(不区分大小写,不含 .md 后缀)
 * 返回匹配文件的相对路径(相对 vault 根),找不到返回 null
 * Obsidian 规则:按基本名匹配,重名时返回第一个找到的
 */
export function findFileByName(
  tree: VaultNode[],
  name: string
): string | null {
  const target = name.trim().toLowerCase()
  const stack: VaultNode[] = [...tree]
  while (stack.length > 0) {
    const node = stack.shift()!
    if (node.isDir && node.children) {
      stack.push(...node.children)
    } else {
      // 移除 .md 后缀后比较
      const baseName = node.name.replace(/\.md$/i, '').toLowerCase()
      if (baseName === target) {
        return node.path
      }
    }
  }
  return null
}

/** 将 Uint8Array 图片数据写入"文档所在目录/assets/",返回相对路径(相对文档目录) */
export async function writeImageToVault(
  rootPath: string,
  fileRelPath: string,
  data: Uint8Array,
  ext: string
): Promise<string> {
  if (!isTauri()) return ''
  // 走 Rust command,绕过 fs plugin 权限作用域限制
  // Vec<u8> 在 Tauri 序列化时需要传数组形式
  const arr = Array.from(data)
  return tauriInvoke<string>('write_image_to_vault', { rootPath, fileRelPath, data: arr, ext })
}

/** 将图片 URL 下载并写入"文档所在目录/assets/",返回相对路径(相对文档目录) */
export async function downloadImageToVault(
  rootPath: string,
  fileRelPath: string,
  url: string
): Promise<string> {
  if (!isTauri()) return url
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`下载图片失败: ${resp.status}`)
  const blob = await resp.blob()
  const ext = blob.type.split('/')[1]?.split(';')[0] || 'png'
  const data = new Uint8Array(await blob.arrayBuffer())
  return writeImageToVault(rootPath, fileRelPath, data, ext)
}

/** 复制路径到剪贴板 */
export async function copyPathToClipboard(rootPath: string, rel: string): Promise<void> {
  let text = rel
  if (isTauri()) {
    try {
      const { join } = await import('@tauri-apps/api/path')
      text = await join(rootPath, rel)
    } catch {
      text = `${rootPath}/${rel}`
    }
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 降级:execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

/* ===== Web 开发环境 mock 数据 ===== */

function mockVaultTree(): VaultNode[] {
  return [
    {
      name: '笔记',
      path: '笔记',
      isDir: true,
      children: [
        { name: '数学笔记.md', path: '笔记/数学笔记.md', isDir: false },
        { name: '物理笔记.md', path: '笔记/物理笔记.md', isDir: false }
      ]
    },
    { name: '欢迎文档.md', path: '欢迎文档.md', isDir: false },
    { name: '会议记录.md', path: '会议记录.md', isDir: false },
    { name: '草稿.md', path: '草稿.md', isDir: false }
  ]
}

function mockFileContent(relPath: string): string {
  const name = relPath.split('/').pop()?.replace(/\.md$/i, '') ?? '文档'
  return `# ${name}\n\n这是一个示例文档(Web 开发环境 mock)。\n\n- 列表项 1\n- 列表项 2\n\n**加粗文本** *斜体文本*。\n`
}
