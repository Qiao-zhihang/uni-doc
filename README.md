# UniDoc

**以 Markdown 为核心的轻量化全能办公编辑器**

我们希望推出一款全新的编辑器，相较于传统办公软件，我们的优势：
- 标准md文件，适配新时代ai生产力场景
- 轻量化设计，极速冷启动
- 全平台兼容，采用原生webview（发行版里边只有windows版本，mac的小伙伴可以自行打包）
- 内置自研轻量化agent，支持用户自行配置api，让ai真正变得有用

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

通过标准 .md 文件储存在用户本地
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

当前版本仍不稳定，希望各位提供bug及复现过程，感谢！

---

## 许可证

MIT License

---

## 致谢

吉祥物 **UUshark** 由qzh设计。
