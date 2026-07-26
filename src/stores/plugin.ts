import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { PluginManager } from '@/core/plugin/manager'
import type { PluginInstance } from '@/core/plugin/types'

export const usePluginStore = defineStore('plugin', () => {
  const manager = PluginManager.instance
  const safeMode = ref(false)
  const refreshTick = ref(0)

  const plugins = computed<PluginInstance[]>(() => {
    void refreshTick.value
    return manager.getInstalledPlugins()
  })

  const enabledPlugins = computed(() => plugins.value.filter((p) => p.enabled))
  const loadedPlugins = computed(() => plugins.value.filter((p) => p.loaded))
  const hasErrors = computed(() => plugins.value.some((p) => p.error))

  function tick() {
    refreshTick.value++
  }

  async function init(vaultRoot: string | null) {
    manager.setVaultRoot(vaultRoot)
    if (!safeMode.value) {
      await manager.init(vaultRoot)
    }
    tick()
  }

  async function reload() {
    await manager.reloadAll()
    tick()
  }

  async function enable(id: string) {
    const ok = await manager.enablePlugin(id)
    tick()
    return ok
  }

  async function disable(id: string) {
    const ok = await manager.disablePlugin(id)
    tick()
    return ok
  }

  function toggleSafeMode() {
    safeMode.value = !safeMode.value
  }

  function getCustomBlockTypes() {
    return manager.getCustomBlockTypes()
  }

  function getCustomCommands() {
    return manager.getCustomCommands()
  }

  function getCustomSettingsPanels() {
    return manager.getCustomSettingsPanels()
  }

  return {
    safeMode,
    plugins,
    enabledPlugins,
    loadedPlugins,
    hasErrors,
    init,
    reload,
    enable,
    disable,
    toggleSafeMode,
    getCustomBlockTypes,
    getCustomCommands,
    getCustomSettingsPanels,
  }
})
