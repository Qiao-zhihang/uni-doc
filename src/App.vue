<script setup lang="ts">
/**
 * 应用根组件
 * 提供路由出口,初始化主题,挂载全局对话框宿主
 */
import { onMounted, onUnmounted } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import DialogHost from '@/components/common/DialogHost.vue'
import { interceptExternalLink, openExternalUrl } from '@/core/serializer/markdownFile'

const theme = useThemeStore()
const settings = useSettingsStore()

/** 全局捕获阶段监听外链点击，绕开所有 .stop 事件拦截 */
function onGlobalClickCapture(e: MouseEvent) {
  const href = interceptExternalLink(e)
  if (href) {
    openExternalUrl(href)
  }
}

onMounted(() => {
  theme.init()
  void settings.load()
  document.addEventListener('click', onGlobalClickCapture, true)
})

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClickCapture, true)
})
</script>

<template>
  <router-view />
  <DialogHost />
</template>
