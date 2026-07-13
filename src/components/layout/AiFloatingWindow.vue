<script setup lang="ts">
/**
 * AI 独立浮窗
 * 参考 UI 改造方案 §3.2.E 和设计稿 ai-floating-expanded.html / ai-floating-minimized.html
 * 380×540 浮窗 + 最小化气泡,可拖拽(标题栏)
 * M3:接入真实 Agent,支持流式输出 / 工具调用展示 / 错误气泡
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { Minus, X, SendHorizontal, Eraser, Loader2 } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'
import { useDocumentStore } from '@/stores/document'
import { useSettingsStore } from '@/stores/settings'
import { createAgent, type Agent } from '@/ai/agent'
import { renderMarkdown } from '@/ai/markdown'
import AiIconUrl from '@/assets/UUshark/icon.svg'

const editor = useEditorStore()
const doc = useDocumentStore()
const settings = useSettingsStore()
const agent = ref<Agent | null>(null)
const sending = ref(false)

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'error' | 'tool'
  content: string
}

const input = ref('')
const messages = ref<ChatMessage[]>([])
const toolStatus = ref<'idle' | 'calling' | 'completed'>('idle')
const currentToolName = ref('')
const showConfirmClear = ref(false)

const isOpen = computed(() => editor.aiFloatingState === 'expanded')
const isMinimized = computed(() => editor.aiFloatingState === 'minimized')

// 拖拽
const pos = ref({ x: 0, y: 0 })
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0, posX: 0, posY: 0 })

function onPointerDown(e: PointerEvent) {
  if (!isOpen.value) return
  dragging.value = true
  dragStart.value = {
    x: e.clientX,
    y: e.clientY,
    posX: pos.value.x,
    posY: pos.value.y
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  pos.value = {
    x: dragStart.value.posX + (e.clientX - dragStart.value.x),
    y: dragStart.value.posY + (e.clientY - dragStart.value.y)
  }
}

function onPointerUp() {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

onMounted(() => {
  agent.value = createAgent({
    doc,
    editor,
    getConfig: () => settings.getModelConfig(),
    canvasEl: () => document.querySelector('.editor-canvas') as HTMLElement | null
  })
  // 加载历史消息
  agent.value.loadHistory().then((history) => {
    if (history.length > 0) {
      messages.value = history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    }
  })
})

async function execute() {
  if (!input.value.trim() || sending.value || !agent.value) return
  const userText = input.value
  messages.value.push({ role: 'user', content: userText })
  input.value = ''
  sending.value = true
  // 预先 push 一个空的 assistant 消息,流式 onDelta 时更新它
  const assistantMsg = reactive({ role: 'assistant' as const, content: '' })
  messages.value.push(assistantMsg)
  try {
    await agent.value.chat(userText, {
      onDelta: (text) => {
        assistantMsg.content += text
      },
      onToolCall: (toolName, _args, result) => {
        if (result.data === '__calling__') {
          toolStatus.value = 'calling'
          currentToolName.value = toolName
        } else {
          toolStatus.value = 'completed'
          setTimeout(() => {
            toolStatus.value = 'idle'
            currentToolName.value = ''
          }, 2000)
        }
      },
      onError: (err) => {
        // 替换最后一个 assistant 消息为错误气泡
        messages.value.push({ role: 'error', content: err })
      }
    })
  } catch (e) {
    messages.value.push({ role: 'error', content: e instanceof Error ? e.message : String(e) })
  } finally {
    sending.value = false
    // 若最后 assistant 消息仍为空（如出错前未流式输出）,移除它
    const last = messages.value[messages.value.length - 1]
    if (last && last.role === 'assistant' && !last.content) {
      messages.value.pop()
    }
  }
}

async function clearConversation() {
  if (!messages.value.length) return
  showConfirmClear.value = true
}

async function confirmClear() {
  showConfirmClear.value = false
  try {
    await agent.value?.clear()
    messages.value = []
  } catch (e) {
    console.error('清空对话失败:', e)
  }
}

function cancelClear() {
  showConfirmClear.value = false
}

/** 工具名映射为中文友好名称 */
const TOOL_LABELS: Record<string, string> = {
  get_document: '获取文档',
  get_outline: '获取大纲',
  list_blocks: '列出区块',
  insert_block: '插入区块',
  update_block: '更新区块',
  delete_block: '删除区块',
  move_block: '移动区块',
  convert_block: '转换类型',
  batch_edit: '批量编辑',
  replace_document: '替换文档',
  search_files: '搜索文件',
  read_file: '读取文件',
  create_file: '创建文件',
  open_file: '打开文件',
  get_vault_tree: '获取文件树',
  switch_tab: '切换标签'
}

/** 把工具名转为中文标签 */
function formatToolName(name: string): string {
  return TOOL_LABELS[name] ?? name
}

/** assistant 消息渲染为 HTML（支持 Markdown 语法）;其他角色纯文本 */
function renderContent(role: string, content: string): string {
  if (role === 'assistant') return renderMarkdown(content)
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
</script>

<template>
  <!-- 展开态浮窗 -->
  <div
    v-if="isOpen"
    class="ai-floating"
    :style="{ transform: `translate(${pos.x}px, ${pos.y}px)` }"
  >
    <!-- 标题栏(可拖拽) -->
    <div class="float-header" @pointerdown="onPointerDown">
      <div class="header-left">
        <img :src="AiIconUrl" class="spark" alt="UU鲨" />
        <span class="title">UU鲨</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" title="清空对话" @click.stop="clearConversation" :disabled="!messages.length">
          <Eraser :size="14" />
        </button>
        <button class="icon-btn" title="最小化" @click.stop="editor.minimizeAiFloating()">
          <Minus :size="14" />
        </button>
        <button class="icon-btn" title="关闭" @click.stop="editor.closeAiFloating()">
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- 对话区 -->
    <div class="chat-area no-scrollbar">
      <div v-if="!messages.length" class="empty">
        <img :src="AiIconUrl" class="empty-icon" alt="UU鲨" />
        <div class="empty-title">UU鲨已就绪</div>
        <div class="empty-desc">输入指令开始对话</div>
      </div>
      <div v-else class="messages">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="msg"
          :class="msg.role"
        >
          <div class="msg-bubble" :class="{ 'md-bubble': msg.role === 'assistant' }" v-html="renderContent(msg.role, msg.content)"></div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-area">
      <div v-if="toolStatus !== 'idle'" class="tool-status" :class="toolStatus">
        <Loader2 v-if="toolStatus === 'calling'" :size="12" class="spin" />
        <span>{{ toolStatus === 'calling' ? `正在调用 ${formatToolName(currentToolName)}...` : `已完成 ${formatToolName(currentToolName)}` }}</span>
      </div>
      <div class="input-row">
        <textarea
          v-model="input"
          class="input"
          :placeholder="sending ? 'UU鲨正在响应...' : '输入指令... (Enter 发送)'"
          :disabled="sending"
          rows="2"
          @keydown.enter.prevent="execute"
        ></textarea>
        <button class="send-btn" :disabled="!input.trim() || sending" @click="execute">
          <Loader2 v-if="sending" :size="14" class="spin" />
          <SendHorizontal v-else :size="14" />
        </button>
      </div>
    </div>

    <!-- 清空确认对话框 -->
    <div v-if="showConfirmClear" class="confirm-overlay" @click="cancelClear">
      <div class="confirm-dialog" @click.stop>
        <div class="confirm-title">清空对话</div>
        <div class="confirm-desc">确定要清空所有对话历史吗？此操作不可恢复。</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="cancelClear">取消</button>
          <button class="confirm-btn danger" @click="confirmClear">确认清空</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 最小化气泡 -->
  <button
    v-else-if="isMinimized"
    class="ai-bubble"
    title="展开 UU鲨"
    @click="editor.openAiFloating()"
  >
    <img :src="AiIconUrl" class="bubble-icon" alt="UU鲨" />
    <span v-if="messages.length" class="badge">{{ messages.length }}</span>
  </button>
</template>

<style scoped>
.ai-floating {
  position: fixed;
  right: 16px;
  bottom: calc(var(--statusbar-height) + 16px);
  width: 380px;
  height: 540px;
  min-width: 300px;
  min-height: 400px;
  display: flex;
  flex-direction: column;
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius-compact);
  box-shadow: var(--shadow-xl);
  z-index: 1000;
  overflow: hidden;
}
.float-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 8px 0 12px;
  flex-shrink: 0;
  background: var(--popover);
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.spark {
  width: 14px;
  height: 14px;
  object-fit: contain;
}
.title {
  font-size: 12px;
  font-weight: 600;
}
.header-actions {
  display: flex;
  gap: 2px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-button);
  color: var(--muted-foreground);
}
.icon-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.empty {
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
.msg {
  display: flex;
}
.msg.user {
  justify-content: flex-end;
}
.msg.assistant {
  justify-content: flex-start;
}
.msg-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: var(--radius-compact);
  font-size: 12px;
  line-height: 1.6;
}
.msg.user .msg-bubble {
  background: var(--brand-500);
  color: var(--primary-foreground);
}
.msg.assistant .msg-bubble {
  background: var(--secondary);
  color: var(--foreground);
}
.msg.system {
  justify-content: center;
}
.msg.system .msg-bubble {
  background: transparent;
  color: var(--muted-foreground);
  font-size: 11px;
  padding: 4px 8px;
  max-width: 100%;
  text-align: center;
}
.msg.error {
  justify-content: center;
}
.msg.error .msg-bubble {
  background: var(--destructive);
  color: var(--destructive-foreground);
  border-radius: var(--radius-button);
  font-size: 11px;
  padding: 6px 10px;
  max-width: 90%;
}
.input-area {
  flex-shrink: 0;
  padding: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tool-status {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-button);
  font-size: 11px;
}
.tool-status.calling {
  background: var(--secondary);
  color: var(--brand-500);
}
.tool-status.completed {
  background: rgba(0, 180, 100, 0.1);
  color: rgba(0, 180, 100, 0.9);
}
.input-row {
  display: flex;
  gap: 6px;
  align-items: flex-end;
}
.input {
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
}
.input:focus {
  border-color: var(--ring);
  box-shadow: 0 0 0 1px var(--ring);
}
.input::placeholder {
  color: var(--muted-foreground);
}
.input:disabled {
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
  background: var(--brand-500);
  color: var(--primary-foreground);
  flex-shrink: 0;
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.send-btn:not(:disabled):hover {
  filter: brightness(0.96);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.spin {
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
  background: var(--brand-500);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  transition: transform 0.15s ease;
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
.badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--destructive);
  color: var(--destructive-foreground);
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ===== Markdown 渲染样式（assistant 消息） ===== */
.md-bubble {
  word-break: break-word;
}
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
  background: rgba(0, 0, 0, 0.08);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
}
.md-bubble :deep(.md-code) {
  background: rgba(0, 0, 0, 0.08);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
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
  color: var(--brand-500);
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
  background: rgba(0, 0, 0, 0.04);
  font-weight: 600;
}
.md-bubble :deep(.md-td) {
  vertical-align: top;
}

/* 确认对话框 */
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
</style>
