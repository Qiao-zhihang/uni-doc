<script setup lang="ts">
/**
 * 幻灯片演示模式
 * 按 ---page--- 分页符切分 blocks,全屏展示
 * 导航:键盘 ←/→/PageUp/PageDown、屏幕箭头、页码指示器、Esc 退出
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Block } from '@/core/blocks/types'
import BlockRenderer from './BlockRenderer.vue'
import { handleExternalLinkClick } from '@/core/serializer/markdownFile'

/** 拦截幻灯片内 a 标签点击,用系统默认浏览器打开外部链接 */
function onSlideClick(e: MouseEvent) {
  handleExternalLinkClick(e)
}

const props = defineProps<{ blocks: Block[] }>()
const emit = defineEmits<{ (e: 'exit'): void }>()

/** 按 page_break 分页符切分 blocks */
const slides = computed<Block[][]>(() => {
  const result: Block[][] = [[]]
  for (const block of props.blocks) {
    if (block.type === 'page_break') {
      result.push([])
    } else {
      result[result.length - 1].push(block)
    }
  }
  // 保留空幻灯片:显式分页符应产生对应的空页(如文档以分页符开头/结尾或连续分页符)
  return result
})

const currentSlide = ref(0)
const totalSlides = computed(() => slides.value.length)

const canPrev = computed(() => currentSlide.value > 0)
const canNext = computed(() => currentSlide.value < totalSlides.value - 1)

function goToSlide(idx: number) {
  if (idx < 0 || idx >= totalSlides.value) return
  currentSlide.value = idx
}

function nextSlide() {
  if (canNext.value) currentSlide.value++
}

function prevSlide() {
  if (canPrev.value) currentSlide.value--
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      e.preventDefault()
      nextSlide()
      break
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault()
      prevSlide()
      break
    case 'Escape':
      e.preventDefault()
      emit('exit')
      break
    case 'Home':
      e.preventDefault()
      goToSlide(0)
      break
    case 'End':
      e.preventDefault()
      goToSlide(totalSlides.value - 1)
      break
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  currentSlide.value = 0
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

// 进入全屏
const presentationEl = ref<HTMLElement | null>(null)
onMounted(async () => {
  if (presentationEl.value?.requestFullscreen) {
    try {
      await presentationEl.value.requestFullscreen()
    } catch {
      // 全屏请求失败(如用户拒绝),忽略
    }
  }
})

onUnmounted(() => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  }
})

const slideBlocks = computed(() => slides.value[currentSlide.value] ?? [])

// 切换幻灯片时重置滚动位置到顶部
const slideContainerRef = ref<HTMLElement | null>(null)
watch(() => currentSlide.value, () => {
  nextTick(() => {
    if (slideContainerRef.value) {
      slideContainerRef.value.scrollTop = 0
    }
  })
})

// 进度条
const progress = computed(() => {
  if (totalSlides.value <= 1) return 100
  return ((currentSlide.value + 1) / totalSlides.value) * 100
})
</script>

<template>
  <div ref="presentationEl" class="presentation-mode">
    <!-- 幻灯片区域 -->
    <div ref="slideContainerRef" class="slide-container">
      <div class="slide-content" @click="onSlideClick">
        <BlockRenderer
          v-for="block in slideBlocks"
          :key="block.id"
          :block="block"
        />
      </div>
    </div>

    <!-- 左侧箭头 -->
    <button
      v-if="canPrev"
      class="nav-arrow nav-arrow-prev"
      title="上一页"
      @click="prevSlide"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <!-- 右侧箭头 -->
    <button
      v-if="canNext"
      class="nav-arrow nav-arrow-next"
      title="下一页"
      @click="nextSlide"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <!-- 底部控制栏 -->
    <div class="bottom-bar">
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
      </div>
      <div class="page-indicator">
        <span class="current">{{ currentSlide + 1 }}</span>
        <span class="separator">/</span>
        <span class="total">{{ totalSlides }}</span>
      </div>
      <button class="exit-btn" title="退出演示 (Esc)" @click="emit('exit')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M19 19H5V5h14v14z M19 5l-14 14 M5 5l14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>退出</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.presentation-mode {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #000;
  display: flex;
  flex-direction: column;
  font-family: var(--font-sans);
  color: #fff;
}

.slide-container {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 60px;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.slide-content {
  width: 100%;
  margin: auto;
  background: #fff;
  color: #1a1a1a;
  border-radius: 8px;
  padding: 48px 64px;
  min-height: 60vh;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
}

/* 幻灯片内容样式覆盖 */
.slide-content :deep(.paragraph-block) {
  font-size: 20px;
  line-height: 1.8;
  margin: 16px 0;
}
.slide-content :deep(h1),
.slide-content :deep(h2),
.slide-content :deep(h3) {
  margin: 32px 0 16px;
}
.slide-content :deep(.heading-block) {
  font-size: 32px;
  margin: 32px 0 16px;
}
.slide-content :deep(.list-block) {
  font-size: 20px;
  line-height: 1.8;
}
.slide-content :deep(.quote-block) {
  font-size: 20px;
  padding: 16px 24px;
  border-left: 4px solid var(--brand-500);
  background: var(--secondary);
}
.slide-content :deep(.code-block) {
  font-size: 16px;
}
.slide-content :deep(.table-block),
.slide-content :deep(.table-block table),
.slide-content :deep(.table-block .cell) {
  font-size: 22px !important;
  line-height: 1.7;
}
.slide-content :deep(.table-block .cell) {
  padding: 14px 16px !important;
  min-height: 2.2em;
}
.slide-content :deep(.image-block) {
  max-width: 100%;
}
.slide-content :deep(.divider-block) {
  margin: 32px 0;
}

/* 导航箭头(左下角小按钮,演讲者用) */
.nav-arrow {
  position: absolute;
  bottom: 64px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  transition: all 0.2s;
  z-index: 10;
}
.nav-arrow:hover {
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.35);
}
.nav-arrow-prev {
  left: 24px;
}
.nav-arrow-next {
  left: 64px;
}

/* 底部控制栏 */
.bottom-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
}

.progress-track {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--brand-500, #3b82f6);
  transition: width 0.3s ease;
}

.page-indicator {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: 4px;
}
.page-indicator .current {
  font-weight: 600;
  color: #fff;
}
.page-indicator .separator {
  opacity: 0.5;
}

.exit-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.exit-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
