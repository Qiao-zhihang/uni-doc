import {
  type AppEvent,
  type AppEventListener,
  type BlockTypeDefinition,
  type Command,
  type PluginAPI,
  type PluginInstance,
  type PluginManifest,
  type SettingsPanelDefinition,
  Plugin,
} from './types'

import * as Vue from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/core/serializer/markdownFile'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'

const PLUGINS_DIR = '.unidoc/plugins'
const DATA_DIR = '.unidoc/plugin-data'

function safeJoin(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

export class PluginManager {
  private static _instance: PluginManager | null = null
  private instances: Map<string, PluginInstance> = new Map()
  private listeners: Map<AppEvent['type'], Set<AppEventListener>> = new Map()
  private customBlockTypes: Map<string, BlockTypeDefinition> = new Map()
  private customCommands: Map<string, Command> = new Map()
  private customSettingsPanels: SettingsPanelDefinition[] = []
  private vaultRoot: string | null = null
  private _ready = false
  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null

  private bindHotkeys() {
    if (this._keydownHandler) return
    this._keydownHandler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      for (const cmd of this.customCommands.values()) {
        if (!cmd.hotkey) continue
        const match = this.matchHotkey(e, cmd.hotkey)
        if (match) {
          e.preventDefault()
          this.safeCall(() => cmd.callback(), `命令 ${cmd.name} 执行失败`)
          return
        }
      }
    }
    window.addEventListener('keydown', this._keydownHandler)
  }

  private unbindHotkeys() {
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler)
      this._keydownHandler = null
    }
  }

  private matchHotkey(e: KeyboardEvent, hotkey: string): boolean {
    const parts = hotkey.toLowerCase().split('+').map((s) => s.trim())
    const needCtrl = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('control')
    const needShift = parts.includes('shift')
    const needAlt = parts.includes('alt') || parts.includes('option')
    const key = parts
      .filter((p) => !['ctrl', 'cmd', 'control', 'shift', 'alt', 'option'].includes(p))
      .join('+')
    const ctrl = e.ctrlKey || e.metaKey
    if (needCtrl !== ctrl) return false
    if (needShift !== e.shiftKey) return false
    if (needAlt !== e.altKey) return false
    if (e.key.toLowerCase() !== key) return false
    return true
  }

  static get instance(): PluginManager {
    if (!PluginManager._instance) {
      PluginManager._instance = new PluginManager()
    }
    return PluginManager._instance
  }

  get ready() {
    return this._ready
  }

  getInstalledPlugins(): PluginInstance[] {
    return Array.from(this.instances.values())
  }

  getCustomBlockTypes(): Map<string, BlockTypeDefinition> {
    return this.customBlockTypes
  }

  getCustomBlockType(type: string): BlockTypeDefinition | undefined {
    return this.customBlockTypes.get(type)
  }

  getCustomCommands(): Command[] {
    return Array.from(this.customCommands.values())
  }

  getCustomSettingsPanels(): SettingsPanelDefinition[] {
    return this.customSettingsPanels
  }

  getPluginInstance(id: string): PluginInstance | undefined {
    return this.instances.get(id)
  }

  setVaultRoot(path: string | null) {
    this.vaultRoot = path
  }

  async init(vaultRoot: string | null): Promise<void> {
    this.vaultRoot = vaultRoot
    ;(window as any).__unidoc = { Plugin, Vue }
    this.injectToastStyles()
    this.bindHotkeys()
    await this.scanAndLoad()
    this._ready = true
  }

  async reloadAll(): Promise<void> {
    for (const inst of this.instances.values()) {
      if (inst.loaded && inst.enabled) {
        await this.unloadPlugin(inst.manifest.id)
      }
    }
    this.instances.clear()
    this.customBlockTypes.clear()
    this.customCommands.clear()
    this.customSettingsPanels = []
    this.unbindHotkeys()
    this.bindHotkeys()
    await this.scanAndLoad()
  }

  private async scanAndLoad(): Promise<void> {
    if (!this.vaultRoot) return

    const pluginsPath = safeJoin(this.vaultRoot, PLUGINS_DIR)
    const entries = await this.listPluginDirs(pluginsPath)

    for (const dir of entries) {
      const dirPath = safeJoin(pluginsPath, dir)
      try {
        const manifest = await this.loadManifest(dirPath)
        if (!manifest) continue

        const instance: PluginInstance = {
          manifest,
          instance: null as any,
          enabled: true,
          loaded: false,
          dirPath,
        }
        this.instances.set(manifest.id, instance)
      } catch (e) {
        console.error(`扫描插件失败 ${dir}:`, e)
      }
    }

    const enabledIds = this.loadEnabledFromStorage()
    for (const inst of this.instances.values()) {
      if (enabledIds.has(inst.manifest.id)) {
        inst.enabled = true
      } else if (enabledIds.size > 0) {
        inst.enabled = false
      }
    }

    for (const inst of this.instances.values()) {
      if (inst.enabled && !inst.loaded) {
        await this.loadPlugin(inst.manifest.id)
      }
    }
  }

  private async listPluginDirs(pluginsPath: string): Promise<string[]> {
    try {
      if (isTauri()) {
        const dirExists = await invoke('plugin_dir_exists', { path: pluginsPath }).catch(() => false)
        if (!dirExists) return []
        const entries = await invoke<{ name: string; is_dir: boolean }[]>('list_plugin_dirs', {
          path: pluginsPath,
        })
        return entries.filter((e) => e.is_dir).map((e) => e.name)
      } else {
        console.warn('Web 模式暂不支持插件目录扫描')
        return []
      }
    } catch {
      return []
    }
  }

  private async loadManifest(dirPath: string): Promise<PluginManifest | null> {
    const manifestPath = safeJoin(dirPath, 'manifest.json')
    try {
      let text: string
      if (isTauri()) {
        text = await invoke<string>('read_plugin_file', { path: manifestPath })
      } else {
        console.warn('Web 模式无法读取插件 manifest')
        return null
      }
      const data = JSON.parse(text) as PluginManifest
      if (!data.id || !data.name || !data.main) {
        console.warn(`插件清单缺少必填字段: ${manifestPath}`)
        return null
      }
      return data
    } catch (e) {
      console.error(`读取插件清单失败 ${manifestPath}:`, e)
      return null
    }
  }

  async loadPlugin(id: string): Promise<boolean> {
    const inst = this.instances.get(id)
    if (!inst) return false
    if (inst.loaded) return true

    try {
      const mainPath = safeJoin(inst.dirPath, inst.manifest.main)
      let moduleExports: any

      if (isTauri()) {
        const code = await invoke<string>('read_plugin_file', { path: mainPath })
        const blob = new Blob([code], { type: 'application/javascript' })
        const url = URL.createObjectURL(blob)
        try {
          moduleExports = await import(/* @vite-ignore */ url)
        } finally {
          URL.revokeObjectURL(url)
        }
      } else {
        console.warn('Web 模式无法加载插件')
        return false
      }

      const PluginClass = moduleExports.default || moduleExports.Plugin
      if (!PluginClass || !(PluginClass.prototype instanceof Plugin || PluginClass === Plugin)) {
        throw new Error('插件未导出有效的 Plugin 子类')
      }

      const api = this.createPluginAPI(inst.manifest)
      const pluginInstance = new PluginClass(api) as Plugin

      inst.instance = pluginInstance
      inst.loaded = true
      inst.error = undefined

      await this.safeCall(async () => {
        await pluginInstance.onload()
      }, `插件 onload 失败: ${inst.manifest.name}`)

      return true
    } catch (e) {
      inst.loaded = false
      inst.error = (e as Error).message
      console.error(`加载插件失败 ${id}:`, e)
      return false
    }
  }

  async unloadPlugin(id: string): Promise<boolean> {
    const inst = this.instances.get(id)
    if (!inst || !inst.loaded) return false

    try {
      if (inst.instance.onunload) {
        await this.safeCall(async () => {
          await inst.instance.onunload!()
        }, `插件 onunload 失败: ${inst.manifest.name}`)
      }

      for (const [type, def] of this.customBlockTypes) {
        if (def.type.startsWith(`${id}:`)) {
          this.customBlockTypes.delete(type)
        }
      }

      for (const cmdId of this.customCommands.keys()) {
        if (cmdId.startsWith(`${id}:`)) {
          this.customCommands.delete(cmdId)
        }
      }

      this.customSettingsPanels = this.customSettingsPanels.filter((p) => !p.title.startsWith(`${id}:`))

      inst.loaded = false
      return true
    } catch (e) {
      console.error(`卸载插件失败 ${id}:`, e)
      return false
    }
  }

  async enablePlugin(id: string): Promise<boolean> {
    const inst = this.instances.get(id)
    if (!inst) return false
    inst.enabled = true
    this.saveEnabledToStorage()
    if (!inst.loaded) {
      return await this.loadPlugin(id)
    }
    return true
  }

  async disablePlugin(id: string): Promise<boolean> {
    const inst = this.instances.get(id)
    if (!inst) return false
    inst.enabled = false
    this.saveEnabledToStorage()
    return await this.unloadPlugin(id)
  }

  emit(event: AppEvent): void {
    const listeners = this.listeners.get(event.type)
    if (!listeners) return
    for (const listener of listeners) {
      this.safeCall(() => listener(event), '事件监听器错误')
    }
  }

  private createPluginAPI(manifest: PluginManifest): PluginAPI {
    const self = this
    const ns = (key: string) => `${manifest.id}:${key}`

    const api: PluginAPI = {
      manifest,
      vue: Vue,

      addCommand: (cmd) => {
        const namespacedId = ns(cmd.id)
        self.customCommands.set(namespacedId, { ...cmd, id: namespacedId })
      },

      removeCommand: (id) => {
        self.customCommands.delete(ns(id))
      },

      registerBlockType: (def) => {
        const namespacedType = ns(def.type)
        self.customBlockTypes.set(namespacedType, { ...def, type: namespacedType })
      },

      unregisterBlockType: (type) => {
        self.customBlockTypes.delete(ns(type))
      },

      registerSettingsPanel: (def) => {
        self.customSettingsPanels.push({
          title: ns(def.title),
          component: def.component,
        })
      },

      unregisterSettingsPanel: (title) => {
        self.customSettingsPanels = self.customSettingsPanels.filter((p) => p.title !== ns(title))
      },

      loadData: async () => {
        if (!self.vaultRoot) return {}
        const dataPath = safeJoin(self.vaultRoot, DATA_DIR, `${manifest.id}.json`)
        try {
          const text = await invoke<string>('read_plugin_file', { path: dataPath })
          return JSON.parse(text)
        } catch {
          return {}
        }
      },

      saveData: async (data) => {
        if (!self.vaultRoot) return
        const dataPath = safeJoin(self.vaultRoot, DATA_DIR, `${manifest.id}.json`)
        try {
          if (isTauri()) {
            await invoke('write_plugin_data', {
              path: dataPath,
              content: JSON.stringify(data, null, 2),
            })
          }
        } catch (e) {
          console.error(`保存插件数据失败 ${manifest.id}:`, e)
        }
      },

      on: (event, listener) => {
        if (!self.listeners.has(event)) {
          self.listeners.set(event, new Set())
        }
        self.listeners.get(event)!.add(listener)
      },

      off: (event, listener) => {
        self.listeners.get(event)?.delete(listener)
      },

      editor: {
        getActiveDocumentPath: () => {
          const doc = useDocumentStore()
          return doc.activeTabPath
        },
        getBlocks: () => {
          const doc = useDocumentStore()
          return doc.blocks
        },
        getSelectedBlockId: () => {
          const editor = useEditorStore()
          return editor.selectedBlockId
        },
        insertBlock: (type, afterBlockId) => {
          const doc = useDocumentStore()
          doc.insertBlockAfter(afterBlockId ?? doc.blocks[doc.blocks.length - 1]?.id ?? null, type as any)
        },
        updateBlock: (blockId, updates) => {
          const doc = useDocumentStore()
          doc.updateBlock(blockId, updates)
        },
        deleteBlock: (blockId) => {
          const doc = useDocumentStore()
          doc.removeBlock(blockId)
        },
        on: (event, listener) => api.on(event, listener),
        off: (event, listener) => api.off(event, listener),
      },

      vault: {
        readFile: async (path) => {
          if (!self.vaultRoot) return ''
          const { readVaultFile } = await import('@/core/vault/vault')
          return await readVaultFile(self.vaultRoot, path)
        },
        writeFile: async (path, content) => {
          if (!self.vaultRoot) return
          const { writeVaultFile } = await import('@/core/vault/vault')
          await writeVaultFile(self.vaultRoot, path, content)
        },
        listDir: async (path) => {
          if (!self.vaultRoot) return []
          const { readVaultTree } = await import('@/core/vault/vault')
          const tree = await readVaultTree(self.vaultRoot)
          const result: { name: string; isDir: boolean }[] = []
          for (const node of tree) {
            const parts = node.path.split('/')
            const parent = parts.slice(0, -1).join('/')
            if (parent === path) {
              result.push({ name: parts[parts.length - 1], isDir: node.isDir })
            }
          }
          return result
        },
        exists: async (path) => {
          if (!self.vaultRoot) return false
          try {
            if (isTauri()) {
              const fullPath = safeJoin(self.vaultRoot, path)
              return await invoke<boolean>('file_exists', { path: fullPath })
            }
            return false
          } catch {
            return false
          }
        },
      },

      ui: {
        notify: (n) => {
          const icons: Record<string, string> = {
            success: '✓',
            error: '!',
            info: 'ℹ',
          }
          const icon = icons[n.type || 'info'] || icons.info

          const toast = document.createElement('div')
          toast.style.cssText = `
            position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
            z-index: 99999;
            display: flex; align-items: center; gap: 8px;
            padding: 10px 18px 10px 14px;
            border-radius: 14px;
            font-size: 13px; font-weight: 500;
            background: rgba(255, 255, 255, 0.72);
            backdrop-filter: saturate(180%) blur(20px);
            -webkit-backdrop-filter: saturate(180%) blur(20px);
            color: var(--foreground);
            border: 0.5px solid rgba(0, 0, 0, 0.06);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
            max-width: calc(100vw - 48px);
            animation: unidocToastIn 0.35s cubic-bezier(0.32, 0.72, 0, 1);
          `

          const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
          const isDark = document.documentElement.classList.contains('dark') || darkMedia.matches
          if (isDark) {
            toast.style.background = 'rgba(40, 40, 44, 0.72)'
            toast.style.border = '0.5px solid rgba(255, 255, 255, 0.08)'
          }

          const iconEl = document.createElement('span')
          const accentColor =
            n.type === 'error'
              ? 'var(--destructive)'
              : n.type === 'success'
                ? 'var(--success)'
                : 'var(--primary)'
          iconEl.style.cssText = `
            display: inline-flex; align-items: center; justify-content: center;
            width: 22px; height: 22px; border-radius: 50%;
            background: ${accentColor};
            color: #fff; font-size: 13px; font-weight: 700;
            flex-shrink: 0;
          `
          iconEl.textContent = icon

          const textEl = document.createElement('span')
          textEl.style.cssText = `
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          `
          textEl.textContent = n.message

          toast.appendChild(iconEl)
          toast.appendChild(textEl)
          document.body.appendChild(toast)

          const duration = n.duration ?? 2800
          setTimeout(() => {
            toast.style.animation = 'unidocToastOut 0.25s cubic-bezier(0.32, 0.72, 0, 1) forwards'
            setTimeout(() => toast.remove(), 260)
          }, duration)
        },
        showDialog: async (opts) => {
          return window.confirm(`${opts.title}\n\n${opts.content ?? ''}`)
        },
      },
    }

    return api
  }

  private injectToastStyles(): void {
    if (document.getElementById('unidoc-toast-styles')) return
    const style = document.createElement('style')
    style.id = 'unidoc-toast-styles'
    style.textContent = `
      @keyframes unidocToastIn {
        0% {
          opacity: 0;
          transform: translateX(-50%) translateY(-12px) scale(0.96);
        }
        100% {
          opacity: 1;
          transform: translateX(-50%) translateY(0) scale(1);
        }
      }
      @keyframes unidocToastOut {
        0% {
          opacity: 1;
          transform: translateX(-50%) translateY(0) scale(1);
        }
        100% {
          opacity: 0;
          transform: translateX(-50%) translateY(-8px) scale(0.98);
        }
      }
    `
    document.head.appendChild(style)
  }

  private safeCall(fn: () => void | Promise<void>, errorMsg: string): void {
    try {
      const result = fn()
      if (result && typeof result.catch === 'function') {
        result.catch((e) => console.error(errorMsg, e))
      }
    } catch (e) {
      console.error(errorMsg, e)
    }
  }

  private loadEnabledFromStorage(): Set<string> {
    try {
      const raw = localStorage.getItem('unidoc-enabled-plugins')
      if (!raw) return new Set()
      return new Set(JSON.parse(raw) as string[])
    } catch {
      return new Set()
    }
  }

  private saveEnabledToStorage(): void {
    const enabled = Array.from(this.instances.values())
      .filter((i) => i.enabled)
      .map((i) => i.manifest.id)
    localStorage.setItem('unidoc-enabled-plugins', JSON.stringify(enabled))
  }
}
