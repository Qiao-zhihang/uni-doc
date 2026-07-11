<script setup lang="ts">
/**
 * 应用根组件
 * 提供路由出口,初始化主题,挂载全局对话框宿主
 */
import { onMounted } from 'vue'
import { useThemeStore } from '@/stores/theme'
import DialogHost from '@/components/common/DialogHost.vue'

const theme = useThemeStore()

onMounted(() => {
  theme.init()
})
</script>

<template>
  <router-view />
  <DialogHost />
</template>
