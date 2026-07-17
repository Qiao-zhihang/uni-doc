---
title: unidoc - 通用文档说明
author: UniDoc User
version: 1.0.0
created_at: "2026-07-17T14:32:43.322Z"
updated_at: "2026-07-17T14:40:57.687Z"
---

## 🇺🇸 English Version

<div align="center">

# unidoc
**A Lightweight Document Engine Reimagined for the AI Era**

<span>One Markdown file, seamlessly integrating documents, tables, and slides, enabling AI to truly comprehend your data.</span>

<a href="#">Download</a> · <a href="#">Documentation</a> · <a href="#">Contribute</a>

</div>

---

### Our Design Philosophy

In an era where AI drives productivity, traditional Office software feels increasingly bloated. Complex formatting, obscure formulas, and incompatible formats have become significant barriers between humans and AI collaboration.

We firmly believe **Markdown** is the optimal bridge connecting human thought with AI processing capabilities. It is concise, structured, and extremely machine-friendly. However, average users have long lacked a modern editor that is both easy to use and powerful.

**unidoc** was created to meet this need. It is not just another Markdown editor, but an AI-native productivity platform that integrates documents, data, and presentations.

### Core Features

#### 1. Extremely Lightweight, Lightning Fast
The installer is only **10MB**, built on Tauri v2 without embedding the massive Chrome kernel.
Utilizing the system WebView for rendering, it achieves instant cold starts so your inspiration never has to wait.

#### 2. A Three-in-One Creative Experience
One Markdown file, three presentation modes:
- **Document Mode**: A smooth reading and writing experience, supporting outlines and code highlighting.
- **Table Insertion**: Insert tables within documents to handle data statistics easily, bidding farewell to the heaviness of Excel.
- **Slide Mode**: Switch to presentation view with one click, transforming Markdown directly into slides and ending the anxiety of formatting.

#### 3. AI Native Deep Integration
Not just a "chat box," but your "collaborator":
- **Proprietary Agent Framework**: Deeply integrates AI capabilities, supporting user-customized API configurations.
- **Repository-Level Management**: AI can directly read, understand, and manage your local document repository.
- **True Productivity**: Complete tedious tasks with a simple prompt, making AI collaboration a reality, not just a gimmick.

#### 4. Local First, Data Sovereignty
All files are saved in your local repository in `.md` format.
Supports standard Markdown syntax and is fully compatible with mainstream editors (Typora, Obsidian, etc.).
Your data belongs only to you—secure, controllable, and accessible anywhere.

#### 5. Powerful Syntax Support
We adopt standard Markdown, fully supporting common syntax while providing partial graphical operations to lower the barrier to entry.
- Built-in KaTeX support for perfectly rendering complex mathematical formulas.
- Supports Mermaid diagrams and common HTML syntax.
- Flexibly insert image blocks, table blocks, and code blocks for more freedom in content management.

### Technical Architecture

unidoc adopts a modern frontend technology stack and a high-performance Rust backend:

| Layer | Tech Stack |
| :--- | :--- |
| **Frontend Framework** | Vue 3 + TypeScript + Vite |
| **State Management** | Pinia |
| **Desktop Framework** | Tauri v2 (Rust) |
| **Rendering Engine** | System WebView (WebView2 / WKWebView / WebKitGTK) |
| **Formula Rendering** | KaTeX |
| **Diagram Rendering** | Mermaid |

### Installation & Usage

> We have currently released our initial version, implementing all the core features mentioned above.

1. Go to the [Releases](https://github.com/Qiao-zhihang/uni-doc/releases) page to download the installer for your platform.
2. Install and launch unidoc.
3. Select or create a local folder to serve as your document repository.
4. Start enjoying a pure writing and AI collaboration experience.

### Contributing

unidoc is currently in its early stages, and we warmly welcome all forms of contribution:
- Submit Issues to report bugs or suggest new features.
- Submit Pull Requests to participate in code development.
- Share your experience using unidoc and your templates.

### 📜 License

This project is open-sourced under the [MIT License](LICENSE).

<p align="center">
  Made with ❤️ by Qiao-zhihang 2026
</p>

---

## 🇨🇳 中文版

<div align="center">

# unidoc
**为 AI 时代重塑的轻量级文档引擎**

<span>一份 Markdown 文件，融合文档、表格与幻灯片，让 AI 真正理解您的数据。</span>

<a href="#">下载体验</a> · <a href="#">使用文档</a> · <a href="#">参与贡献</a>

</div>

---

### 我们的设计哲学

在 AI 驱动生产力的当下，传统的 Office 三件套显得日益臃肿。复杂的排版、晦涩的公式、不兼容的格式，已成为人与 AI 协作的高墙。

我们坚信 **Markdown** 是连接人类思维与 AI 处理能力的最佳桥梁。它简洁、结构化，且对机器极度友好。然而，普通用户长久以来缺乏一款既好用又强大的现代化编辑器。

**unidoc** 应运而生。它不仅仅是一个 Markdown 编辑器，更是一个集成了文档、数据与演示的 AI 原生生产力平台。

### 核心特性

#### 1. 极致轻量，极速启动
安装包仅 **10MB**，基于 Tauri v2 构建，不内嵌庞大的 Chrome 内核。
利用系统 WebView 进行渲染，冷启动速度极快，让您的灵感无需等待。

#### 2. 三位一体的创作体验
一份 Markdown 文件，三种展现形态：
- **文档模式**：流畅的阅读与写作体验，支持大纲、代码高亮。
- **表格插入**：在文档中插入表格，轻松处理数据统计，告别 Excel 的繁重。
- **幻灯片模式**：一键切换演示视图，让 Markdown 直接变身 PPT，从此告别排版焦虑。

#### 3. AI Native 深度集成
不仅是“对话框”，更是您的“协作者”：
- **自研 Agent 框架**：深度集成 AI 能力，支持用户自定义配置 API。
- **仓库级管理**：AI 可以直接读取、理解并管理您的本地文档仓库。
- **真正的生产力**：一句话就能让 AI 完成繁琐工作，让 AI 协同办公成为现实。

#### 4. 本地优先，数据主权
所有文件均以 `.md` 格式保存在您的本地仓库。
支持通用的 Markdown 语法，完全兼容主流编辑器（Typora, Obsidian 等）。
您的数据只属于您，安全可控，随处可用。

#### 5. 强大的语法支持
我们采用标准 Markdown，完全支持通用语法，并提供部分图形化操作以降低使用门槛。
- 内置 KaTeX 支持，完美渲染复杂数学公式。
- 支持 Mermaid 图表与常用 HTML 语法。
- 灵活插入图片块、表格块、代码块，让内容管理更自由。

### 技术架构

unidoc 采用了现代化的前端技术栈与高性能的 Rust 后端：

| 层级 | 技术栈 |
| :--- | :--- |
| **前端框架** | Vue 3 + TypeScript + Vite |
| **状态管理** | Pinia |
| **桌面框架** | Tauri v2 (Rust) |
| **渲染引擎** | 系统 WebView (WebView2 / WKWebView / WebKitGTK) |
| **公式渲染** | KaTeX |
| **图表渲染** | Mermaid |

### 安装与使用

> 我们已发布首个版本，实现了上述所有核心功能。

1. 请前往 [Releases](https://github.com/Qiao-zhihang/uni-doc/releases) 页面下载对应平台的安装包。
2. 安装并启动 unidoc。
3. 选择或创建一个本地文件夹作为您的文档仓库。
4. 开始享受纯粹的写作与 AI 协作体验。

### 参与贡献

unidoc 目前处于早期阶段，我们热忱欢迎各种形式的贡献：
- 提交 Issue 反馈 Bug 或提出新功能建议。
- 提交 Pull Request 参与代码共建。
- 分享您使用 unidoc 的体验与模版。

### 📜 开源协议

本项目基于 [MIT License](LICENSE) 开源。

<p align="center">
  Made with ❤️ by Qiao-zhihang 2026
</p>
