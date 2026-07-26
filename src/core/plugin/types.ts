import type { Component } from 'vue'
import type { Block, BlockType } from '@/core/blocks/types'

export type PluginPermission =
  | 'file-system:read'
  | 'file-system:write'
  | 'editor:read'
  | 'editor:modify-blocks'
  | 'editor:insert-blocks'
  | 'editor:delete-blocks'
  | 'ui:dialog'
  | 'ui:status-bar'
  | 'ui:ribbon'
  | 'ui:outline'
  | 'settings:read'
  | 'settings:modify'
  | 'network'
  | 'clipboard'

export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  'file-system:read': '读取文件',
  'file-system:write': '写入文件',
  'editor:read': '读取编辑器内容',
  'editor:modify-blocks': '修改区块',
  'editor:insert-blocks': '插入区块',
  'editor:delete-blocks': '删除区块',
  'ui:dialog': '弹出对话框',
  'ui:status-bar': '修改状态栏',
  'ui:ribbon': '修改功能栏',
  'ui:outline': '修改大纲面板',
  'settings:read': '读取设置',
  'settings:modify': '修改设置',
  'network': '网络请求',
  'clipboard': '访问剪贴板',
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  minAppVersion?: string
  main: string
  permissions?: PluginPermission[]
}

export interface PluginInstance {
  manifest: PluginManifest
  instance: Plugin
  enabled: boolean
  loaded: boolean
  error?: string
  dirPath: string
}

export interface Command {
  id: string
  name: string
  hotkey?: string
  callback: () => void | Promise<void>
}

export interface BlockTypeDefinition {
  type: string
  component: Component
  serialize?: (block: Block) => string
  deserialize?: (source: string) => Omit<Block, 'id' | 'ai_history' | 'created_at' | 'updated_at'> | null
  defaultProps?: Record<string, any>
  defaultContent?: Record<string, any>
}

export interface SettingsPanelDefinition {
  title: string
  component: Component
}

export type AppEvent =
  | { type: 'document:open'; path: string }
  | { type: 'document:close'; path: string }
  | { type: 'document:save'; path: string }
  | { type: 'block:change'; blockId: string }
  | { type: 'block:insert'; blockId: string }
  | { type: 'block:delete'; blockId: string }
  | { type: 'selection:change'; blockId: string | null }
  | { type: 'theme:change'; mode: 'light' | 'dark' }

export type AppEventListener = (event: AppEvent) => void

export interface EditorAPI {
  getActiveDocumentPath: () => string | null
  getBlocks: () => Block[]
  getSelectedBlockId: () => string | null
  insertBlock: (type: BlockType | string, afterBlockId?: string) => void
  updateBlock: (blockId: string, updates: Partial<Block>) => void
  deleteBlock: (blockId: string) => void
  on: (event: AppEvent['type'], listener: AppEventListener) => void
  off: (event: AppEvent['type'], listener: AppEventListener) => void
}

export interface VaultAPI {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  listDir: (path: string) => Promise<{ name: string; isDir: boolean }[]>
  exists: (path: string) => Promise<boolean>
}

export interface UINotification {
  type?: 'info' | 'success' | 'error'
  message: string
  duration?: number
}

export interface UIAPI {
  notify: (notification: UINotification) => void
  showDialog: (options: {
    title: string
    content?: string
    confirmText?: string
    cancelText?: string
  }) => Promise<boolean>
}

export interface PluginAPI {
  readonly manifest: PluginManifest
  readonly vue: typeof import('vue')
  addCommand: (command: Omit<Command, 'callback'> & { callback: Command['callback'] }) => void
  removeCommand: (id: string) => void
  registerBlockType: (definition: BlockTypeDefinition) => void
  unregisterBlockType: (type: string) => void
  registerSettingsPanel: (definition: SettingsPanelDefinition) => void
  unregisterSettingsPanel: (title: string) => void
  loadData: () => Promise<Record<string, any>>
  saveData: (data: Record<string, any>) => Promise<void>
  on: (event: AppEvent['type'], listener: AppEventListener) => void
  off: (event: AppEvent['type'], listener: AppEventListener) => void
  readonly editor: EditorAPI
  readonly vault: VaultAPI
  readonly ui: UIAPI
}

export abstract class Plugin {
  protected api: PluginAPI

  constructor(api: PluginAPI) {
    this.api = api
  }

  abstract onload(): void | Promise<void>

  onunload?(): void | Promise<void>
}
