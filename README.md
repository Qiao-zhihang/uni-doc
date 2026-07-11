# UniDoc

**以 Markdown 为核心的轻量化全能办公编辑器**

用单一软件、单一文档格式，完全平替传统 Office（Word / Excel / PPT）及常规 WPS 的全部日常办公功能。

---

## 核心特性

- **Markdown 原生**：所有内容以 Markdown 为底层表示，支持源码模式与可视化编辑无缝切换
- **单文档大一统**：文本、表格、图片、分页、图表共存于同一 `.uni-doc` 文件，无三件套割裂
- **轻量跨平台**：基于 Tauri v2，调用系统原生 WebView（Windows/macOS/Linux），不捆绑 Chromium
- **AI 深度集成**：AI 不是插件，是核心工作流。支持用户自定义 API 接入任意兼容服务或本地模型
- **Block-based 编辑**：段落、标题、列表、表格、代码块、图片等独立块单元，支持精细操作与实时渲染

---

## 技术架构

| 层级 | 技术栈 |
|------|--------|
| 前端框架 | Vue 3 + TypeScript + Vite |
| 状态管理 | Pinia |
| 桌面框架 | Tauri v2 (Rust) |
| 渲染引擎 | 系统 WebView（WebView2 / WKWebView / WebKitGTK） |
| 公式渲染 | KaTeX |
| 图表渲染 | Mermaid |

---

## 快速开始

### 环境要求

- Node.js 18+
- Rust 1.70+
- Windows 11 SDK（或 Windows 10 SDK）用于 Windows 构建

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

---

## 文档格式

`.uni-doc` 文件本质是一个 ZIP 压缩包，包含：

```
example.uni-doc/
├── content.md      # Markdown 主内容
├── blocks.json     # Block 元数据（可选）
├── assets/         # 图片等资源文件
└── meta.json       # 文档元信息
```

---

## 项目结构

```
src/
├── core/           # 业务逻辑核心（Parser/Serializer/History/Vault）
├── stores/         # Pinia 状态管理
├── components/
│   ├── blocks/     # 9 种 Block 渲染组件
│   ├── editor/     # 编辑器骨架（BlockEditor/Toolbar/Tabs）
│   └── layout/     # 布局组件（TitleBar/FileExplorer/StatusBar）
├── views/          # 页面视图
└── composables/    # Vue Composition API 工具

src-tauri/
├── src/            # Rust 后端（文件操作、库管理）
└── tauri.conf.json # Tauri 配置
```

---

## 开发状态

当前为 Milestone 1 阶段，已完成：

- Block-based 文档引擎（Paragraph/Heading/List/Table/Code/Image/Quote/Divider/PageBreak）
- Markdown 解析与序列化
- 撤销/重做栈
- 多标签页编辑
- 库（Vault）文件管理
- 演示模式
- 实时热保存

---

## 许可证

MIT License

---

## 致谢

吉祥物 **UUshark** 由项目团队设计。