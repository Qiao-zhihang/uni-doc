<script setup lang="ts">
/**
 * 状态栏(改造版)
 * 参考 UI 改造方案 §3.2.G 和设计稿 editor-light.html
 * 高度 24px,中间显示软件署名;右下角演示按钮方便够不到顶部工具栏的用户
 * 左侧显示三态保存状态:编辑中…(橙)/ 保存中…(蓝脉冲)/ 已保存(绿)
 */
import { computed } from 'vue'
import { Presentation } from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'

const doc = useDocumentStore()
const editor = useEditorStore()

const emit = defineEmits<{ (e: 'presentation'): void }>()

const saveStatusText = computed(() => {
  switch (doc.savedStatus) {
    case 'unsaved':
      return '编辑中…'
    case 'saving':
      return '保存中…'
    case 'saved':
      return '已保存'
    default:
      return '已保存'
  }
})
const saveStatusClass = computed(() => doc.savedStatus)
</script>

<template>
  <div class="status-bar">
    <!-- 左侧 -->
    <div class="group">
      <div class="save-status" :class="saveStatusClass">
        <span class="dot"></span>
        <span>{{ saveStatusText }}</span>
      </div>
      <span class="sep"></span>
      <span>{{ doc.wordCount.toLocaleString() }} 字</span>
      <span class="sep"></span>
      <span>{{ doc.blockCount }} 区块</span>
      <span class="sep"></span>
      <span>{{ doc.pageCount }} 页</span>
    </div>
    <!-- 中间:软件署名 -->
    <span class="copyright">Copyright © 2026 Qiao Zhihang. All Rights Reserved.</span>
    <!-- 右侧 -->
    <div class="group">
      <button class="zoom-btn" title="缩小" @click="editor.zoomOut">−</button>
      <span class="zoom-value">{{ editor.zoom }}%</span>
      <button class="zoom-btn" title="放大" @click="editor.zoomIn">+</button>
      <span class="sep"></span>
      <button
        class="present-btn"
        :disabled="doc.openTabs.length === 0"
        title="演示模式(F5)"
        @click="emit('presentation')"
      >
        <Presentation :size="12" />
        <span>演示</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--statusbar-height);
  padding: 0 16px;
  flex-shrink: 0;
  background: var(--sidebar);
  border-top: 1px solid var(--sidebar-border);
  font-size: 11.5px;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  z-index: 10;
}
.group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
}
.save-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  user-select: none;
}
.save-status .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transition: background var(--transition-base), transform var(--transition-fast);
  background: var(--muted-foreground);
}
.save-status.unsaved .dot {
  background: #f59e0b;
}
.save-status.saving .dot {
  background: #3b82f6;
  animation: save-pulse 1s ease-in-out infinite;
}
.save-status.saved .dot {
  background: var(--state-success);
}
@keyframes save-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(1.35);
  }
}
.copyright {
  color: var(--muted-foreground);
  font-size: 10.5px;
  letter-spacing: 0.2px;
  user-select: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}
.sep {
  width: 1px;
  height: 12px;
  background: var(--glass-border);
}
.zoom-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-tag);
  font-size: 14px;
  color: var(--muted-foreground);
  transition: background var(--transition-base), color var(--transition-base), transform var(--transition-fast);
}
.zoom-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
  transform: translateY(-1px);
}
.zoom-value {
  min-width: 46px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.present-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 10px;
  border-radius: var(--radius-button);
  font-size: 11px;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: all var(--transition-base), transform var(--transition-fast);
}
.present-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
  transform: translateY(-1px);
}
.present-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
