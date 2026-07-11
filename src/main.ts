/**
 * 应用入口
 * 参考 PRD §8.1(Vue 3 + Vite + TypeScript + Pinia + Vue Router)
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './style.css'

function showError(msg: string) {
  const div = document.createElement('div')
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff3b30;color:#fff;padding:16px;font-family:monospace;font-size:13px;white-space:pre-wrap;'
  div.textContent = msg
  document.body.appendChild(div)
}

window.addEventListener('error', (e) => {
  showError(`Runtime Error: ${e.message}\nSource: ${e.filename}:${e.lineno}`)
})

window.addEventListener('unhandledrejection', (e) => {
  showError(`Promise Rejection: ${e.reason}`)
})

const app = createApp(App)

app.config.errorHandler = (err, _instance, info) => {
  showError(`Vue Error: ${err}\nInfo: ${info}`)
}

router.onError((err) => {
  showError(`Router Error: ${err}`)
})

app.use(createPinia())
app.use(router)
app.mount('#app')
