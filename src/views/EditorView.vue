<script setup lang="ts">
/**
 * 编辑器主界面(改造版)
 * 参考 UI 改造方案 §3.1 三栏布局和设计稿 editor-light.html
 * 结构:Ribbon + FileExplorer + 主区(TitleBar + Tabs + Toolbar + Editor + StatusBar) + OutlinePanel + AiFloatingWindow
 *
 * 响应式断点:
 *   - < 1000px: 自动折叠 FileExplorer + Outline(用户仍可手动展开)
 *   - < 700px: 强制折叠面板(忽略用户展开操作),Ribbon 保留原位
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import TitleBar from '@/components/layout/TitleBar.vue'
import Ribbon from '@/components/layout/Ribbon.vue'
import FileExplorer from '@/components/layout/FileExplorer.vue'
import OutlinePanel from '@/components/layout/OutlinePanel.vue'
import AiFloatingWindow from '@/components/layout/AiFloatingWindow.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import Toolbar from '@/components/editor/Toolbar.vue'
import EditorTabs from '@/components/editor/EditorTabs.vue'
import BlockEditor from '@/components/editor/BlockEditor.vue'
import PresentationMode from '@/components/editor/PresentationMode.vue'
import ReplayPlayer from '@/components/editor/ReplayPlayer.vue'
import { useEditorStore } from '@/stores/editor'
import { useDocumentStore } from '@/stores/document'
import { useReplayStore } from '@/stores/replay'
import { useBreakpoint } from '@/composables/useBreakpoint'

/* ===== 空状态鲨鱼图(eager + ?url,避免动态 import 在 Tauri WebView 中失败) ===== */
interface SharkEntry {
  url: string
  quote: string
}
const sharkUrls = import.meta.glob<string>('@/assets/UUshark/mascot_*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
})
const sharkKeys = Object.keys(sharkUrls)
const sharkQuotes: string[] = [
  '文档海洋太干了,先打开一份看看吧。',
  '没有可啃的文档,鲨鱼有点无聊。',
  '左侧选个文件,朕带你畅游墨水。',
  '空空如也,不如新建一篇开始书写。',
  '鲨鱼静候,等一份文档游过来。'
]
const currentShark = ref<SharkEntry>({ url: '', quote: sharkQuotes[0] })
let lastSharkIdx = -1

function randomShark() {
  if (sharkKeys.length === 0) return
  let idx = lastSharkIdx
  while (idx === lastSharkIdx && sharkKeys.length > 1) {
    idx = Math.floor(Math.random() * sharkKeys.length)
  }
  if (idx === -1) idx = 0
  lastSharkIdx = idx
  currentShark.value = {
    url: sharkUrls[sharkKeys[idx]],
    quote: sharkQuotes[idx % sharkQuotes.length]
  }
}

const editor = useEditorStore()
const doc = useDocumentStore()
const replay = useReplayStore()
const breakpoint = useBreakpoint()

// 演示模式
const presentationMode = ref(false)
function enterPresentation() {
  if (doc.openTabs.length === 0) return
  presentationMode.value = true
}
function exitPresentation() {
  presentationMode.value = false
  // 退出演示后触发 mermaid 重新渲染(演示模式会污染 mermaid 全局状态)
  nextTick(() => {
    doc.renderTick++
  })
}

// 回放模式
const replayMode = ref(false)
function enterReplay() {
  if (doc.openTabs.length === 0 || !replay.hasSnapshots) return
  replayMode.value = true
  replay.play()
}
function exitReplay() {
  replayMode.value = false
  replay.exitReplay()
}

// 回放快照生命周期:文档切换时加载/卸载 history
watch(
  () => doc.activeTabId,
  (newId, oldId) => {
    if (oldId) replay.unload()
    if (newId) {
      const tab = doc.openTabs.find((t) => t.id === newId)
      if (tab?.path) {
        void replay.loadForDoc(tab.path)
      }
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  replay.dispose()
})

// 进入空状态(打开文件数从 >0 变 0,或初始即为 0)时随机选一张鲨鱼
watch(
  () => doc.openTabs.length,
  (len, prevLen) => {
    if (len === 0 && prevLen !== 0) randomShark()
  }
)
// 初始即空状态时也加载一张
if (doc.openTabs.length === 0) randomShark()

// 响应式:窗口宽度变化时自动折叠/恢复面板
watch(
  () => breakpoint.value.width,
  (newW) => {
    if (newW < 700) {
      // 窄屏:强制折叠
      editor.fileExplorerOpen = false
      editor.outlinePanelOpen = false
    } else if (newW < 1000) {
      // 中等屏:自动折叠(用户仍可手动展开)
      editor.fileExplorerOpen = false
      editor.outlinePanelOpen = false
    }
    // >= 1000px 不主动改变,尊重用户当前状态
  }
)

// 窄屏阻止展开
const showFileExplorer = computed(() => editor.fileExplorerOpen && !breakpoint.value.isNarrow)
const showOutlinePanel = computed(() => editor.outlinePanelOpen && !breakpoint.value.isNarrow)

/** 全局快捷键:面板折叠 + AI 唤起 + 演示模式 */
function onKeydown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey

  // F5 进入演示模式
  if (e.key === 'F5') {
    e.preventDefault()
    enterPresentation()
    return
  }

  // 窄屏下禁用面板切换快捷键
  if (breakpoint.value.isNarrow) {
    if ((ctrl && e.key === '\\') || (ctrl && e.shiftKey && (e.key === '|' || e.key === '\\'))) {
      return
    }
  }

  // Ctrl+\ 切换文件浏览器
  if (ctrl && !e.shiftKey && e.key === '\\') {
    e.preventDefault()
    editor.toggleFileExplorer()
    return
  }
  // Ctrl+Shift+\ 切换大纲面板
  if (ctrl && e.shiftKey && (e.key === '|' || e.key === '\\')) {
    e.preventDefault()
    editor.toggleOutlinePanel()
    return
  }
  // Ctrl+K 切换 AI 浮窗
  if (ctrl && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    editor.toggleAiFloating()
    return
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <main class="editor-layout">
    <!-- 最左侧 Ribbon -->
    <Ribbon />

    <!-- 左侧文件浏览器 -->
    <FileExplorer v-if="showFileExplorer" />

    <!-- 主内容区 -->
    <div class="main-area">
      <TitleBar />
      <EditorTabs />
      <Toolbar @presentation="enterPresentation" @replay="enterReplay" />

      <!-- 编辑器 + 右侧大纲面板 -->
      <div class="editor-area">
        <BlockEditor v-if="doc.openTabs.length > 0" />
        <div v-else class="editor-empty">
          <img
            v-if="currentShark.url"
            :src="currentShark.url"
            class="shark-img"
            alt="鲨鱼吉祥物"
            draggable="false"
          />
          <div class="shark-quote">{{ currentShark.quote }}</div>
        </div>
        <OutlinePanel v-if="showOutlinePanel" />
      </div>

      <!-- 状态栏 -->
      <StatusBar @presentation="enterPresentation" />
    </div>

    <!-- AI 独立浮窗(非模态,浮于所有内容之上) -->
    <AiFloatingWindow />

    <!-- 演示模式(全屏覆盖) -->
    <PresentationMode
      v-if="presentationMode && doc.openTabs.length > 0"
      :blocks="doc.blocks"
      @exit="exitPresentation"
    />

    <!-- 文档回放模式(全屏覆盖) -->
    <ReplayPlayer
      v-if="replayMode"
      @exit="exitReplay"
    />
  </main>
</template>

<style scoped>
.editor-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
.main-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.editor-area {
  display: flex;
  flex: 1;
  min-height: 0;
}
.editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--background);
  color: var(--muted-foreground);
}
.shark-img {
  width: 320px;
  max-width: 320px;
  height: auto;
  border-radius: 16px;
  user-select: none;
  pointer-events: none;
}
.shark-quote {
  font-size: 13px;
  font-style: italic;
  text-align: center;
  max-width: 320px;
  line-height: 1.5;
}
</style>
