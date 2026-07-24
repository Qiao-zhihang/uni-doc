<script setup lang="ts">
/**
 * AI 独立浮窗 — 多会话双栏布局
 * 左侧：会话列表（新建/切换/删除）
 * 右侧：对话区（消息列表 + 输入栏）
 * 标题栏：UU鲨 + Profile 下拉选择器 + 新建/最小化/关闭
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useEditorStore } from '@/stores/editor'
import { useDocumentStore } from '@/stores/document'
import { useSettingsStore } from '@/stores/settings'
import { useAiConversationStore } from '@/stores/aiConversation'
import { useAiMemoryStore } from '@/stores/aiMemory'
import { createAgent, type Agent } from '@/ai/agent'
import { renderMarkdown } from '@/ai/markdown'
import { TOOL_LABELS } from '@/ai/tools'
import type { MessageContent, ToolResult } from '@/ai/types'
import AiIconUrl from '@/assets/UUshark/icon.svg'
import { writeImageToVault } from '@/core/vault/vault'
import { isTauri, handleExternalLinkClick } from '@/core/serializer/markdownFile'

const router = useRouter()

const editor = useEditorStore()
const doc = useDocumentStore()
const settings = useSettingsStore()
const convStore = useAiConversationStore()
const memoryStore = useAiMemoryStore()
const agent = ref<Agent | null>(null)
const sending = ref(false)
const abortController = ref<AbortController | null>(null)

const input = ref('')
const toolStatus = ref<'idle' | 'calling' | 'completed'>('idle')
const currentToolName = ref('')
const currentToolResult = ref<ToolResult | null>(null)
const chatAreaRef = ref<HTMLElement | null>(null)
const localWebSearch = ref(true)
const attachedImages = ref<Array<{ name: string; base64: string; mimeType: string }>>([])
const fileInputRef = ref<HTMLInputElement | null>(null)

/** Profile 下拉菜单 */
const showProfileDropdown = ref(false)

/** 删除会话确认 */
const deleteTargetId = ref<string | null>(null)

/** 重命名会话 */
const renamingId = ref<string | null>(null)
const renameInput = ref('')

/** 左侧面板折叠状态 */
const sidebarCollapsed = ref(false)
const sidebarAnimating = ref(false)
const SIDEBAR_W = 160
const SIDEBAR_COLLAPSED_W = 48
const SIDEBAR_DELTA = SIDEBAR_W - SIDEBAR_COLLAPSED_W

const isOpen = computed(() => editor.aiFloatingState === 'expanded')
const isMinimized = computed(() => editor.aiFloatingState === 'minimized')

/** 从消息内容中提取纯文本（过滤掉 AI 内部提示标记） */
function extractText(content: string | MessageContent[]): string {
  if (!content) return ''
  let raw = ''
  if (typeof content === 'string') {
    raw = content
  } else if (Array.isArray(content)) {
    raw = content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(' ')
  }
  // 过滤掉 __AI_INTERNAL__ 到 __AI_INTERNAL_END__ 之间的内容
  return raw.replace(/__AI_INTERNAL__:[\s\S]*?__AI_INTERNAL_END__/g, '').trim()
}

/** 当前活跃会话的消息（过滤掉 system/tool 消息和空内容的 assistant 消息，用于显示） */
const displayMessages = computed(() => {
  const conv = convStore.activeConversation
  if (!conv) return []
  return conv.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => {
      if (!m.content) return false
      if (typeof m.content === 'string') return m.content.trim().length > 0
      if (Array.isArray(m.content)) {
        const hasText = m.content.some((p) => p.type === 'text' && (p as { text: string }).text.trim().length > 0)
        const hasImage = m.content.some((p) => p.type === 'image_url')
        return hasText || hasImage
      }
      return false
    })
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
})

/** 按最后更新时间降序排列的会话列表 */
const sortedConversations = computed(() => convStore.sortedConversations)

/** 当前活跃 Profile */
const activeProfile = computed(() => settings.activeProfile)

/** 模型能力 */
const caps = computed(() => settings.modelCapabilities)

/** 滚动对话区到底部 */
function scrollToBottom() {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (chatAreaRef.value) {
        chatAreaRef.value.scrollTop = chatAreaRef.value.scrollHeight
      }
    })
  })
}

// 消息变化时自动滚动
watch(() => displayMessages.value.length, () => scrollToBottom())
// 流式输出时持续滚动(100ms 节流,避免每个 delta 都触发)
let streamScrollTs = 0
let streamScrollTimer: ReturnType<typeof setTimeout> | null = null
watch(() => {
  const msgs = displayMessages.value
  const last = msgs[msgs.length - 1]
  return last?.role === 'assistant' ? last.content.length : 0
}, () => {
  const now = Date.now()
  if (now - streamScrollTs < 100) {
    // 节流:100ms 内的后续触发用 trailing 调用补一次
    if (streamScrollTimer === null) {
      streamScrollTimer = setTimeout(() => {
        streamScrollTimer = null
        streamScrollTs = Date.now()
        scrollToBottom()
      }, 100 - (now - streamScrollTs))
    }
    return
  }
  streamScrollTs = now
  scrollToBottom()
})
// 窗口打开 / 切换会话时滚动到底部
watch(isOpen, (open) => { if (open) scrollToBottom() })
watch(() => convStore.activeConversationId, () => scrollToBottom())

const MIN_W = 360
const MIN_H = 450

/** 窗口位置（left/top），初始值在 onMounted 计算 */
const windowPos = ref({ x: 0, y: 0 })
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0, posX: 0, posY: 0 })

const windowSize = ref({ w: 480, h: 600 })
const resizing = ref(false)
const resizeStart = ref({ x: 0, y: 0, startW: 0, startH: 0 })

function initWindowPosition() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const statusBarH = 28
  windowPos.value = {
    x: vw - windowSize.value.w - 16,
    y: vh - windowSize.value.h - statusBarH - 16,
  }
}

function clampToViewport(x: number, y: number, w: number, h: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    x: Math.max(0, Math.min(vw - w, x)),
    y: Math.max(0, Math.min(vh - h - 28, y)),
  }
}

function onResizeDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  document.body.style.userSelect = 'none'
  resizing.value = true
  resizeStart.value = {
    x: e.clientX,
    y: e.clientY,
    startW: windowSize.value.w,
    startH: windowSize.value.h,
  }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeUp)
}

function onResizeMove(e: PointerEvent) {
  if (!resizing.value) return
  e.preventDefault()
  const dw = e.clientX - resizeStart.value.x
  const dh = e.clientY - resizeStart.value.y
  const newW = Math.max(MIN_W, resizeStart.value.startW + dw)
  const newH = Math.max(MIN_H, resizeStart.value.startH + dh)
  const clamped = clampToViewport(windowPos.value.x, windowPos.value.y, newW, newH)
  windowSize.value = { w: newW, h: newH }
  windowPos.value = clamped
}

function onResizeUp(e: PointerEvent) {
  resizing.value = false
  document.body.style.userSelect = ''
  try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch (_) {}
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
}

function onPointerDown(e: PointerEvent) {
  if (!isOpen.value) return
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  document.body.style.userSelect = 'none'
  dragging.value = true
  dragStart.value = {
    x: e.clientX,
    y: e.clientY,
    posX: windowPos.value.x,
    posY: windowPos.value.y,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const newX = dragStart.value.posX + (e.clientX - dragStart.value.x)
  const newY = dragStart.value.posY + (e.clientY - dragStart.value.y)
  windowPos.value = clampToViewport(newX, newY, windowSize.value.w, windowSize.value.h)
}

function onPointerUp(e: PointerEvent) {
  dragging.value = false
  document.body.style.userSelect = ''
  try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch (_) {}
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

onUnmounted(() => {
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
})

onMounted(async () => {
  // 初始化窗口位置（右下角）
  initWindowPosition()

  // 加载设置和会话数据
  await settings.load()
  await convStore.load()
  await memoryStore.load()

  // 如果没有会话，创建一个新会话
  if (convStore.conversations.length === 0) {
    convStore.createConversation(settings.activeProfileId)
  }

  // 补上迁移会话的 profileId
  if (convStore.activeConversation && !convStore.activeConversation.profileId) {
    convStore.activeConversation.profileId = settings.activeProfileId
  }

  agent.value = createAgent({
    doc,
    editor,
    getConfig: () => settings.getModelConfig(),
    canvasEl: () => document.querySelector('.editor-canvas') as HTMLElement | null,
    enableWebSearch: () => localWebSearch.value,
    memory: memoryStore,
  })
})

/** 新建会话 */
function handleNewConversation() {
  if (sending.value) return
  convStore.createConversation(settings.activeProfileId)
  localWebSearch.value = true
  attachedImages.value = []
}

/** 切换会话 */
function handleSwitchConversation(id: string) {
  if (sending.value) return
  convStore.switchConversation(id)
}

/** 请求删除会话 */
function requestDeleteConversation(id: string) {
  deleteTargetId.value = id
}

/** 确认删除会话 */
function confirmDeleteConversation() {
  if (deleteTargetId.value) {
    convStore.deleteConversation(deleteTargetId.value)
  }
  deleteTargetId.value = null
}

/** 取消删除 */
function cancelDelete() {
  deleteTargetId.value = null
}

/** 开始重命名会话 */
function startRename(id: string, title: string) {
  renamingId.value = id
  renameInput.value = title
  nextTick(() => {
    const el = document.querySelector('.rename-input') as HTMLInputElement | null
    if (el) {
      el.focus()
      el.select()
    }
  })
}

/** 确认重命名 */
function confirmRename() {
  if (renamingId.value && renameInput.value.trim()) {
    convStore.renameConversation(renamingId.value, renameInput.value.trim())
  }
  renamingId.value = null
}

/** 取消重命名 */
function cancelRename() {
  renamingId.value = null
}

/** 切换左侧面板折叠 */
function toggleSidebar() {
  sidebarAnimating.value = true
  if (sidebarCollapsed.value) {
    // 展开：窗口变宽，左移
    windowSize.value.w += SIDEBAR_DELTA
    windowPos.value.x -= SIDEBAR_DELTA
  } else {
    // 折叠：窗口变窄，右移
    windowSize.value.w -= SIDEBAR_DELTA
    windowPos.value.x += SIDEBAR_DELTA
  }
  // 折叠/展开后钳制到视口内,避免越界
  const clamped = clampToViewport(windowPos.value.x, windowPos.value.y, windowSize.value.w, windowSize.value.h)
  windowPos.value = clamped
  sidebarCollapsed.value = !sidebarCollapsed.value
  // 动画结束后移除动画类，避免影响拖动/调整大小
  setTimeout(() => {
    sidebarAnimating.value = false
  }, 200)
}

/** 切换 Profile */
function handleSelectProfile(id: string) {
  settings.setActiveProfile(id)
  // 更新当前会话的 profileId
  if (convStore.activeConversation) {
    convStore.activeConversation.profileId = id
    convStore.save()
  }
  showProfileDropdown.value = false
}

/** 跳转到设置页 */
function goToSettings() {
  showProfileDropdown.value = false
  router.push('/settings')
}

/** 停止生成 */
function stopGeneration() {
  if (abortController.value) {
    abortController.value.abort()
    abortController.value = null
  }
}

/** 执行对话 */
async function execute() {
  if (!input.value.trim() || sending.value || !agent.value || !convStore.activeConversation) return
  const userText = input.value
  input.value = ''

  const conv = convStore.activeConversation
  const convId = conv.id

  // 构建消息内容
  const hasImages = attachedImages.value.length > 0 && caps.value.vision
  let userContent: string | MessageContent[]
  if (hasImages) {
    // 先把图片保存到 vault 的 assets 目录，获取相对路径
    const savedImagePaths: string[] = []
    if (isTauri() && doc.vaultRoot) {
      for (const img of attachedImages.value) {
        try {
          const binaryStr = atob(img.base64)
          const bytes = new Uint8Array(binaryStr.length)
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i)
          }
          const ext = img.mimeType.split('/')[1]?.split(';')[0] || 'png'
          const relPath = await writeImageToVault(doc.vaultRoot, doc.activeTabPath ?? '', bytes, ext)
          if (relPath) savedImagePaths.push(relPath)
        } catch (e) {
          console.error('保存图片到 vault 失败:', e)
        }
      }
    }
    // 构建消息文本：用户原文 + 图片路径提示（给AI看，方便它插入文档）
    // 用特殊标记包裹给 AI 的提示，UI 渲染时过滤掉这部分
    let textWithImageInfo = userText
    if (savedImagePaths.length > 0) {
      const imageInfo = savedImagePaths.map((p, i) => `图片${i + 1}: ${p}`).join('，')
      const aiHint = '__AI_INTERNAL__: 以下图片已保存到 vault，路径如上。如需将图片插入文档，可直接使用上述路径调用 insert_block 工具，type=image，src 填相对路径（相对文档所在目录）。__AI_INTERNAL_END__'
      textWithImageInfo = userText
        ? `${userText}\n${imageInfo}\n${aiHint}`
        : `${imageInfo}\n${aiHint}`
    }
    const parts: MessageContent[] = [{ type: 'text', text: textWithImageInfo }]
    for (const img of attachedImages.value) {
      parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })
    }
    userContent = parts
    attachedImages.value = []
  } else {
    userContent = userText
    if (attachedImages.value.length > 0) attachedImages.value = []
  }

  // 不在此处推入消息 — agent.chat() 负责推入 user 和 assistant 消息
  // agent 会在流式输出前推入空 assistant，onDelta 回调更新它

  sending.value = true
  let accumulatedContent = ''
  let isAborted = false

  const controller = agent.value.chat(
    conv.messages,
    userContent,
    {
      onDelta: (text) => {
        accumulatedContent += text
        convStore.updateLastMessage(convId, accumulatedContent)
      },
      onToolCall: (toolName, _args, result) => {
        if (result.data === '__calling__') {
          toolStatus.value = 'calling'
          currentToolName.value = toolName
          currentToolResult.value = null
        } else {
          toolStatus.value = 'completed'
          currentToolResult.value = result
          setTimeout(() => {
            toolStatus.value = 'idle'
            currentToolName.value = ''
            currentToolResult.value = null
          }, 2000)
        }
      },
      onError: (err) => {
        convStore.addMessage(convId, { role: 'assistant', content: `⚠️ ${err}` })
      },
      onComplete: () => {
        if (!isAborted) {
          sending.value = false
          abortController.value = null
          // 若最后 assistant 消息仍为空，移除它
          const lastMsg = conv.messages[conv.messages.length - 1]
          if (lastMsg && lastMsg.role === 'assistant' && (!lastMsg.content || lastMsg.content === '')) {
            conv.messages.pop()
          }
          // 持久化
          convStore.flushSave()
        }
      },
    }
  )

  abortController.value = controller

  controller.signal.addEventListener('abort', () => {
    isAborted = true
    sending.value = false
    abortController.value = null
    // 若最后 assistant 消息仍为空，移除它
    const lastMsg = conv.messages[conv.messages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant' && (!lastMsg.content || lastMsg.content === '')) {
      conv.messages.pop()
    }
    // 持久化
    convStore.flushSave()
  })
}

/** 选择图片 */
function onImageSelect(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue
    if (attachedImages.value.length >= 3) break
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      attachedImages.value.push({ name: file.name, base64, mimeType: file.type })
    }
    reader.readAsDataURL(file)
  }
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function removeImage(index: number) {
  attachedImages.value.splice(index, 1)
}

/** 处理粘贴图片 */
function onPaste(e: ClipboardEvent) {
  if (!caps.value.vision) return
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) continue
      if (attachedImages.value.length >= 3) break

      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        attachedImages.value.push({ name: file.name, base64, mimeType: file.type })
      }
      reader.readAsDataURL(file)
    }
  }
}

/** 工具名映射 */
function formatToolName(name: string): string {
  return TOOL_LABELS[name] ?? name
}

/** 区块类型 → 中文名 */
const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: '段落',
  heading: '标题',
  list: '列表',
  divider: '分割线',
  page_break: '分页符',
  quote: '引用',
  code_block: '代码块',
  table: '表格',
  image: '图片',
}

function blockTypeLabel(type?: string): string {
  return type ? (BLOCK_TYPE_LABELS[type] ?? type) : ''
}

/**
 * 格式化工具执行结果为友好中文摘要(UI 显示)
 * 与 agent.ts 的 formatToolResultForAI 不同,这里只输出简短摘要给用户看
 */
function formatToolResult(toolName: string, result: ToolResult): string {
  if (!result.ok) {
    return `${formatToolName(toolName)}失败: ${result.error ?? '未知错误'}`
  }
  const data = result.data
  const r = result as ToolResult & { total?: number }
  switch (toolName) {
    case 'insert_block': {
      const d = data as { type?: string; index?: number }
      return `已插入${blockTypeLabel(d.type)}区块${d.index != null ? `,位置=${d.index}` : ''}`
    }
    case 'update_block':
      return `已更新区块`
    case 'delete_block':
      return `已删除区块`
    case 'move_block': {
      const d = data as { direction?: string }
      return `已${d.direction === 'up' ? '上移' : '下移'}区块`
    }
    case 'convert_block': {
      const d = data as { type?: string }
      return `已转换为${blockTypeLabel(d.type)}`
    }
    case 'batch_edit': {
      const d = data as { total?: number; success?: number; failed?: number }
      return `批量操作: 成功 ${d.success ?? 0}/${d.total ?? 0}`
    }
    case 'replace_document': {
      const d = data as { blockCount?: number }
      return `已替换文档,共 ${d.blockCount ?? 0} 个区块`
    }
    case 'list_blocks': {
      const items = (data ?? []) as unknown[]
      const total = r.total ?? items.length
      return `已列出 ${total} 个区块`
    }
    case 'search_files': {
      const files = (data ?? []) as string[]
      return `找到 ${files.length} 个文件`
    }
    case 'read_file': {
      const text = String(data ?? '')
      return `已读取文件,共 ${text.length} 字`
    }
    case 'write_file': {
      const d = data as { path?: string }
      return `已写入文件 ${d.path ?? ''}`
    }
    case 'create_file': {
      const d = data as { path?: string }
      return `已创建文件 ${d.path ?? ''}`
    }
    case 'list_dir': {
      const items = (data ?? []) as unknown[]
      return `已列出 ${items.length} 个节点`
    }
    case 'switch_tab':
      return `已切换标签`
    case 'get_document': {
      const text = String(data ?? '')
      return `已获取文档,共 ${text.length} 字`
    }
    case 'get_outline': {
      const items = (data ?? []) as unknown[]
      return `已获取大纲,共 ${items.length} 个条目`
    }
    case 'web_search': {
      const text = String(data ?? '')
      // 数以"数字."开头的行为实际结果条数（每条结果占标题/摘要/链接多行）
      const matches = text.match(/^\d+\.\s/gm)
      const count = matches ? matches.length : 0
      return `已搜索到 ${Math.max(1, count)} 条结果`
    }
    case 'save_memory': {
      const d = data as { category?: string }
      return `已保存记忆(${d?.category ?? ''})`
    }
    case 'list_memory':
      return `已列出记忆`
    case 'search_memory': {
      const text = String(data ?? '')
      const matches = text.match(/^\d+\.\s/gm)
      const count = matches ? matches.length : 0
      return `已找到 ${count} 条相关记忆`
    }
    default:
      return `已完成 ${formatToolName(toolName)}`
  }
}

/** 从消息内容中提取图片列表 */
function extractImages(content: string | MessageContent[]): Array<{ url: string }> {
  if (!content || !Array.isArray(content)) return []
  return content
    .filter((p): p is { type: 'image_url'; image_url: { url: string } } => p.type === 'image_url')
    .map((p) => ({ url: p.image_url.url }))
}

/** 渲染消息内容 */
function renderContent(role: string, content: string | MessageContent[]): string {
  const text = extractText(content)
  if (role === 'assistant') return renderMarkdown(text)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 关闭 Profile 下拉（点击外部） */
function closeProfileDropdown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.profile-selector-wrapper')) {
    showProfileDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', closeProfileDropdown)
})
onUnmounted(() => {
  document.removeEventListener('click', closeProfileDropdown)
})
</script>

<template>
  <!-- 展开态浮窗 -->
  <div
    v-if="isOpen"
    class="ai-floating"
    :class="{ 'floating-animating': sidebarAnimating }"
    :style="{ left: `${windowPos.x}px`, top: `${windowPos.y}px`, width: `${windowSize.w}px`, height: `${windowSize.h}px` }"
  >
    <!-- 标题栏 -->
    <div class="title-bar" @pointerdown="onPointerDown">
      <div class="title-left">
        <img :src="AiIconUrl" class="shark-icon" alt="UU鲨" />
        <span class="title-text">UU鲨</span>
      </div>

      <!-- Profile 选择器 -->
      <div class="profile-selector-wrapper">
        <button class="profile-selector" @click.stop="showProfileDropdown = !showProfileDropdown">
          <span class="cap-dot" :class="{ on: caps.nativeSearch || caps.webSearch, off: !caps.nativeSearch && !caps.webSearch }" title="联网搜索"></span>
          <span class="cap-dot" :class="{ on: caps.vision, off: !caps.vision }" title="图片理解"></span>
          <span class="profile-name">{{ activeProfile?.name ?? '未配置' }}</span>
          <svg class="chevron" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 4L5 6L7 4" />
          </svg>
        </button>
        <!-- 下拉菜单 -->
        <div v-if="showProfileDropdown" class="profile-dropdown" @click.stop>
          <div
            v-for="p in settings.profiles"
            :key="p.id"
            class="dropdown-item"
            :class="{ active: p.id === settings.activeProfileId }"
            @click="handleSelectProfile(p.id)"
          >
            <span class="check">{{ p.id === settings.activeProfileId ? '✓' : '' }}</span>
            <div class="dropdown-item-info">
              <span class="dropdown-item-name">{{ p.name }}</span>
              <span class="dropdown-item-model">{{ p.model }}</span>
            </div>
          </div>
          <div class="dropdown-sep"></div>
          <div class="dropdown-item manage" @click="goToSettings">
            <span class="check"></span>
            <span class="dropdown-item-name">管理配置...</span>
          </div>
        </div>
      </div>

      <div class="title-right">
        <button class="title-btn" title="新建会话" @click.stop="handleNewConversation">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M7 2V12M2 7H12" />
          </svg>
        </button>
        <button class="title-btn" title="最小化" @click.stop="editor.minimizeAiFloating()">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M3 7H11" />
          </svg>
        </button>
        <button class="title-btn" title="关闭" @click.stop="editor.closeAiFloating()">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M4 4L10 10M10 4L4 10" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 双栏主体 -->
    <div class="floating-body">
      <!-- 左侧：会话列表 -->
      <div class="conversation-panel" :class="{ collapsed: sidebarCollapsed }">
        <div class="conv-panel-header">
          <button class="collapse-btn" @click="toggleSidebar" :title="sidebarCollapsed ? '展开会话列表' : '折叠会话列表'">
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="!sidebarCollapsed" d="M3 2L6 5L3 8" />
              <path v-else d="M7 2L4 5L7 8" />
            </svg>
          </button>
          <span v-if="!sidebarCollapsed" class="conv-panel-title">会话</span>
        </div>
        <button v-if="!sidebarCollapsed" class="new-conv-btn" @click="handleNewConversation">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M7 3V11M3 7H11" />
          </svg>
          <span>新建会话</span>
        </button>
        <div v-if="!sidebarCollapsed" class="conversation-list no-scrollbar">
          <div
            v-for="conv in sortedConversations"
            :key="conv.id"
            class="conv-item"
            :class="{ active: conv.id === convStore.activeConversationId }"
            @click="handleSwitchConversation(conv.id)"
            @dblclick.stop="startRename(conv.id, conv.title)"
          >
            <input
              v-if="renamingId === conv.id"
              v-model="renameInput"
              class="rename-input"
              @click.stop
              @blur="confirmRename"
              @keydown.enter.prevent="confirmRename"
              @keydown.esc.prevent="cancelRename"
            />
            <span v-else class="conv-title">{{ conv.title }}</span>
            <div class="conv-actions">
              <button
                class="conv-action-btn"
                title="重命名"
                @click.stop="startRename(conv.id, conv.title)"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 3L10 4L6 8H5V7L9 3Z" />
                  <path d="M2 10H7" />
                </svg>
              </button>
              <button
                class="conv-action-btn delete"
                title="删除会话"
                @click.stop="requestDeleteConversation(conv.id)"
              >
                <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1.5 2.5H8.5M3.75 2.5V1.875C3.75 1.66789 3.91789 1.5 4.125 1.5H5.875C6.08211 1.5 6.25 1.66789 6.25 1.875V2.5M4.375 4.375V7.125M5.625 4.375V7.125M2.5 2.5L2.8125 7.75C2.84411 8.30711 3.30429 8.75 3.8625 8.75H6.1375C6.69571 8.75 7.15589 8.30711 7.1875 7.75L7.5 2.5" />
                </svg>
              </button>
            </div>
          </div>
          <div v-if="sortedConversations.length === 0" class="conv-empty">
            点击上方新建会话
          </div>
        </div>
        <!-- 折叠态：只显示图标 -->
        <div v-else class="collapsed-icons">
          <button
            v-for="conv in sortedConversations.slice(0, 8)"
            :key="conv.id"
            class="collapsed-conv-icon"
            :class="{ active: conv.id === convStore.activeConversationId }"
            :title="conv.title"
            @click="handleSwitchConversation(conv.id)"
          >
            {{ conv.title.slice(0, 1) }}
          </button>
          <button class="collapsed-new-btn" title="新建会话" @click="handleNewConversation">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M6 2V10M2 6H10" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 右侧：对话区 -->
      <div class="chat-panel">
        <!-- 工具状态条 -->
        <div v-if="toolStatus !== 'idle'" class="tool-status-bar" :class="toolStatus">
          <svg v-if="toolStatus === 'calling'" class="spinner" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M10 6A4 4 0 0 1 6 10" />
          </svg>
          <span>{{
            toolStatus === 'calling'
              ? `正在调用 ${formatToolName(currentToolName)}...`
              : (currentToolResult ? formatToolResult(currentToolName, currentToolResult) : `已完成 ${formatToolName(currentToolName)}`)
          }}</span>
        </div>

        <!-- 消息区 -->
        <div class="chat-messages no-scrollbar" ref="chatAreaRef">
          <div v-if="displayMessages.length === 0" class="empty-state">
            <img :src="AiIconUrl" class="empty-icon" alt="UU鲨" />
            <div class="empty-title">UU鲨已就绪</div>
            <div class="empty-desc">输入指令开始对话</div>
          </div>
          <div v-else class="messages" @click="handleExternalLinkClick">
            <div
              v-for="(msg, i) in displayMessages"
              :key="i"
              class="message-row"
              :class="msg.role === 'user' ? 'message-row-user' : 'message-row-ai'"
            >
              <div
                class="bubble"
                :class="{ 'md-bubble': msg.role === 'assistant' }"
              >
                <div v-if="extractImages(msg.content).length" class="bubble-images">
                  <img
                    v-for="(img, j) in extractImages(msg.content)"
                    :key="j"
                    :src="img.url"
                    class="bubble-image"
                    alt="发送的图片"
                  />
                </div>
                <div
                  v-if="extractText(msg.content).trim().length > 0"
                  v-html="renderContent(msg.role, msg.content)"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 图片预览行 -->
        <div v-if="attachedImages.length" class="image-preview-row">
          <div v-for="(img, i) in attachedImages" :key="i" class="image-thumb-wrapper">
            <img :src="`data:${img.mimeType};base64,${img.base64}`" class="image-thumb" />
            <button class="image-remove" @click="removeImage(i)">
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M2 2L8 8M8 2L2 8" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="chat-input-area">
          <div class="input-toolbar">
            <!-- 联网开关：支持原生联网或 function calling 时都显示 -->
            <button
              v-if="caps.webSearch || caps.nativeSearch"
              class="toolbar-btn"
              :class="{ active: localWebSearch }"
              :title="caps.nativeSearch ? '原生联网搜索' : '联网搜索'"
              @click="localWebSearch = !localWebSearch"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
                <circle cx="8" cy="8" r="6" />
                <ellipse cx="8" cy="8" rx="3" ry="6" />
                <line x1="2" y1="8" x2="14" y2="8" />
              </svg>
              <span>联网</span>
            </button>
            <button
              v-if="caps.vision"
              class="toolbar-btn"
              title="添加图片"
              @click="fileInputRef?.click()"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="12" height="10" rx="2" />
                <circle cx="6" cy="7" r="1.5" />
                <path d="M2 11L5.5 8L9 10.5L12 7.5L14 9.5" />
              </svg>
              <span>图片</span>
            </button>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              multiple
              style="display:none"
              @change="onImageSelect"
            />
          </div>
          <div class="input-row">
            <textarea
              v-model="input"
              class="chat-input"
              :placeholder="sending ? 'UU鲨正在响应...' : '输入指令... (Enter 发送)'"
              :disabled="sending"
              rows="2"
              @keydown.enter.exact.prevent="execute"
              @paste="onPaste"
            ></textarea>
            <button
              v-if="sending"
              class="stop-btn"
              title="停止生成"
              @click="stopGeneration"
            >
              <svg viewBox="0 0 14 14" fill="currentColor">
                <rect x="3" y="3" width="8" height="8" rx="1.5" />
              </svg>
            </button>
            <button
              v-else
              class="send-btn"
              :disabled="!input.trim()"
              @click="execute"
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 7L12 2L7 12L6 8L2 7Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除会话确认对话框 -->
    <div v-if="deleteTargetId" class="confirm-overlay" @click="cancelDelete">
      <div class="confirm-dialog" @click.stop>
        <div class="confirm-title">删除会话</div>
        <div class="confirm-desc">确定要删除这个会话吗？此操作不可恢复。</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="cancelDelete">取消</button>
          <button class="confirm-btn danger" @click="confirmDeleteConversation">删除</button>
        </div>
      </div>
    </div>

    <!-- 调整大小手柄 -->
    <div class="resize-handle" @pointerdown="onResizeDown"></div>
  </div>

  <!-- 最小化气泡 -->
  <button
    v-else-if="isMinimized"
    class="ai-bubble"
    title="展开 UU鲨"
    @click="editor.openAiFloating()"
  >
    <img :src="AiIconUrl" class="bubble-icon" alt="UU鲨" />
  </button>
</template>

<style scoped>
.ai-floating {
  position: fixed;
  left: 0;
  top: 0;
  min-width: 360px;
  min-height: 450px;
  display: flex;
  flex-direction: column;
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  box-shadow: var(--shadow-xl);
  z-index: 1000;
  overflow: hidden;
  font-family: var(--font-sans);
  user-select: none;
}
.floating-animating {
  transition: left 0.2s ease, width 0.2s ease;
}

/* ===== 标题栏 ===== */
.title-bar {
  height: 36px;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
  gap: 6px;
}
.title-left {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.shark-icon {
  width: 14px;
  height: 14px;
  object-fit: contain;
}
.title-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
}

/* Profile 选择器 */
.profile-selector-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  justify-content: center;
}
.profile-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid transparent;
  background: var(--muted);
  border-radius: var(--radius-button);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--popover-foreground);
  transition: none;
}
.profile-selector:hover {
  border-color: var(--border);
}
.cap-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cap-dot.on {
  background: var(--success);
}
.cap-dot.off {
  background: var(--muted-foreground);
  opacity: 0.4;
}
.profile-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chevron {
  width: 10px;
  height: 10px;
  color: var(--icon-muted);
  flex-shrink: 0;
}

/* Profile 下拉菜单 */
.profile-dropdown {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 4px;
  min-width: 200px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  box-shadow: var(--shadow-md);
  z-index: 10;
  padding: 4px;
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-button);
  cursor: pointer;
  font-size: 12px;
}
.dropdown-item:hover {
  background: var(--accent);
}
.dropdown-item.active {
  color: var(--primary);
}
.dropdown-item .check {
  width: 14px;
  flex-shrink: 0;
  text-align: center;
  font-weight: 600;
}
.dropdown-item-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
}
.dropdown-item-name {
  font-weight: 500;
}
.dropdown-item-model {
  font-size: 11px;
  color: var(--muted-foreground);
}
.dropdown-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.dropdown-item.manage {
  color: var(--muted-foreground);
}

/* 标题栏按钮 */
.title-right {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.title-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--icon-muted);
  border-radius: var(--radius-button);
  cursor: pointer;
}
.title-btn:hover {
  background: var(--muted);
  color: var(--popover-foreground);
}
.title-btn svg {
  width: 14px;
  height: 14px;
}

/* ===== 双栏主体 ===== */
.floating-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧会话列表 */
.conversation-panel {
  width: 160px;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--card);
  transition: width 0.2s ease, min-width 0.2s ease;
  flex-shrink: 0;
}
.conversation-panel.collapsed {
  width: 48px;
  min-width: 48px;
}
.conv-panel-header {
  display: flex;
  align-items: center;
  padding: 8px;
  gap: 6px;
  border-bottom: 1px solid var(--border);
}
.collapse-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  border-radius: var(--radius-tag);
}
.collapse-btn:hover {
  background: var(--muted);
  color: var(--popover-foreground);
}
.collapse-btn svg {
  width: 12px;
  height: 12px;
}
.conv-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--popover-foreground);
  font-family: var(--font-sans);
}
.new-conv-btn {
  margin: 8px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
}
.new-conv-btn:hover {
  background: var(--muted);
  color: var(--popover-foreground);
}
.new-conv-btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 8px;
}
.conv-item {
  position: relative;
  padding: 7px 26px 7px 10px;
  border-radius: var(--radius-button);
  cursor: pointer;
  overflow: hidden;
}
.conv-item:hover {
  background: var(--muted);
}
.conv-item.active {
  background: var(--conversation-active-bg);
}
.conv-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--conversation-active-bar);
}
.conv-title {
  font-size: 12px;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  padding-left: 2px;
}
.conv-item.active .conv-title {
  color: var(--primary);
}
.rename-input {
  width: 100%;
  padding: 0;
  border: 1px solid var(--primary);
  border-radius: 3px;
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 12px;
  font-family: var(--font-sans);
  outline: none;
  user-select: text;
}
.conv-actions {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}
.conv-item:hover .conv-actions {
  opacity: 1;
}
.conv-action-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--popover);
  border-radius: var(--radius-tag);
  color: var(--muted-foreground);
  cursor: pointer;
}
.conv-action-btn:hover {
  background: var(--muted);
  color: var(--popover-foreground);
}
.conv-action-btn.delete:hover {
  background: var(--destructive);
  color: var(--destructive-foreground);
}
.conv-action-btn svg {
  width: 12px;
  height: 12px;
}
.conv-empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--muted-foreground);
}

/* 折叠态图标模式 */
.collapsed-icons {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 6px;
  overflow-y: auto;
}
.collapsed-conv-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.collapsed-conv-icon:hover {
  background: var(--secondary);
  color: var(--secondary-foreground);
}
.collapsed-conv-icon.active {
  background: var(--primary);
  color: var(--primary-foreground);
}
.collapsed-new-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: auto;
}
.collapsed-new-btn:hover {
  background: var(--muted);
  color: var(--popover-foreground);
}
.collapsed-new-btn svg {
  width: 14px;
  height: 14px;
}

/* 右侧对话区 */
.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* 工具状态条 */
.tool-status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 11px;
  color: var(--muted-foreground);
  border-bottom: 1px solid var(--border);
}
.tool-status-bar.calling {
  color: var(--primary);
}
.tool-status-bar.completed {
  color: var(--success);
}
.tool-status-bar .spinner {
  width: 12px;
  height: 12px;
  animation: spin 1s linear infinite;
}

/* 消息区 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  user-select: text;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--muted-foreground);
}
.empty-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  opacity: 0.4;
}
.empty-title {
  font-size: 13px;
  font-weight: 500;
}
.empty-desc {
  font-size: 11px;
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.message-row {
  display: flex;
}
.message-row-user {
  justify-content: flex-end;
}
.message-row-ai {
  justify-content: flex-start;
}
.bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: var(--radius-compact);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  user-select: text;
}
.message-row-user .bubble {
  background: var(--primary);
  color: var(--primary-foreground);
}
.message-row-ai .bubble {
  background: var(--muted);
  color: var(--popover-foreground);
}
.bubble-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.bubble-image {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  object-fit: contain;
  cursor: zoom-in;
}

/* 图片预览行 */
.image-preview-row {
  display: flex;
  gap: 8px;
  padding: 0 12px 8px;
}
.image-thumb-wrapper {
  position: relative;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
}
.image-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-compact);
  border: 1px solid var(--border);
}
.image-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--destructive);
  color: var(--destructive-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.image-remove svg {
  width: 8px;
  height: 8px;
}

/* 输入区 */
.chat-input-area {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}
.input-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
}
.toolbar-btn:hover {
  background: var(--muted);
  color: var(--popover-foreground);
}
.toolbar-btn.active {
  background: var(--primary);
  color: var(--primary-foreground);
  border-color: var(--primary);
}
.toolbar-btn svg {
  width: 14px;
  height: 14px;
}
.input-row {
  display: flex;
  gap: 6px;
  align-items: flex-end;
}
.chat-input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-button);
  background: var(--secondary);
  padding: 6px 10px;
  font-size: 12px;
  font-family: var(--font-sans);
  color: var(--foreground);
  resize: none;
  outline: none;
  line-height: 1.5;
  user-select: text;
}
.chat-input:focus {
  border-color: var(--ring);
  box-shadow: 0 0 0 1px var(--ring);
}
.chat-input::placeholder {
  color: var(--muted-foreground);
}
.chat-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-button);
  background: var(--primary);
  color: var(--primary-foreground);
  border: none;
  flex-shrink: 0;
  cursor: pointer;
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.send-btn:not(:disabled):hover {
  filter: brightness(0.96);
}
.send-btn svg {
  width: 14px;
  height: 14px;
}

.stop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-button);
  background: var(--destructive);
  color: var(--destructive-foreground);
  border: none;
  flex-shrink: 0;
  cursor: pointer;
  transition: filter 0.15s;
}
.stop-btn:hover {
  filter: brightness(0.96);
}
.stop-btn svg {
  width: 14px;
  height: 14px;
}

/* 调整大小手柄 */
.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 2;
}
.resize-handle::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--muted-foreground);
  border-bottom: 2px solid var(--muted-foreground);
  opacity: 0.5;
}
.resize-handle:hover::after {
  opacity: 1;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
.spinner {
  animation: spin 1s linear infinite;
}

/* 最小化气泡 */
.ai-bubble {
  position: fixed;
  right: 20px;
  bottom: calc(var(--statusbar-height) + 20px);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--primary);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  transition: transform 0.15s ease;
  border: none;
  cursor: pointer;
}
.ai-bubble:hover {
  transform: scale(1.05);
}
.bubble-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  border-radius: 50%;
  background: var(--popover);
  padding: 2px;
}

/* ===== 确认对话框 ===== */
.confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.confirm-dialog {
  width: 280px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  padding: 16px;
  box-shadow: var(--shadow-xl);
}
.confirm-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--foreground);
}
.confirm-desc {
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.6;
  margin-bottom: 16px;
}
.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.confirm-btn {
  padding: 6px 14px;
  border-radius: var(--radius-button);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--secondary);
  color: var(--foreground);
}
.confirm-btn:hover {
  background: var(--accent);
}
.confirm-btn.danger {
  background: var(--destructive);
  color: var(--destructive-foreground);
  border-color: var(--destructive);
}
.confirm-btn.danger:hover {
  filter: brightness(0.96);
}

/* ===== Markdown 渲染样式 ===== */
.md-bubble :deep(.md-h) {
  font-weight: 600;
  margin: 6px 0 4px;
  line-height: 1.3;
}
.md-bubble :deep(.md-h1) { font-size: 15px; }
.md-bubble :deep(.md-h2) { font-size: 14px; }
.md-bubble :deep(.md-h3) { font-size: 13px; }
.md-bubble :deep(.md-h4),
.md-bubble :deep(.md-h5),
.md-bubble :deep(.md-h6) { font-size: 12px; }
.md-bubble :deep(.md-p) {
  margin: 4px 0;
  line-height: 1.6;
}
.md-bubble :deep(.md-ul),
.md-bubble :deep(.md-ol) {
  margin: 4px 0;
  padding-left: 20px;
}
.md-bubble :deep(.md-li) {
  margin: 2px 0;
  line-height: 1.5;
}
.md-bubble :deep(.md-task) {
  list-style: none;
  margin-left: -16px;
}
.md-bubble :deep(.md-task input) {
  margin-right: 6px;
  vertical-align: middle;
}
.md-bubble :deep(.md-pre) {
  background: var(--code-bg);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
}
.md-bubble :deep(.md-code) {
  background: var(--code-bg);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.md-bubble :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 8px 0;
}
.md-bubble :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 10px;
  margin: 6px 0;
  color: var(--muted-foreground);
  font-size: 11px;
}
.md-bubble :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.md-bubble :deep(strong) { font-weight: 600; }
.md-bubble :deep(em) { font-style: italic; }
.md-bubble :deep(del) { text-decoration: line-through; }

/* 表格 */
.md-bubble :deep(.md-table) {
  border-collapse: collapse;
  width: 100%;
  margin: 6px 0;
  font-size: 11px;
}
.md-bubble :deep(.md-th),
.md-bubble :deep(.md-td) {
  border: 1px solid var(--border);
  padding: 4px 8px;
  line-height: 1.4;
}
.md-bubble :deep(.md-th) {
  background: var(--code-bg);
  font-weight: 600;
}
.md-bubble :deep(.md-td) {
  vertical-align: top;
}
</style>
