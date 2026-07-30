<script setup lang="ts">
/**
 * 导出对话框组件
 * 支持导出为 Markdown 或 HTML,并选择各种导出细节
 *
 * 用法:在根组件(EditorView.vue)中挂载一次即可
 *   <ExportDialog />
 *   然后在任何地方调用 openExportDialog()
 */
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import {
  exportDialogState,
  closeExportDialog,
  confirmExportDialog,
} from '@/composables/useExportDialog'
import type { HtmlStyleMode, HtmlImageMode } from '@/core/serializer/html'

const state = exportDialogState

const htmlOptions = computed(() => [
  {
    value: 'styled' as HtmlStyleMode,
    label: '内嵌主题样式',
    desc: '浏览器打开即完美显示,支持亮/暗主题',
  },
  {
    value: 'print' as HtmlStyleMode,
    label: '打印/阅读样式',
    desc: '适合打印或转 PDF,排版干净',
  },
  {
    value: 'semantic' as HtmlStyleMode,
    label: '纯语义化 HTML',
    desc: '不带样式,供嵌入其他页面',
  },
])

const imageOptions = [
  {
    value: 'keep' as HtmlImageMode,
    label: '保持原路径',
    desc: 'HTML 需与图片放在同一目录',
  },
  {
    value: 'base64' as HtmlImageMode,
    label: '内嵌 Base64',
    desc: '单文件,不依赖外部图片,体积较大',
  },
]

const themeOptions = [
  { value: 'light' as const, label: '亮色主题' },
  { value: 'dark' as const, label: '暗色主题' },
]
</script>

<template>
  <div v-if="state.visible" class="export-dialog-mask" @pointerdown.self="closeExportDialog(null)">
    <div class="export-dialog" role="dialog" aria-modal="true" aria-label="导出文档">
      <!-- 标题栏 -->
      <div class="dialog-header">
        <span class="dialog-title">导出文档</span>
        <button class="close-btn" title="关闭" @click="closeExportDialog(null)">
          <X :size="16" />
        </button>
      </div>

      <div class="dialog-body">
        <!-- 格式选择 -->
        <div class="section">
          <label class="section-label">导出格式</label>
          <div class="format-tabs">
            <button
              class="format-tab"
              :class="{ active: state.format === 'md' }"
              @click="state.format = 'md'"
            >
              <span class="tab-icon">M↓</span>
              <span class="tab-text">Markdown</span>
            </button>
            <button
              class="format-tab"
              :class="{ active: state.format === 'html' }"
              @click="state.format = 'html'"
            >
              <span class="tab-icon">H5</span>
              <span class="tab-text">HTML</span>
            </button>
          </div>
        </div>

        <!-- HTML 选项 -->
        <template v-if="state.format === 'html'">
          <!-- 样式模式 -->
          <div class="section">
            <label class="section-label">样式方案</label>
            <div class="option-list">
              <label
                v-for="opt in htmlOptions"
                :key="opt.value"
                class="option-item"
                :class="{ active: state.styleMode === opt.value }"
              >
                <input
                  v-model="state.styleMode"
                  type="radio"
                  :value="opt.value"
                  class="option-radio"
                />
                <div class="option-content">
                  <span class="option-label">{{ opt.label }}</span>
                  <span class="option-desc">{{ opt.desc }}</span>
                </div>
              </label>
            </div>
          </div>

          <!-- 主题(仅 styled 模式) -->
          <div v-if="state.styleMode === 'styled'" class="section">
            <label class="section-label">主题</label>
            <div class="theme-tabs">
              <button
                v-for="t in themeOptions"
                :key="t.value"
                class="theme-tab"
                :class="{ active: state.theme === t.value }"
                @click="state.theme = t.value"
              >
                {{ t.label }}
              </button>
            </div>
          </div>

          <!-- 图片处理 -->
          <div class="section">
            <label class="section-label">图片处理</label>
            <div class="option-list">
              <label
                v-for="opt in imageOptions"
                :key="opt.value"
                class="option-item"
                :class="{ active: state.imageMode === opt.value }"
              >
                <input
                  v-model="state.imageMode"
                  type="radio"
                  :value="opt.value"
                  class="option-radio"
                />
                <div class="option-content">
                  <span class="option-label">{{ opt.label }}</span>
                  <span class="option-desc">{{ opt.desc }}</span>
                </div>
              </label>
            </div>
          </div>
        </template>

        <!-- Markdown 提示 -->
        <div v-else class="section">
          <div class="md-hint">
            <p>将当前文档导出为标准 Markdown 文件(.md)</p>
            <p class="hint-sub">包含文档标题、作者等元信息(YAML frontmatter)</p>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="dialog-actions">
        <button class="btn btn-cancel" @click="closeExportDialog(null)">取消</button>
        <button class="btn btn-confirm" @click="confirmExportDialog()">
          导出{{ state.format === 'md' ? ' Markdown' : ' HTML' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ========== 遮罩 ========== */
.export-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: mask-fade 0.15s ease;
}
@keyframes mask-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ========== 对话框主体(苹果风:大圆角+柔和阴影) ========== */
.export-dialog {
  width: 600px;
  max-width: calc(100vw - 40px);
  min-height: 720px;
  max-height: calc(100vh - 80px);
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow:
    0 24px 60px -12px rgba(0, 0, 0, 0.35),
    0 8px 20px -8px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: dialog-pop 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes dialog-pop {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ========== 标题栏(居中,极简) ========== */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 16px 10px;
  position: relative;
  flex-shrink: 0;
}
.dialog-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--popover-foreground);
  letter-spacing: -0.01em;
}
.close-btn {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  opacity: 0.7;
}
.close-btn:hover {
  background: var(--muted);
  color: var(--foreground);
  opacity: 1;
}

/* ========== 内容区(固定高度 = 最大内容高度,切换不跳变,最大状态无需滚动) ========== */
.dialog-body {
  padding: 20px 32px 32px;
  overflow: visible;
  display: flex;
  flex-direction: column;
  gap: 26px;
  height: 610px;
  flex-shrink: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0 2px;
}

/* ========== 格式分段控件(苹果胶囊风) ========== */
.format-tabs {
  display: flex;
  padding: 3px;
  background: var(--muted);
  border-radius: 10px;
  position: relative;
}
.format-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  z-index: 1;
}
.format-tab:hover {
  color: var(--foreground);
}
.format-tab.active {
  color: var(--foreground);
  background: var(--popover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.15),
    0 0 0 0.5px var(--border);
}
.tab-icon {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  opacity: 0.85;
}

/* ========== 选项卡片列表(苹果分组列表风) ========== */
.option-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--muted);
  border-radius: 12px;
  overflow: hidden;
}
.option-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  position: relative;
}
.option-item + .option-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 14px;
  height: 0.5px;
  background: var(--border);
}
.option-item:hover {
  background: var(--accent);
}
.option-item.active {
  background: var(--brand-50);
}
.option-item.active:hover {
  background: var(--brand-100);
}

/* 自定义单选按钮(苹果风) */
.option-radio {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border: 1.5px solid var(--border);
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--popover);
}
.option-radio:checked {
  border-color: var(--brand-500);
}
.option-radio:checked::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--brand-500);
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.option-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  line-height: 1.4;
}
.option-desc {
  font-size: 11.5px;
  color: var(--muted-foreground);
  line-height: 1.4;
}

/* ========== 主题选择(胶囊分段) ========== */
.theme-tabs {
  display: flex;
  padding: 3px;
  background: var(--muted);
  border-radius: 10px;
}
.theme-tab {
  flex: 1;
  padding: 7px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.theme-tab:hover {
  color: var(--foreground);
}
.theme-tab.active {
  color: var(--foreground);
  background: var(--popover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.15),
    0 0 0 0.5px var(--border);
}

/* ========== Markdown 提示卡片 ========== */
.md-hint {
  padding: 14px 16px;
  background: var(--muted);
  border-radius: 12px;
  font-size: 12.5px;
  color: var(--muted-foreground);
  line-height: 1.6;
}
.md-hint p {
  margin: 0;
  color: var(--foreground);
  font-weight: 500;
}
.md-hint .hint-sub {
  margin-top: 3px !important;
  font-size: 11.5px;
  color: var(--muted-foreground);
  font-weight: 400;
}

/* ========== 底部操作区(苹果按钮风) ========== */
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 18px;
  flex-shrink: 0;
}
.btn {
  height: 32px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: none;
  letter-spacing: 0.01em;
}
.btn-cancel {
  background: var(--muted);
  color: var(--foreground);
}
.btn-cancel:hover {
  background: var(--accent);
}
.btn-cancel:active {
  filter: brightness(0.92);
}
.btn-confirm {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-foreground);
  box-shadow: var(--btn-primary-shadow);
}
.btn-confirm:hover {
  background: var(--btn-primary-hover-bg);
  box-shadow: var(--btn-primary-hover-shadow);
}
.btn-confirm:active {
  filter: brightness(0.96);
  box-shadow: var(--btn-primary-shadow);
}
</style>
