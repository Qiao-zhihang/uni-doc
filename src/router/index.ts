/**
 * 路由配置
 * 参考 PRD §10.1(布局结构)和 §8.1(前端框架含路由)
 */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/editor'
  },
  {
    path: '/editor',
    name: 'editor',
    component: () => import('@/views/EditorView.vue'),
    meta: { title: '编辑器' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '设置' }
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
