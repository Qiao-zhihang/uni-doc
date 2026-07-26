declare module 'unidoc-api' {
  import type { Component } from 'vue'

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

  export interface Block {
    id: string
    type: string
    content: Record<string, any>
    props: Record<string, any>
    ai_history: Array<{ action: string; before: string; after: string; timestamp: string }>
    created_at: string
    updated_at: string
  }

  export type AppEventType =
    | 'document:open'
    | 'document:close'
    | 'document:save'
    | 'block:change'
    | 'block:insert'
    | 'block:delete'
    | 'selection:change'
    | 'theme:change'

  export interface AppEvent {
    type: AppEventType
    path?: string
    blockId?: string
    mode?: 'light' | 'dark'
  }

  export type AppEventListener = (event: AppEvent) => void

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

  export interface EditorAPI {
    getActiveDocumentPath: () => string | null
    getBlocks: () => Block[]
    getSelectedBlockId: () => string | null
    insertBlock: (type: string, afterBlockId?: string) => void
    updateBlock: (blockId: string, updates: Partial<Block>) => void
    deleteBlock: (blockId: string) => void
    on: (event: AppEventType, listener: AppEventListener) => void
    off: (event: AppEventType, listener: AppEventListener) => void
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
    on: (event: AppEventType, listener: AppEventListener) => void
    off: (event: AppEventType, listener: AppEventListener) => void
    readonly editor: EditorAPI
    readonly vault: VaultAPI
    readonly ui: UIAPI
  }

  export abstract class Plugin {
    protected api: PluginAPI
    constructor(api: PluginAPI)
    abstract onload(): void | Promise<void>
    onunload?(): void | Promise<void>
  }
}
