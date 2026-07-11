<script setup lang="ts">
import type { Component } from 'vue'
import type { Block } from '@/core/blocks/types'
import HeadingBlock from '@/components/blocks/HeadingBlock.vue'
import ParagraphBlock from '@/components/blocks/ParagraphBlock.vue'
import ListBlock from '@/components/blocks/ListBlock.vue'
import DividerBlock from '@/components/blocks/DividerBlock.vue'
import PageBreakBlock from '@/components/blocks/PageBreakBlock.vue'
import QuoteBlock from '@/components/blocks/QuoteBlock.vue'
import CodeBlock from '@/components/blocks/CodeBlock.vue'
import TableBlock from '@/components/blocks/TableBlock.vue'
import ImageBlock from '@/components/blocks/ImageBlock.vue'

defineProps<{ block: Block }>()

const emit = defineEmits<{
  (e: 'update', patch: Partial<Block>): void
  (e: 'enter', afterText: string): void
  (e: 'backspace-merge'): void
  (e: 'select'): void
}>()

const componentMap: Record<string, Component> = {
  heading: HeadingBlock,
  paragraph: ParagraphBlock,
  list: ListBlock,
  divider: DividerBlock,
  page_break: PageBreakBlock,
  quote: QuoteBlock,
  code_block: CodeBlock,
  table: TableBlock,
  image: ImageBlock
}
</script>

<template>
  <component
    :is="componentMap[block.type] ?? ParagraphBlock"
    :block="block"
    @update="(p: Partial<Block>) => emit('update', p)"
    @enter="(afterText: string) => emit('enter', afterText)"
    @backspace-merge="emit('backspace-merge')"
    @select="emit('select')"
  />
</template>
