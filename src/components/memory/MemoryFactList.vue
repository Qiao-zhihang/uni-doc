<script setup lang="ts">
/**
 * 记忆事实列表：搜索、分类筛选、排序、增删改、置顶，去重/清理收进「更多」菜单
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ChevronDown,
  Eraser,
  GitMerge,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next'
import { useAiMemoryStore } from '@/stores/aiMemory'
import { formatRelativeTime, memoryCategoryLabel, memoryOriginLabel } from '@/ai/memoryCore'
import type { MemoryCategory, MemoryFact } from '@/ai/types'
import { MEMORY_CATEGORY_LABELS } from '@/ai/types'
import { confirmDialog } from '@/composables/useDialog'
import MemoryFactDialog from './MemoryFactDialog.vue'
import { truncateText, type MemoryNotifyPayload } from './memorySupport'

type CategoryFilter = MemoryCategory | 'all'
type SortMode = 'updated' | 'created' | 'importance' | 'access'

const emit = defineEmits<{
  (e: 'notify', payload: MemoryNotifyPayload): void
}>()

const memoryStore = useAiMemoryStore()

const searchQuery = ref('')
const categoryFilter = ref<CategoryFilter>('all')
const sortMode = ref<SortMode>('updated')
const dialogVisible = ref(false)
const editingFact = ref<MemoryFact | null>(null)

const totalFacts = computed(() => memoryStore.stats.total)

const categoryChips = computed(() => {
  const chips: { key: CategoryFilter; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: memoryStore.stats.total },
  ]
  const entries = Object.entries(MEMORY_CATEGORY_LABELS) as [MemoryCategory, string][]
  for (const [key, label] of entries) {
    chips.push({ key, label, count: memoryStore.stats.byCategory[key] ?? 0 })
  }
  return chips
})

const sortedFacts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const category = categoryFilter.value
  let list = memoryStore.facts.filter((fact) => category === 'all' || fact.category === category)
  if (query) {
    list = list.filter(
      (fact) =>
        fact.content.toLowerCase().includes(query) ||
        fact.tags.some((tag) => tag.toLowerCase().includes(query)),
    )
  }
  const sorted = [...list]
  switch (sortMode.value) {
    case 'created':
      sorted.sort((a, b) => b.createdAt - a.createdAt)
      break
    case 'importance':
      sorted.sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
      break
    case 'access':
      sorted.sort((a, b) => b.accessCount - a.accessCount || b.createdAt - a.createdAt)
      break
    case 'updated':
    default:
      sorted.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      break
  }
  return sorted
})

const duplicateCount = computed(() =>
  memoryStore.findDuplicates().reduce((sum, group) => sum + group.duplicateIds.length, 0),
)
const cleanupCount = computed(() => memoryStore.previewCleanup())
const hasMenuItems = computed(() => duplicateCount.value > 0 || cleanupCount.value > 0)

// ===== 「更多」菜单：点击外部或 Esc 关闭 =====
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function onDocumentPointerDown(e: Event) {
  if (!menuOpen.value) return
  const container = menuRef.value
  if (container && e.target instanceof Node && container.contains(e.target)) return
  menuOpen.value = false
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) menuOpen.value = false
}

watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onDocumentKeydown)
})

function closeMenu() {
  menuOpen.value = false
}

function runMerge() {
  closeMenu()
  void mergeDuplicateFacts()
}

function runCleanup() {
  closeMenu()
  void cleanupLowValue()
}

function openAdd() {
  editingFact.value = null
  dialogVisible.value = true
}

function openEdit(fact: MemoryFact) {
  editingFact.value = fact
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
}

function onFactSaved(mode: 'added' | 'updated') {
  if (mode === 'added') {
    searchQuery.value = ''
    categoryFilter.value = 'all'
    sortMode.value = 'updated'
    emit('notify', { type: 'success', message: '记忆已添加' })
  } else {
    emit('notify', { type: 'success', message: '记忆已更新' })
  }
}

function resetFilters() {
  searchQuery.value = ''
  categoryFilter.value = 'all'
}

function togglePin(fact: MemoryFact) {
  memoryStore.togglePin(fact.id)
  void memoryStore.flushSave()
}

async function removeFact(fact: MemoryFact) {
  const ok = await confirmDialog(
    `确定删除这条记忆吗？\n\n「${truncateText(fact.content, 80)}」\n\n删除后可在提示中撤销。`,
    '删除记忆',
  )
  if (!ok) return
  memoryStore.deleteFact(fact.id)
  void memoryStore.flushSave()
  emit('notify', {
    type: 'success',
    message: '记忆已删除',
    undo: () => {
      memoryStore.restoreFact(fact)
      void memoryStore.flushSave()
      emit('notify', { type: 'success', message: '已撤销删除' })
    },
  })
}

async function cleanupLowValue() {
  const count = memoryStore.previewCleanup()
  if (count === 0) {
    emit('notify', { type: 'info', message: '没有可清理的低价值记忆' })
    return
  }
  const ok = await confirmDialog(
    `将清理 ${count} 条长期未使用、重要度低的记忆（置顶记忆不会被清理）。\n\n` +
      '此操作不可撤销，建议先导出一份备份。确定继续吗？',
    '清理低价值记忆',
  )
  if (!ok) return
  const removed = memoryStore.cleanup()
  void memoryStore.flushSave()
  emit('notify', { type: 'success', message: `已清理 ${removed} 条低价值记忆` })
}

async function mergeDuplicateFacts() {
  const groups = memoryStore.findDuplicates()
  const count = groups.reduce((sum, group) => sum + group.duplicateIds.length, 0)
  if (count === 0) {
    emit('notify', { type: 'info', message: '未发现重复记忆' })
    return
  }
  const ok = await confirmDialog(
    `发现 ${groups.length} 组相似或重复的记忆，合并后将移除 ${count} 条重复项` +
      '（每组保留信息最完整的一条）。\n\n此操作不可撤销，建议先导出一份备份。确定继续吗？',
    '合并重复记忆',
  )
  if (!ok) return
  const merged = memoryStore.mergeDuplicates()
  void memoryStore.flushSave()
  emit('notify', { type: 'success', message: `已合并 ${merged} 条重复记忆` })
}
</script>

<template>
  <div class="fact-list-card">
    <header class="card-header">
      <div class="card-title-row">
        <h3 class="card-title">记忆事实</h3>
        <span class="count-badge">{{ totalFacts }}</span>
      </div>
      <div class="header-actions">
        <div v-if="hasMenuItems" ref="menuRef" class="more-wrap">
          <button
            type="button"
            class="btn btn-ghost more-btn"
            :class="{ open: menuOpen }"
            @click="menuOpen = !menuOpen"
          >
            <span>更多</span>
            <ChevronDown :size="13" class="more-chevron" :class="{ open: menuOpen }" />
          </button>
          <div v-if="menuOpen" class="more-menu" role="menu">
            <button
              v-if="duplicateCount > 0"
              type="button"
              class="more-item"
              role="menuitem"
              @click="runMerge"
            >
              <GitMerge :size="13" />
              <span class="more-label">合并重复记忆</span>
              <span class="more-count">{{ duplicateCount }}</span>
            </button>
            <button
              v-if="cleanupCount > 0"
              type="button"
              class="more-item"
              role="menuitem"
              @click="runCleanup"
            >
              <Eraser :size="13" />
              <span class="more-label">清理低价值记忆</span>
              <span class="more-count">{{ cleanupCount }}</span>
            </button>
          </div>
        </div>
        <button type="button" class="btn btn-primary" @click="openAdd">
          <Plus :size="14" />
          <span>新增记忆</span>
        </button>
      </div>
    </header>

    <div class="toolbar">
      <div class="search-box">
        <Search :size="14" class="search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="搜索内容或标签"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="clear-search"
          title="清除搜索"
          @click="searchQuery = ''"
        >
          <X :size="12" />
        </button>
      </div>
      <select v-model="sortMode" class="sort-select" title="排序方式">
        <option value="updated">最近更新</option>
        <option value="created">创建时间</option>
        <option value="importance">重要度</option>
        <option value="access">访问次数</option>
      </select>
    </div>

    <div class="category-chips">
      <button
        v-for="chip in categoryChips"
        :key="chip.key"
        type="button"
        class="filter-chip"
        :class="{ active: categoryFilter === chip.key }"
        @click="categoryFilter = chip.key"
      >
        <span>{{ chip.label }}</span>
        <span class="chip-count">{{ chip.count }}</span>
      </button>
    </div>

    <!-- 完全没有记忆 -->
    <div v-if="totalFacts === 0" class="empty-state">
      <div class="empty-title">还没有记忆</div>
      <div class="empty-hint">手动添加，或让 AI 在对话中自动记住。</div>
      <button type="button" class="btn btn-primary" @click="openAdd">
        <Plus :size="14" />
        <span>新增记忆</span>
      </button>
    </div>

    <!-- 筛选无结果 -->
    <div v-else-if="sortedFacts.length === 0" class="empty-state small">
      <div class="empty-title">没有匹配的记忆</div>
      <button type="button" class="btn btn-ghost" @click="resetFilters">清除筛选</button>
    </div>

    <!-- 记忆列表 -->
    <div v-else class="fact-rows">
      <article
        v-for="fact in sortedFacts"
        :key="fact.id"
        class="fact-card"
        :class="{ disabled: fact.enabled === false }"
      >
        <div class="fact-head">
          <div class="fact-chips">
            <span class="category-chip">{{ memoryCategoryLabel(fact.category) }}</span>
            <span v-if="fact.enabled === false" class="flag-chip off">已停用</span>
            <span v-if="fact.pinned" class="flag-chip pinned">
              <Pin :size="10" />
              <span>置顶</span>
            </span>
          </div>
          <div class="fact-actions">
            <button
              type="button"
              class="icon-action"
              :title="fact.pinned ? '取消置顶' : '置顶'"
              @click="togglePin(fact)"
            >
              <PinOff v-if="fact.pinned" :size="14" />
              <Pin v-else :size="14" />
            </button>
            <button type="button" class="icon-action" title="编辑" @click="openEdit(fact)">
              <Pencil :size="14" />
            </button>
            <button type="button" class="icon-action danger" title="删除" @click="removeFact(fact)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
        <div class="fact-content">{{ fact.content }}</div>
        <div class="fact-foot">
          <div v-if="fact.tags.length > 0" class="fact-tags">
            <span v-for="tag in fact.tags.slice(0, 3)" :key="tag" class="tag-pill">
              {{ tag }}
            </span>
            <span v-if="fact.tags.length > 3" class="tag-pill more">
              +{{ fact.tags.length - 3 }}
            </span>
          </div>
          <div class="fact-meta">
            <span>{{ memoryOriginLabel(fact) }}</span>
            <span class="meta-dot">·</span>
            <span>{{ formatRelativeTime(fact.updatedAt ?? fact.createdAt) }}</span>
            <span class="meta-dot">·</span>
            <span>访问 {{ fact.accessCount }} 次</span>
          </div>
        </div>
      </article>
    </div>

    <MemoryFactDialog
      :visible="dialogVisible"
      :fact="editingFact"
      @close="closeDialog"
      @saved="onFactSaved"
    />
  </div>
</template>

<style scoped>
.fact-list-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 16px 16px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 0 10px;
}
.card-title-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
}
.count-badge {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: var(--font-mono);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.more-wrap {
  position: relative;
}
.more-btn {
  height: 30px;
  padding: 0 10px;
}
.more-chevron {
  transition: transform 0.18s ease;
}
.more-chevron.open {
  transform: rotate(180deg);
}
.more-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 200px;
  padding: 4px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
}
.more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--foreground);
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.more-item:hover {
  background: var(--muted);
}
.more-label {
  flex: 1;
  white-space: nowrap;
}
.more-count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: 10px;
  font-family: var(--font-mono);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.search-icon {
  position: absolute;
  left: 10px;
  color: var(--muted-foreground);
  pointer-events: none;
}
.search-input {
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 0 30px 0 32px;
  font-size: 13px;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.search-input:focus {
  border-color: var(--primary);
}
.clear-search {
  position: absolute;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.clear-search:hover {
  background: var(--muted);
  color: var(--foreground);
}
.sort-select {
  height: 32px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.sort-select:focus {
  border-color: var(--primary);
}
.category-chips {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 23px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.filter-chip:hover {
  background: var(--muted);
}
.filter-chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.chip-count {
  font-size: 10px;
  opacity: 0.75;
  font-family: var(--font-mono);
}
.fact-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fact-card {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  transition:
    border-color 0.15s,
    opacity 0.15s;
}
.fact-card:hover {
  border-color: var(--primary);
}
.fact-card.disabled {
  opacity: 0.55;
}
.fact-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}
.fact-chips {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  min-width: 0;
}
.category-chip {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--primary);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.flag-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: 10px;
  white-space: nowrap;
}
.flag-chip.pinned {
  background: var(--primary);
  color: var(--primary-foreground);
}
.flag-chip.off {
  background: var(--muted);
  color: var(--destructive);
}
.fact-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}
.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.icon-action:hover {
  background: var(--muted);
  color: var(--foreground);
}
.icon-action.danger:hover {
  color: var(--destructive);
}
.fact-content {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.55;
  color: var(--foreground);
  word-break: break-word;
  white-space: pre-wrap;
}
.fact-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.fact-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
.tag-pill {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: 10px;
  line-height: 18px;
}
.tag-pill.more {
  font-family: var(--font-mono);
}
.fact-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
}
.meta-dot {
  color: var(--border);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px 20px;
  text-align: center;
}
.empty-state.small {
  padding: 24px 16px 16px;
}
.empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
}
.empty-hint {
  font-size: 12px;
  color: var(--muted-foreground);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    opacity 0.15s,
    background 0.15s;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--foreground);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--muted);
}
</style>
