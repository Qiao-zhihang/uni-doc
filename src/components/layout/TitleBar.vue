<script setup lang="ts">
/**
 * 标题栏(改造版)
 * 参考 UI 改造方案 §3.2.F 和设计稿 editor-light.html
 * 高度 32px,显示窗口控制区 + 文档路径面包屑 + 保存状态
 * 面包屑从 active tab 的 path 解析
 */
import { computed, ref } from 'vue'
import { useDocumentStore } from '@/stores/document'

const doc = useDocumentStore()

const vaultName = computed(() => {
  if (!doc.vaultRoot) return 'uni-doc'
  const parts = doc.vaultRoot.split(/[\\/]/)
  return parts[parts.length - 1] || 'vault'
})

const title = computed(() => doc.meta.title)
const saved = computed(() => doc.savedStatus === 'saved')

// 面包屑路径(从 active tab 的 path 解析)
const breadcrumbs = computed<string[]>(() => {
  const tab = doc.openTabs.find((t) => t.id === doc.activeTabId)
  if (!tab || !tab.path) return []
  return tab.path.split('/').slice(0, -1) // 去掉文件名
})

const editing = ref(false)
const inputValue = ref('')

function startEdit() {
  inputValue.value = title.value
  editing.value = true
}

function commitEdit() {
  if (inputValue.value.trim()) {
    doc.setTitle(inputValue.value.trim())
  }
  editing.value = false
}
</script>

<template>
  <div class="title-bar">
    <!-- 面包屑路径 -->
    <div class="breadcrumb">
      <span class="crumb vault">{{ vaultName }}</span>
      <template v-for="(crumb, i) in breadcrumbs" :key="i">
        <span class="sep">/</span>
        <span class="crumb">{{ crumb }}</span>
      </template>
      <span class="sep">/</span>
      <input
        v-if="editing"
        v-model="inputValue"
        class="title-input"
        @blur="commitEdit"
        @keydown.enter="commitEdit"
        @keydown.esc="editing = false"
      />
      <span v-else class="crumb title" @dblclick="startEdit">{{ title }}</span>
      <span class="crumb-ext">.md</span>
    </div>

    <div class="spacer"></div>

    <!-- 保存状态 -->
    <div class="save-status">
      <span class="dot" :class="{ saved }"></span>
      <span>{{ saved ? '已保存' : '未保存' }}</span>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  height: var(--titlebar-height);
  padding: 0 12px;
  flex-shrink: 0;
  background: var(--background);
  border-bottom: 1px solid var(--border);
  gap: 8px;
  user-select: none;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}
.crumb {
  color: var(--muted-foreground);
  white-space: nowrap;
}
.crumb.vault {
  color: var(--foreground);
  font-weight: 500;
}
.crumb.title {
  color: var(--foreground);
  cursor: text;
}
.crumb-ext {
  font-size: 11px;
  color: var(--muted-foreground);
}
.sep {
  color: var(--muted-foreground);
  opacity: 0.6;
}
.title-input {
  font-size: 12px;
  color: var(--foreground);
  background: var(--secondary);
  border: 1px solid var(--ring);
  border-radius: var(--radius-button);
  padding: 1px 6px;
  outline: none;
  min-width: 160px;
}
.spacer {
  flex: 1;
}
.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted-foreground);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted-foreground);
  transition: background 0.2s ease;
}
.dot.saved {
  background: var(--state-success);
}
</style>
