/**
 * 编辑器状态 store
 * 管理当前选中 Block、编辑模式(可视化/源码)、缩放、各面板显隐等
 * 参考 PRD §10(UI 交互规范)和 UI 改造方案(仿 Obsidian 三栏布局)
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type EditorMode = 'visual' | 'source'
export type OutlineTab = 'outline' | 'tags' | 'info'
export type AiFloatingState = 'closed' | 'expanded' | 'minimized'

export const useEditorStore = defineStore('editor', () => {
  // 当前选中的 Block id
  const selectedBlockId = ref<string | null>(null)
  // 当前编辑模式
  const mode = ref<EditorMode>('visual')
  // 缩放比例(百分比)
  const zoom = ref(100)
  // 当前页码(从 1 开始)
  const currentPage = ref(1)

  // ===== 面板显隐(三栏布局) =====
  // 左侧文件浏览器是否展开
  const fileExplorerOpen = ref(true)
  // 右侧大纲面板是否展开
  const outlinePanelOpen = ref(true)
  // 大纲面板当前 Tab
  const outlineTab = ref<OutlineTab>('outline')

  // ===== AI 浮窗 =====
  const aiFloatingState = ref<AiFloatingState>('closed')

  // ===== 兼容旧字段(标记为弃用,逐步迁移) =====
  /** @deprecated 改用 fileExplorerOpen */
  const sidebarOpen = ref(true)
  /** @deprecated 右侧属性栏已移除,本字段不再使用 */
  const panelOpen = ref(false)
  /** @deprecated 改用 aiFloatingState */
  const aiBarOpen = ref(false)

  function selectBlock(id: string | null) {
    selectedBlockId.value = id
  }

  function toggleMode() {
    mode.value = mode.value === 'visual' ? 'source' : 'visual'
  }

  function setMode(m: EditorMode) {
    mode.value = m
  }

  function zoomIn() {
    zoom.value = Math.min(200, zoom.value + 10)
  }

  function zoomOut() {
    zoom.value = Math.max(50, zoom.value - 10)
  }

  function resetZoom() {
    zoom.value = 100
  }

  function toggleFileExplorer() {
    fileExplorerOpen.value = !fileExplorerOpen.value
  }

  function toggleOutlinePanel() {
    outlinePanelOpen.value = !outlinePanelOpen.value
  }

  function setOutlineTab(tab: OutlineTab) {
    outlineTab.value = tab
    if (!outlinePanelOpen.value) outlinePanelOpen.value = true
  }

  function openAiFloating() {
    aiFloatingState.value = 'expanded'
  }

  function minimizeAiFloating() {
    aiFloatingState.value = 'minimized'
  }

  function closeAiFloating() {
    aiFloatingState.value = 'closed'
  }

  function toggleAiFloating() {
    if (aiFloatingState.value === 'closed') {
      aiFloatingState.value = 'expanded'
    } else {
      aiFloatingState.value = 'closed'
    }
  }

  /** @deprecated */
  function toggleAiBar() {
    toggleAiFloating()
  }
  /** @deprecated */
  function togglePanel() {
    panelOpen.value = !panelOpen.value
  }
  /** @deprecated */
  function toggleSidebar() {
    toggleFileExplorer()
  }

  function setCurrentPage(page: number) {
    currentPage.value = page
  }

  return {
    // state
    selectedBlockId,
    mode,
    zoom,
    currentPage,
    fileExplorerOpen,
    outlinePanelOpen,
    outlineTab,
    aiFloatingState,
    // deprecated
    sidebarOpen,
    panelOpen,
    aiBarOpen,
    // actions
    selectBlock,
    toggleMode,
    setMode,
    zoomIn,
    zoomOut,
    resetZoom,
    toggleFileExplorer,
    toggleOutlinePanel,
    setOutlineTab,
    openAiFloating,
    minimizeAiFloating,
    closeAiFloating,
    toggleAiFloating,
    setCurrentPage,
    // deprecated
    toggleAiBar,
    togglePanel,
    toggleSidebar
  }
})
