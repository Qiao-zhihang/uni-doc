<script setup lang="ts">
/**
 * 状态栏(改造版)
 * 参考 UI 改造方案 §3.2.G 和设计稿 editor-light.html
 * 高度 24px,中间显示软件署名;右下角演示按钮方便够不到顶部工具栏的用户
 */
import { Presentation } from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'

const doc = useDocumentStore()
const editor = useEditorStore()

const emit = defineEmits<{ (e: 'presentation'): void }>()
</script>

<template>
  <div class="status-bar">
    <!-- 左侧 -->
    <div class="group">
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
      <button class="zoom-btn" @click="editor.zoomOut" title="缩小">−</button>
      <span class="zoom-value">{{ editor.zoom }}%</span>
      <button class="zoom-btn" @click="editor.zoomIn" title="放大">+</button>
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
  padding: 0 12px;
  flex-shrink: 0;
  background: var(--background);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted-foreground);
}
.group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.copyright {
  color: var(--muted-foreground);
  font-size: 10px;
  letter-spacing: 0.2px;
  user-select: none;
}
.sep {
  width: 1px;
  height: 12px;
  background: var(--border);
}
.zoom-btn {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 14px;
  color: var(--muted-foreground);
}
.zoom-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.zoom-value {
  min-width: 44px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.present-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 8px;
  border-radius: var(--radius-button);
  font-size: 11px;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.present-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.present-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
