<script setup lang="ts">
/**
 * 应用根组件
 * 提供路由出口,初始化主题,挂载全局对话框宿主
 */
import { onMounted } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import DialogHost from '@/components/common/DialogHost.vue'

const theme = useThemeStore()
const settings = useSettingsStore()

onMounted(() => {
  theme.init()
  void settings.load()
})
</script>

<template>
  <router-view />
  <DialogHost />
</template>
