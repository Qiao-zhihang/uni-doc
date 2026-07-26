<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Command } from '@/core/plugin/types'
import { usePluginStore } from '@/stores/plugin'
import { useDocumentStore } from '@/stores/document'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const plugins = usePluginStore()
const doc = useDocumentStore()
const inputRef = ref<HTMLInputElement | null>(null)
const selectedIdx = ref(0)

const query = ref('')

const builtinCommands = computed(() => {
  const cmds: (Command & { builtin?: boolean })[] = []
  const blocks = doc.blocks
  const hasSelection = doc.activeTabPath && blocks.length > 0

  const customTypes = plugins.getCustomBlockTypes()
  for (const [type, def] of customTypes) {
    cmds.push({
      id: `builtin:insert-${type}`,
      name: `插入 ${def.type.split(':').pop() || def.type} 块`,
      callback: () => {
        if (hasSelection) {
          const lastId = blocks[blocks.length - 1]?.id || null
          doc.insertBlockAfter(lastId, type as any)
        }
      },
      builtin: true,
    })
  }
  return cmds
})

const allCommands = computed(() => {
  const pluginCmds = plugins.getCustomCommands()
  return [...builtinCommands.value, ...pluginCmds]
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allCommands.value
  return allCommands.value.filter((c) => c.name.toLowerCase().includes(q))
})

watch(filtered, () => {
  selectedIdx.value = 0
})

watch(
  () => props.visible,
  (v) => {
    if (v) {
      query.value = ''
      selectedIdx.value = 0
      nextTick(() => inputRef.value?.focus())
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIdx.value = Math.min(selectedIdx.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    runSelected()
  }
}

function runSelected() {
  const cmd = filtered.value[selectedIdx.value]
  if (!cmd) return
  emit('close')
  nextTick(() => {
    try {
      cmd.callback()
    } catch (e) {
      console.error('命令执行失败:', e)
    }
  })
}

function runCmd(cmd: Command) {
  emit('close')
  nextTick(() => {
    try {
      cmd.callback()
    } catch (e) {
      console.error('命令执行失败:', e)
    }
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="cmd-mask" @pointerdown.self="emit('close')">
      <div class="cmd-panel" role="dialog" @keydown="onKeydown">
        <input
          ref="inputRef"
          v-model="query"
          class="cmd-input"
          type="text"
          placeholder="输入命令或搜索…（Esc 关闭，↑↓ 选择，Enter 执行）"
        />
        <div class="cmd-list">
          <div
            v-for="(cmd, idx) in filtered"
            :key="cmd.id"
            class="cmd-item"
            :class="{ active: idx === selectedIdx }"
            @click="runCmd(cmd)"
            @mouseenter="selectedIdx = idx"
          >
            <span class="cmd-name">{{ cmd.name }}</span>
            <span v-if="cmd.hotkey" class="cmd-hotkey">{{ cmd.hotkey }}</span>
          </div>
          <div v-if="filtered.length === 0" class="cmd-empty">没有匹配的命令</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmd-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  z-index: 9999;
}
.cmd-panel {
  width: min(560px, 90vw);
  background: var(--background, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.cmd-input {
  width: 100%;
  padding: 14px 16px;
  font-size: 15px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--foreground, #111);
  border-bottom: 1px solid var(--border, #e5e7eb);
  font-family: inherit;
}
.cmd-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
}
.cmd-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--foreground, #111);
}
.cmd-item.active {
  background: var(--primary, #3b82f6);
  color: var(--primary-foreground, #fff);
}
.cmd-item.active .cmd-hotkey {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.15);
}
.cmd-name {
  flex: 1;
}
.cmd-hotkey {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--muted, #f3f4f6);
  color: var(--muted-foreground, #6b7280);
}
.cmd-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--muted-foreground, #9ca3af);
}
</style>
