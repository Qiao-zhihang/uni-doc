<script setup lang="ts">
/**
 * 右侧大纲面板
 * 参考 UI 改造方案 §3.2.D 和设计稿 outline-panel.html
 * 240px 宽,三 Tab(大纲/标签/信息),大纲支持点击跳转 + 当前高亮 + 右键菜单
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { List, Tag, Info, Copy, Link2 } from 'lucide-vue-next'
import { useDocumentStore } from '@/stores/document'
import { useEditorStore } from '@/stores/editor'
import ContextMenu, { type MenuItem } from '@/components/common/ContextMenu.vue'

const doc = useDocumentStore()
const editor = useEditorStore()

const outline = computed(() => doc.outline)
const currentHeadingId = ref<string | null>(null)
// 正在跳转中的 heading id,滚动期间阻止 updateCurrentHeading 覆盖
const jumpingId = ref<string | null>(null)

// 右键菜单
const menu = ref<{ visible: boolean; x: number; y: number; entryId: string | null }>({
  visible: false,
  x: 0,
  y: 0,
  entryId: null
})

function indent(level: number) {
  return { paddingLeft: `${12 + (level - 1) * 16}px` }
}

/** 点击大纲项跳转到对应 block */
function jumpTo(entry: { id: string }) {
  const el = document.querySelector(`[data-block-id="${entry.id}"]`)
  if (!el) return
  // 标记正在跳转,滚动期间 updateCurrentHeading 不覆盖
  jumpingId.value = entry.id
  currentHeadingId.value = entry.id
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // 短暂高亮
  el.classList.add('outline-flash')
  setTimeout(() => el.classList.remove('outline-flash'), 1200)
  // 滚动结束后强制高亮(末尾标题无法滚到顶部时,scroll 事件判定会偏)
  const canvas = document.querySelector('.editor-canvas')
  if (canvas) {
    const onEnd = () => {
      canvas.removeEventListener('scrollend', onEnd)
      // 兜底:若干浏览器不支持 scrollend,由定时器保底
      clearTimeout(fallbackTimer)
      finishJump()
    }
    const finishJump = () => {
      currentHeadingId.value = entry.id
      jumpingId.value = null
    }
    canvas.addEventListener('scrollend', onEnd, { once: true })
    // 兜底定时器:smooth 滚动通常 < 500ms,给 600ms 缓冲
    const fallbackTimer = setTimeout(() => {
      canvas.removeEventListener('scrollend', onEnd)
      finishJump()
    }, 600)
  } else {
    jumpingId.value = null
  }
}

/** 监听编辑区滚动,更新当前标题 */
function updateCurrentHeading() {
  // 跳转过程中不更新,由 jumpTo 在滚动结束后强制设置
  if (jumpingId.value) return
  const canvas = document.querySelector('.editor-canvas')
  if (!canvas) return
  const headings = Array.from(
    canvas.querySelectorAll('[data-block-id]')
  ) as HTMLElement[]
  if (!headings.length) {
    currentHeadingId.value = null
    return
  }
  // 找到最靠近 canvas 顶部(略偏下)的 heading block
  const canvasRect = canvas.getBoundingClientRect()
  const threshold = canvasRect.top + 80
  let current: string | null = null
  for (const el of headings) {
    const blockId = el.getAttribute('data-block-id')
    if (!blockId) continue
    const block = doc.blocks.find((b) => b.id === blockId)
    if (!block || block.type !== 'heading') continue
    const rect = el.getBoundingClientRect()
    if (rect.top <= threshold) {
      current = blockId
    } else {
      break
    }
  }
  currentHeadingId.value = current
}

function onCanvasScroll() {
  updateCurrentHeading()
}

/** 绑定 scroll listener(幂等,重复调用安全) */
function bindScrollListener() {
  const canvas = document.querySelector('.editor-canvas')
  if (canvas) {
    canvas.removeEventListener('scroll', onCanvasScroll)
    canvas.addEventListener('scroll', onCanvasScroll, { passive: true })
  }
}

onMounted(() => {
  bindScrollListener()
  updateCurrentHeading()
})

// 文档打开/关闭时重新绑定(OutlinePanel 可能先于 BlockEditor 挂载,此时 canvas 不存在)
watch(() => doc.openTabs.length, (len, prevLen) => {
  if (len > 0 && prevLen === 0) {
    nextTick(() => {
      bindScrollListener()
      updateCurrentHeading()
    })
  }
})

onUnmounted(() => {
  const canvas = document.querySelector('.editor-canvas')
  if (canvas) {
    canvas.removeEventListener('scroll', onCanvasScroll)
  }
})

// 文档变化后重新计算
watch(() => doc.blocks, () => {
  nextTick(updateCurrentHeading)
}, { deep: true })

// Tab 切换
const tabs = [
  { key: 'outline' as const, label: '大纲', icon: List },
  { key: 'tags' as const, label: '标签', icon: Tag },
  { key: 'info' as const, label: '信息', icon: Info }
]

// 标签 mock(M1 占位)
const tags = ref<string[]>([])

// 文档信息
const info = computed(() => [
  { label: '字数', value: doc.wordCount.toLocaleString() },
  { label: '区块数', value: String(doc.blockCount) },
  { label: '页数', value: String(doc.pageCount) },
  { label: '创建时间', value: formatTime(doc.meta.created_at) },
  { label: '修改时间', value: formatTime(doc.meta.updated_at) },
  { label: '版本', value: doc.meta.version }
])

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '-'
  }
}

// 右键菜单
function onContextmenu(e: MouseEvent, entryId: string) {
  e.preventDefault()
  e.stopPropagation()
  menu.value = { visible: true, x: e.clientX, y: e.clientY, entryId }
}

const menuItems = computed<MenuItem[]>(() => [
  { key: 'copy-text', label: '复制标题文本', icon: Copy },
  { key: 'copy-link', label: '复制块链接', icon: Link2 }
])

async function onMenuSelect(key: string) {
  const id = menu.value.entryId
  if (!id) return
  const entry = outline.value.find((e) => e.id === id)
  if (!entry) return
  switch (key) {
    case 'copy-text':
      await navigator.clipboard.writeText(entry.text).catch(() => {})
      break
    case 'copy-link':
      await navigator.clipboard.writeText(`#${id}`).catch(() => {})
      break
  }
  menu.value.visible = false
}

function closeMenu() {
  menu.value.visible = false
}
</script>

<template>
  <aside class="outline-panel">
    <!-- Tab 头 -->
    <div class="tab-header">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: editor.outlineTab === tab.key }"
        :title="tab.label"
        @click="editor.setOutlineTab(tab.key)"
      >
        <component :is="tab.icon" :size="14" />
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- 大纲 -->
    <div v-if="editor.outlineTab === 'outline'" class="tab-body no-scrollbar">
      <a
        v-for="entry in outline"
        :key="entry.id"
        class="outline-item"
        :class="{ active: currentHeadingId === entry.id }"
        :style="indent(entry.level)"
        @click="jumpTo(entry)"
        @contextmenu="onContextmenu($event, entry.id)"
      >
        <span class="dot" :class="{ primary: entry.level === 1 }"></span>
        <span class="truncate">{{ entry.text || '未命名标题' }}</span>
      </a>
      <div v-if="!outline.length" class="empty">
        <List :size="28" class="empty-icon" />
        <div class="empty-title">暂无标题</div>
        <div class="empty-desc">在文档中添加 # 标题以生成大纲</div>
      </div>
    </div>

    <!-- 标签 -->
    <div v-else-if="editor.outlineTab === 'tags'" class="tab-body no-scrollbar">
      <div v-if="tags.length" class="tags-wrap">
        <span v-for="t in tags" :key="t" class="tag-chip">{{ t }}</span>
      </div>
      <div v-else class="empty">
        <Tag :size="28" class="empty-icon" />
        <div class="empty-title">暂无标签</div>
        <div class="empty-desc">在文档中使用 #标签 语法添加</div>
      </div>
    </div>

    <!-- 信息 -->
    <div v-else class="tab-body no-scrollbar">
      <div class="info-list">
        <div v-for="row in info" :key="row.label" class="info-row">
          <span class="info-label">{{ row.label }}</span>
          <span class="info-value">{{ row.value }}</span>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      v-if="menu.visible"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="onMenuSelect"
      @close="closeMenu"
    />
  </aside>
</template>

<style scoped>
.outline-panel {
  display: flex;
  flex-direction: column;
  width: var(--outline-panel-width);
  flex-shrink: 0;
  background: var(--sidebar);
  border-left: 1px solid var(--sidebar-border);
  user-select: none;
}
.tab-header {
  display: flex;
  align-items: center;
  height: var(--titlebar-height);
  flex-shrink: 0;
  border-bottom: 1px solid var(--sidebar-border);
}
.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 100%;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  border-bottom: 2px solid transparent;
  transition: color 0.12s ease, border-color 0.12s ease;
}
.tab-btn:hover {
  color: var(--sidebar-foreground);
}
.tab-btn.active {
  color: var(--brand-500);
  border-bottom-color: var(--brand-500);
}
.tab-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 12px;
}
.outline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding-right: 8px;
  border-radius: var(--radius-button);
  font-size: 13px;
  color: var(--sidebar-foreground);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  position: relative;
}
.outline-item:hover {
  background: var(--sidebar-accent);
}
.outline-item.active {
  background: var(--sidebar-accent);
  color: var(--brand-500);
  font-weight: 500;
}
.outline-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 16px;
  border-radius: 1px;
  background: var(--brand-500);
}
.dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--muted-foreground);
  flex-shrink: 0;
}
.dot.primary {
  background: var(--brand-400);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 16px;
  text-align: center;
}
.empty-icon {
  color: var(--muted-foreground);
  opacity: 0.4;
  margin-bottom: 4px;
}
.empty-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--sidebar-foreground);
}
.empty-desc {
  font-size: 11px;
  color: var(--muted-foreground);
  line-height: 1.5;
}
.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 8px;
}
.tag-chip {
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--sidebar-accent);
  color: var(--sidebar-foreground);
}
.info-list {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  gap: 12px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.info-label {
  color: var(--muted-foreground);
}
.info-value {
  color: var(--sidebar-foreground);
  font-variant-numeric: tabular-nums;
}

/* 大纲跳转高亮(由 JS 临时添加) */
:global(.outline-flash) {
  animation: outline-flash 1.2s ease;
}
@keyframes outline-flash {
  0% { background: var(--brand-50, rgba(0, 122, 255, 0.12)); }
  100% { background: transparent; }
}
</style>
