<script setup lang="ts">
/**
 * AI 独立浮窗
 * 参考 UI 改造方案 §3.2.E 和设计稿 ai-floating-expanded.html / ai-floating-minimized.html
 * 380×540 浮窗 + 最小化气泡,可拖拽(标题栏)
 * M1 占位:对话历史为空,执行仅清空输入(真实 AI 集成在 M3)
 */
import { computed, onUnmounted, ref } from 'vue'
import { Sparkles, Minus, X, SendHorizontal } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'

const editor = useEditorStore()

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const input = ref('')
const messages = ref<ChatMessage[]>([])
const modeTabs = [
  { key: 'chat', label: '对话' },
  { key: 'selection', label: '选区操作' },
  { key: 'document', label: '全文操作' }
]
const activeMode = ref<'chat' | 'selection' | 'document'>('chat')
const chips = ['全文润色', '生成目录', '优化表格', '摘要总结']

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

function execute() {
  if (!input.value.trim()) return
  messages.value.push({ role: 'user', content: input.value })
  input.value = ''
  // M1 占位:不调用真实 AI
}

function useChip(chip: string) {
  input.value = chip
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
        <Sparkles :size="14" class="spark" />
        <span class="title">AI 助手</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" title="最小化" @click.stop="editor.minimizeAiFloating()">
          <Minus :size="14" />
        </button>
        <button class="icon-btn" title="关闭" @click.stop="editor.closeAiFloating()">
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- 模式 Tab -->
    <div class="mode-tabs">
      <button
        v-for="m in modeTabs"
        :key="m.key"
        class="mode-btn"
        :class="{ active: activeMode === m.key }"
        @click="activeMode = m.key as typeof activeMode"
      >
        {{ m.label }}
      </button>
    </div>

    <!-- 对话区 -->
    <div class="chat-area no-scrollbar">
      <div v-if="!messages.length" class="empty">
        <Sparkles :size="28" class="empty-icon" />
        <div class="empty-title">AI 助手已就绪</div>
        <div class="empty-desc">输入指令或选择快捷操作开始对话</div>
      </div>
      <div v-else class="messages">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="msg"
          :class="msg.role"
        >
          <div class="msg-bubble">{{ msg.content }}</div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-area">
      <div class="chips-row no-scrollbar">
        <button
          v-for="chip in chips"
          :key="chip"
          class="chip"
          @click="useChip(chip)"
        >
          {{ chip }}
        </button>
      </div>
      <div class="input-row">
        <textarea
          v-model="input"
          class="input"
          placeholder="输入指令... (Enter 发送)"
          rows="2"
          @keydown.enter.prevent="execute"
        ></textarea>
        <button class="send-btn" :disabled="!input.trim()" @click="execute">
          <SendHorizontal :size="14" />
        </button>
      </div>
    </div>
  </div>

  <!-- 最小化气泡 -->
  <button
    v-else-if="isMinimized"
    class="ai-bubble"
    title="展开 AI 助手"
    @click="editor.openAiFloating()"
  >
    <Sparkles :size="20" />
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
  color: var(--brand-500);
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
.mode-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.mode-btn {
  flex: 1;
  height: 26px;
  border-radius: var(--radius-button);
  font-size: 11px;
  color: var(--muted-foreground);
}
.mode-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.mode-btn.active {
  background: var(--secondary);
  color: var(--foreground);
  font-weight: 500;
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
.input-area {
  flex-shrink: 0;
  padding: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chips-row {
  display: flex;
  gap: 4px;
  overflow-x: auto;
}
.chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  background: var(--secondary);
  color: var(--foreground);
  border: 1px solid var(--border);
}
.chip:hover {
  background: var(--accent);
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
</style>
