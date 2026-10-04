---
title: unidoc - 通用文档说明
author: Qiao-zhihang
version: 4.1.0
created_at: "2026-07-17T14:32:43.322Z"
updated_at: "2026-10-04T09:09:14.629Z"
---
## 🇺🇸 English Version

<div align="center">

# unidoc

**A Lightweight Document Engine Reimagined for the AI Era**

<span>One Markdown file — documents, tables and slides. Plus an AI agent that can actually edit your vault.</span>

[Download](https://github.com/Qiao-zhihang/uni-doc/releases) · [Keyboard Shortcuts](#keyboard-shortcuts) · [Known Limitations](#known-limitations)

</div>

---

### Our Design Philosophy

In an era where AI drives productivity, traditional Office software feels increasingly bloated. Complex formatting, obscure formulas, and incompatible formats have become significant barriers between humans and AI collaboration.

We firmly believe **Markdown** is the optimal bridge connecting human thought with AI processing capabilities. It is concise, structured, and extremely machine-friendly. However, average users have long lacked a modern editor that is both easy to use and powerful.

**unidoc** was created to meet this need. It is not just another Markdown editor, but an AI-native productivity platform that integrates documents, data, and presentations — while keeping every byte of your content in plain `.md` files you own.

### Core Features

#### 1. Lightweight and Native

Built on **Tauri v2** with a Rust backend — no bundled Chromium. Rendering uses the system WebView (WebView2 / WKWebView / WebKitGTK), so cold start is instant and the installer stays small. Windows installers (MSI / NSIS) are produced out of the box.

#### 2. Three-in-One Authoring — Plus Version History

One Markdown file, several ways to work with it:

- **Document Mode** — block-based rich editing. Type a Markdown prefix (`#`, `-`, `1.`, `>`, fenced-code, `---`) and press **Enter** to convert the block; inline marks are parsed when you leave the block. Outline panel, multi-tab editing (drag to reorder, right-click to close groups), command palette (`Ctrl+Shift+P`), zoom 50%–200%, and a debounced 800 ms auto-save with a per-tab status indicator.
- **Tables** — right-click a cell to insert or delete rows and columns; alignment is honoured when parsed from Markdown.
- **Slide Mode** — write `---page---` where a slide should break and press **F5**. Arrow keys, space, PageUp/PageDown and Home/End navigate, `Esc` exits, and a progress bar plus page number show where you are.
- **Version history & replay** (optional, off by default) — snapshots are collected on every edit commit, optionally on a timer, plus manual snapshots and milestones. Playback supports speed control, timeline scrubbing, milestone jumps and **revert to this version** (undoable). Desktop keeps the history in a `<file>.md.history.json` sidecar; the browser build uses IndexedDB.

#### 3. AI-Native, Not a Chat Box

The assistant **UU鲨** is wired into the editor and the vault through a proprietary agent framework — **24 tools** and up to **10 tool-calling rounds** per turn:

- **Edits your documents** — insert / update / delete / move / convert blocks, batch-edit a whole section (one shared undo step), or rewrite a document atomically.
- **Manages your vault** — list directories, read, search and create files, switch tabs, resolve image paths.
- **Web search** — the provider's native search (Qwen) or the built-in `web_search` tool (Bing, top 10 results).
- **Vision** — attach up to 3 images per message to ask about screenshots and diagrams.
- **Memory** — a long-term user profile plus extracted facts, scored by keyword, tag, recency, importance and access count, then injected per question. Written by the assistant (`save_memory`) and by end-of-conversation extraction.
- **Reminders** — one-off, daily, weekly or interval reminders created through conversation, checked every second and delivered as a system notification plus an in-app message; pause, resume or delete them in the Reminders page.
- **Multi-profile models** — six provider presets (OpenAI, DeepSeek, Qwen, Zhipu, Ollama, custom), each with a real capability probe (vision / function calling / native search).
- **Floating or split-pane** — the AI window can float over the editor or dock as a split pane; replies stream in, can be stopped mid-way, and show live tool-call status.
- **Rich replies** — answers render images, KaTeX math, Mermaid diagrams, `==highlight==`, `^sup^`, `~sub~`, `<u>underline</u>`, whitelisted HTML and footnotes. During streaming a lightweight renderer keeps typing smooth; the full renderer takes over when the answer completes.

#### 4. Local First, Data Sovereignty

Documents are saved as **plain `.md`** (plus a small YAML front-matter block) — no proprietary container format. Point unidoc at any folder as your vault and keep using Typora, Obsidian or any other editor on the same files: page breaks become `---page---`, images prefer the Obsidian-style `![[file|width|alt]]` form, tables stay GFM. Settings, AI conversations, memory and reminders live in `~/.unidoc/*.json` on your machine.

#### 5. Powerful Syntax Support

- **Block level** — headings H1–H6, paragraphs, ordered / unordered / task lists (nestable), blockquotes with nested blocks, dividers, `---page---` page breaks, fenced code blocks, tables, images.
- **Inline** — bold, italic, strikethrough, inline code, `<u>` underline, `==highlight==`, `^superscript^`, `~subscript~`, links and autolinks, `[[wikilinks]]` with autocomplete, inline images, math.
- **KaTeX** — inline `$…$` and block `$$…$$` formulas.
- **Mermaid** — flowcharts, sequence, class, state, gantt, pie, mindmap, ER diagrams and more, rendered from fenced code blocks whose language is `mermaid`.
- **HTML whitelist** — layout, table, list and presentational tags (`div`, `details`, `table`, `kbd`, `mark`, `progress`…) with event handlers and dangerous protocols stripped.

#### 6. Extensible Through Plugins

Each vault can carry plugins in `<vault>/.unidoc/plugins/<id>/` (a `manifest.json` plus a JS entry, loaded at runtime). A plugin can register commands (with hotkeys), define **custom block types** with their own components, serializers and deserializers, add a settings panel, subscribe to editor events, persist data, and use the editor / vault / UI APIs — under one of 14 declared permissions. Settings lets you enable, disable, re-scan plugins or run in safe mode.

#### 7. Verifiable by Design

The repository ships a **zero-dependency regression harness** (`scripts/ai-render-tests/run.mjs`) with 100+ assertions covering the Markdown parser, the serializer round-trip and the AI reply renderer — plus a hand-checkable fixture set in [`测试/`](./测试/) used for manual acceptance and round-trip regression. No test framework needs to be installed.

### Feature Matrix

| Area | What you get |
| :--- | :--- |
| **Editing** | Block canvas, Markdown-prefix + Enter conversion, undo/redo (100-step snapshot stack, 1 s merge), multi-tab with drag reorder, outline panel, command palette, zoom 50%–200%, 800 ms debounced auto-save, word / block / page counters |
| **Structure** | 9 built-in block types (paragraph, heading, list, quote, code block, table, image, divider, page break) + plugin-defined blocks |
| **Inline** | 13 inline mark types incl. underline, highlight, super/subscript, math, wikilink and whitelisted HTML |
| **Files** | Multi-vault manager, folder tree, create / rename / delete / copy path, `[[wikilink]]` jump with autocomplete, plain `.md` on disk, YAML front-matter |
| **Presentation** | `---page---` pagination, full-screen mode with keyboard paging and progress bar, optional version history with replay and revert |
| **Export** | HTML export (styled / semantic / print, light or dark, images kept or inlined as base64) and Markdown save |
| **AI** | 24-tool agent, vault editing, file search, web search, vision, memory, reminders, six provider presets, streaming, rich Markdown replies |
| **Themes** | Light / dark themes driven by CSS variables, persisted locally, follows the system on first run |
| **Security** | Content Security Policy, scoped asset protocol, 74-tag / 28-attribute HTML whitelist, URL protocol allowlist, `asset://`-based image loading in the editor, vault-confined write paths in the Rust backend |
| **Quality** | 100+ automated assertions, zero-dependency runner, manual fixture set, strict TypeScript build gate |

### Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `F5` | Enter presentation mode |
| `Ctrl + K` | Show / hide the AI window |
| `Ctrl + Shift + P` | Command palette |
| `Ctrl + \` | Toggle the file explorer |
| `Ctrl + Shift + \` | Toggle the outline panel |
| `Ctrl + S` | Save as `.md` |
| `Ctrl + Z` / `Ctrl + Shift + Z` (or `Ctrl + Y`) | Undo / redo |
| `Backspace` / `Delete` on a selected block | Delete it (at the start of a block: merge with the previous one) |
| `Enter` (in the AI input) | Send · `Shift + Enter` for a new line |
| `Esc` | Exit presentation mode / the replay player |

### Technical Architecture

| Layer | Stack |
| :--- | :--- |
| **Frontend** | Vue 3 + TypeScript + Vite |
| **State** | Pinia |
| **Routing** | vue-router (hash history) |
| **Markdown parsing** | `mdast-util-from-markdown` + a custom inline parser and Markdown serializer |
| **Formula / Diagram** | KaTeX · Mermaid |
| **AI integration** | OpenAI-compatible `chat/completions` with SSE streaming, 6 provider presets, 24 tools, JSON persistence in `~/.unidoc/` |
| **Desktop shell** | Tauri v2 (Rust 1.77.2+), 33 backend commands, plugins: dialog, fs, notification, log |
| **Rendering engine** | System WebView (WebView2 / WKWebView / WebKitGTK) |
| **Icons** | lucide-vue-next |
| **Packaging** | MSI / NSIS installers (`npm run tauri build`) |

### Getting Started (from source)

```bash
# Requirements: Node 18+, Rust 1.77.2+ (for the desktop shell)
npm install

npm run tauri dev     # run the desktop app
npm run dev           # frontend only, in a browser (web mode: no vault/file tools, no web search)
npm run tauri build   # produce installers
npm run build         # type-check + build the web assets
npm run lint          # ESLint + Prettier
```

Then launch the app, pick a folder as your vault, and start writing.

### Project Structure

```
src/
├── ai/            agent framework, model adapters, tools, memory, context, reply renderer
├── components/    layout (ribbon, explorer, AI window), editor, blocks, dialogs
├── composables/   reusable UI logic (contenteditable, dialogs, wikilink autocomplete)
├── core/          blocks model, parsers, serializers, vault, plugins, replay, theme
├── router/        hash-history routes (editor / settings / reminders)
├── stores/        Pinia stores (document, settings, vault, AI, memory, replay…)
└── views/         full-page views
src-tauri/         Rust backend (file IO, dialogs, AI persistence, search, notifications)
scripts/           zero-dependency test runner and cases
测试/               manual acceptance fixtures (see 测试/README.md)
```

### Testing & Verification

```bash
node scripts/ai-render-tests/run.mjs
```

The runner bundles the pure-function test cases with the project's own `esbuild` and executes them in Node — no vitest/jest, no extra dependency. It asserts, among other things, that:

- the Markdown parser and serializer are **round-trip stable** (repeated save/reopen does not grow the file);
- inline code stays literal, tables keep their escaping, and `\`-escapes survive;
- the AI reply renderer handles images / math / diagrams / footnotes and neutralises injected HTML;
- every fixture in `测试/` renders without throwing and round-trips identically.

For manual acceptance, open the documents in [`测试/`](./测试/) and follow the "预期 / expected" notes in each section.

### Known Limitations

We prefer an honest list over marketing claims:

**Syntax and editing**

- **No syntax highlighting** in code blocks (language label and background only).
- **Footnotes** (`[^1]`) render in AI replies; the document editor keeps them as literal text.
- **Block math must stay on one line** (`$$…$$` cannot span lines).
- A single paragraph longer than ~20,000 characters falls back to plain text.
- **Interactive list indentation is not implemented** (nested lists parse and render, but there is no Tab/Shift+Tab outdent).
- **No full-text search and no backlinks** inside the editor (the ribbon search button is a placeholder); the assistant can search files through its tools.
- Inline-code content is treated literally, with one compatibility rule: `\` followed by punctuation is unescaped on open (legacy repair), while `\` followed by a letter or digit (e.g. `C:\Users`, `\d+`) is preserved.
- No multi-cursor editing, no real-time collaboration, no cloud sync, no PDF export (use the print-optimised HTML export and print to PDF).

**AI**

- **Tool calls are not sandboxed at the code level.** The confirmation policy for risky operations (rewriting a whole document, deleting several blocks, overwriting an existing file) lives in the system prompt — review large edits before accepting them.
- **Memory has no management UI yet**: it is written by the assistant and by automatic extraction; the Settings section is a "coming soon" placeholder.
- **Browser (web) mode is limited**: no vault/file tools and no web search — those need the desktop shell.

**Platform**

- Installers are currently configured for **Windows** (MSI / NSIS); other platforms need their own bundle targets.

### Contributing

unidoc is still early, and all forms of contribution are welcome:

- Open an Issue to report a bug or propose a feature.
- Submit a Pull Request — please run `npm run build`, `npm run lint` and `node scripts/ai-render-tests/run.mjs` before pushing.
- Share your experience and your templates.

### 📜 License

This project is open-sourced under the [MIT License](LICENSE).

For the list of open source software used by this project and their licenses, please see the [Open Source Software Usage Declaration](ACKNOWLEDGEMENTS.md).

<p align="center">
  Made with ❤️ by Qiao-zhihang 2026
</p>

---

## 🇨🇳 中文版

<div align="center">

# unidoc

**为 AI 时代重塑的轻量级文档引擎**

<span>一份 Markdown 文件,融合文档、表格与幻灯片;外加一个真的能动手改你仓库的 AI 助手。</span>

[下载体验](https://github.com/Qiao-zhihang/uni-doc/releases) · [快捷键](#快捷键) · [已知限制](#已知限制)

</div>

---

### 我们的设计哲学

在 AI 驱动生产力的当下,传统的 Office 三件套显得日益臃肿。复杂的排版、晦涩的公式、不兼容的格式,已成为人与 AI 协作的高墙。

我们坚信 **Markdown** 是连接人类思维与 AI 处理能力的最佳桥梁。它简洁、结构化,且对机器极度友好。然而,普通用户长久以来缺乏一款既好用又强大的现代化编辑器。

**unidoc** 应运而生。它不仅仅是一个 Markdown 编辑器,更是一个集成了文档、数据与演示的 AI 原生生产力平台——同时保证你的每一个字节都以**纯 `.md`** 保存在自己手里。

### 核心特性

#### 1. 极致轻量,原生体验

基于 **Tauri v2** 与 Rust 后端构建,不内嵌 Chromium。渲染交给系统 WebView(WebView2 / WKWebView / WebKitGTK),冷启动几乎瞬时,安装包保持小巧。开箱即可产出 Windows 安装包(MSI / NSIS)。

#### 2. 三位一体,外加版本历史

一份 Markdown 文件,多种工作方式:

- **文档模式** —— 块级富文本编辑。输入 Markdown 前缀(`#`、`-`、`1.`、`>`,围栏代码块、`---`)后按 **回车**即转换为对应块;行内标记在离开块时解析。配大纲面板、多标签页(可拖拽排序、右键关闭一组)、命令面板(`Ctrl+Shift+P`)、缩放 50%–200%,以及 800ms 防抖自动保存与按标签页的保存状态。
- **表格** —— 单元格右键即可插入 / 删除行列;对齐方式按 Markdown 解析结果渲染。
- **幻灯片模式** —— 在需要分页处写 `---page---`,按 **F5** 演示。方向键、空格、PageUp/PageDown、Home/End 翻页,`Esc` 退出,并有进度条与页码提示。
- **版本历史与回放**(可选,默认关闭)—— 每次编辑提交自动采集快照,可选定时采集,支持手动快照与里程碑;播放器支持倍速、时间轴拖动、里程碑跳转与**回退到此版本**(可撤销)。桌面端历史存放在 `<文件名>.md.history.json` 侧车文件,浏览器端用 IndexedDB。

#### 3. AI 原生,而不是"塞了个对话框"

助手 **UU鲨** 通过自研 Agent 框架深度接入编辑器与仓库——**24 个工具**,单轮最多 **10 轮工具调用**:

- **直接改文档** —— 插入 / 更新 / 删除 / 移动 / 转换区块、整章批量编辑(合并为一次撤销)、整篇原子替换。
- **管理你的仓库** —— 列目录、读文件、搜索文件、新建笔记、切换标签页、解析图片路径。
- **联网搜索** —— 提供商原生联网(通义千问)或内置 `web_search` 工具(Bing,最多 10 条结果)。
- **图片理解** —— 每条消息最多附 3 张图片,可用于提问截图与示意图。
- **长期记忆** —— 用户画像 + 抽取的事实,按关键词、标签、时间衰减、重要度与访问次数打分,按问题检索后注入上下文;由助手(`save_memory`)与会话结束时的自动抽取写入。
- **提醒** —— 通过对话创建一次性 / 每天 / 每周 / 间隔提醒,每秒检查到期,触发系统通知并写入会话消息;可在提醒页暂停、恢复、删除。
- **多配置模型** —— 6 种 Provider 预设(OpenAI、DeepSeek、通义千问、智谱、Ollama、自定义),并用真实探针检测模型能力(vision / function calling / 原生联网)。
- **浮窗或分屏** —— AI 面板可浮在编辑器上,也可作为右侧分屏停靠;回答流式输出、可随时停止,并实时显示工具调用状态。
- **富文本回答** —— 图片、KaTeX 公式、Mermaid 图表、`==高亮==`、`^上标^`、`~下标~`、`<u>下划线</u>`、白名单 HTML 与脚注均可正常渲染。流式输出期间使用轻量渲染器保证流畅,回答结束后切换为完整渲染。

#### 4. 本地优先,数据主权

文档以**纯 `.md`** 保存(外加快 YAML front-matter 元信息),不引入私有容器格式。把 unidoc 指向任意文件夹即可作为仓库,同一批文件继续用 Typora、Obsidian 打开也没问题:分页符就是 `---page---`,图片优先使用 Obsidian 风格的 `![[文件|宽度|alt]]`,表格保持 GFM。设置、AI 会话、记忆与提醒存放在本机的 `~/.unidoc/*.json`。

#### 5. 强大的语法支持

- **块级** —— H1–H6 标题、段落、有序 / 无序 / 任务列表(可嵌套)、引用(内含块级元素)、分割线、`---page---` 分页、围栏代码块、表格、图片。
- **行内** —— 粗体、斜体、删除线、行内代码、`<u>` 下划线、`==高亮==`、`^上标^`、`~下标~`、链接与自动链接、`[[wikilink]]`(带补全)、行内图片、公式。
- **KaTeX** —— 行内 `$…$` 与块级 `$$…$$` 公式。
- **Mermaid** —— 流程图、时序图、类图、状态图、甘特图、饼图、思维导图、ER 图等,直接写语言为 `mermaid` 的围栏代码块。
- **HTML 白名单** —— 布局、表格、列表与展示类标签(`div`、`details`、`table`、`kbd`、`mark`、`progress` 等),事件属性与危险协议会被剥离。

#### 6. 插件化扩展

每个仓库都可以带插件:`<仓库>/.unidoc/plugins/<id>/`(一个 `manifest.json` + JS 入口,运行时加载)。插件可注册命令(含快捷键)、定义**自定义块类型**(自带组件与序列化 / 反序列化)、添加设置面板、订阅编辑器事件、持久化数据,并使用 editor / vault / ui 三套 API——权限在 14 项声明中选择。设置页可启用、禁用、重扫插件或进入安全模式。

#### 7. 可验证

仓库自带**零依赖回归测试台**(`scripts/ai-render-tests/run.mjs`),100+ 条断言覆盖 Markdown 解析、序列化往返与 AI 回答渲染;另有 [`测试/`](./测试/) 目录提供可手工核对的验收用例与往返回归用例。无需安装任何测试框架。

### 功能矩阵

| 方面 | 具体能力 |
| :--- | :--- |
| **编辑** | 块级画布、Markdown 前缀 + 回车转换、撤销重做(100 步快照栈、1 秒内合并)、多标签页拖拽排序、大纲面板、命令面板、缩放 50%–200%、800ms 防抖自动保存、字数 / 区块数 / 页数统计 |
| **结构** | 9 种内建块(段落、标题、列表、引用、代码块、表格、图片、分割线、分页符)+ 插件自定义块 |
| **行内** | 13 种行内标记,含下划线、高亮、上下标、公式、wikilink 与白名单 HTML |
| **文件** | 多仓库管理、目录树、新建 / 重命名 / 删除 / 复制路径、`[[wikilink]]` 跳转与补全、磁盘上就是纯 `.md`、YAML front-matter |
| **演示** | `---page---` 分页、全屏演示(键盘翻页 + 进度条)、可选的版本历史与回放、回退到指定版本 |
| **导出** | HTML 导出(样式化 / 语义化 / 打印三种形态,亮暗主题,图片保留或内联为 base64)与 Markdown 保存 |
| **AI** | 24 个工具的 Agent、文档编辑、文件搜索、联网搜索、图片理解、长期记忆、提醒、6 种 Provider 预设、流式输出、富文本回答 |
| **主题** | 基于 CSS 变量的明暗主题,本地持久化,首次启动跟随系统 |
| **安全** | 内容安全策略(CSP)、asset 协议作用域、74 标签 / 28 属性 HTML 白名单、URL 协议白名单、编辑器内 `asset://` 图片加载、Rust 后端写入限制在仓库内 |
| **质量** | 100+ 条自动断言、零依赖运行器、手测用例集、严格 TypeScript 构建门禁 |

### 快捷键

| 快捷键 | 作用 |
| :--- | :--- |
| `F5` | 进入演示模式 |
| `Ctrl + K` | 显示 / 隐藏 AI 浮窗 |
| `Ctrl + Shift + P` | 命令面板 |
| `Ctrl + \` | 切换文件浏览器 |
| `Ctrl + Shift + \` | 切换大纲面板 |
| `Ctrl + S` | 保存为 `.md` |
| `Ctrl + Z` / `Ctrl + Shift + Z`(或 `Ctrl + Y`) | 撤销 / 重做 |
| 选中块后 `Backspace` / `Delete` | 删除该块(在块首按 `Backspace` 则与上一块合并) |
| AI 输入框 `Enter` | 发送(`Shift + Enter` 换行) |
| `Esc` | 退出演示模式 / 关闭回放播放器 |

### 技术架构

| 层级 | 技术栈 |
| :--- | :--- |
| **前端框架** | Vue 3 + TypeScript + Vite |
| **状态管理** | Pinia |
| **路由** | vue-router(hash 模式) |
| **Markdown 解析** | `mdast-util-from-markdown` + 自研行内解析器与序列化器 |
| **公式 / 图表** | KaTeX · Mermaid |
| **AI 接入** | OpenAI 兼容 `chat/completions`,SSE 流式,6 种 Provider 预设,24 个工具,JSON 存放于 `~/.unidoc/` |
| **桌面框架** | Tauri v2(Rust 1.77.2+),33 个后端命令,插件:dialog、fs、notification、log |
| **渲染引擎** | 系统 WebView(WebView2 / WKWebView / WebKitGTK) |
| **图标** | lucide-vue-next |
| **打包** | MSI / NSIS 安装包(`npm run tauri build`) |

### 从源码开始

```bash
# 依赖:Node 18+;桌面外壳需要 Rust 1.77.2+
npm install

npm run tauri dev     # 启动桌面应用
npm run dev           # 仅前端,浏览器里运行(Web 模式:无仓库/文件工具,无联网搜索)
npm run tauri build   # 产出安装包
npm run build         # 类型检查 + 构建前端产物
npm run lint          # ESLint + Prettier
```

启动后选择一个文件夹作为仓库,即可开始写作。

### 项目结构

```
src/
├── ai/            Agent 框架、模型适配、工具、记忆、上下文、回答渲染器
├── components/    布局(侧边栏、文件树、AI 浮窗)、编辑器、块组件、对话框
├── composables/   可复用 UI 逻辑(contenteditable、对话框、wikilink 自动补全)
├── core/          块模型、解析器、序列化器、仓库、插件、回放、主题
├── router/        hash 路由(编辑器 / 设置 / 提醒)
├── stores/        Pinia 状态(文档、设置、仓库、AI、记忆、回放…)
└── views/         整页视图
src-tauri/         Rust 后端(文件读写、对话框、AI 持久化、搜索、通知)
scripts/           零依赖测试运行器与用例
测试/              手工验收与回归用例(见 测试/README.md)
```

### 测试与验证

```bash
node scripts/ai-render-tests/run.mjs
```

运行器用项目自带的 `esbuild` 打包纯函数用例,再在 Node 里执行——不需要 vitest/jest,也不新增依赖。它会断言(节选):

- Markdown 解析与序列化是**往返稳定**的(反复保存、重开不会让文件变大);
- 行内代码保持字面量、表格转义正确、反斜杠转义不丢失;
- AI 回答渲染器正确处理图片 / 公式 / 图表 / 脚注,并中和注入的 HTML;
- `测试/` 下每个用例文件渲染不抛异常,且往返结果恒等。

手工验收:打开 [`测试/`](./测试/) 下的文档,按各节标注的「预期」逐项核对。

### 已知限制

我们更愿意给出诚实的清单,而不是宣传话术。

**语法与编辑**

- 代码块**没有语法高亮**(只有语言标签与底色);
- **脚注**(`[^1]`)只在 AI 回答里渲染,文档编辑器里按字面文本显示;
- **块级公式必须写在同一行**(`$$…$$` 不能跨行);
- 单个段落超过约 2 万字符时会退化为纯文本;
- **列表的交互式缩进未实现**(嵌套列表能解析与渲染,但没有 Tab/Shift+Tab 缩进);
- 编辑器内**没有全文搜索、没有反向链接**(Ribbon 上的搜索按钮是占位);助手可通过工具搜索文件;
- 行内代码按字面量处理,但有一条历史兼容规则:反斜杠 + **标点**会在打开时被还原(修复老文档污染),反斜杠 + **字母/数字**(如 `C:\Users`、`\d+`)原样保留;
- 没有多光标编辑、没有实时协作、没有云同步、没有 PDF 导出(可用打印优化的 HTML 导出后自行打印为 PDF)。

**AI**

- **工具调用没有代码层的沙箱与审批**:高风险操作(整篇替换、批量删除、覆盖已有文件)的确认策略写在系统提示词里,大规模改动请在接受前复核;
- **记忆尚无管理界面**:由助手与自动抽取写入,设置页该区块仍是"敬请期待"占位;
- **浏览器(Web)模式受限**:没有仓库/文件工具,也没有联网搜索,这些需要桌面外壳。

**平台**

- 安装包目前按 **Windows**(MSI / NSIS)配置,其它平台需要自行设置打包目标。

### 参与贡献

unidoc 目前仍处于早期阶段,我们热忱欢迎各种形式的贡献:

- 提交 Issue 反馈 Bug 或提出新功能建议;
- 提交 Pull Request——推送前请先跑 `npm run build`、`npm run lint` 与 `node scripts/ai-render-tests/run.mjs`;
- 分享您使用 unidoc 的体验与模版。

### 📜 开源协议

本项目基于 [MIT License](LICENSE) 开源。

本项目所使用的开源软件及其协议清单,请参阅[开源软件使用声明](ACKNOWLEDGEMENTS.md)。

<p align="center">
  Made with ❤️ by Qiao-zhihang 2026
</p>
