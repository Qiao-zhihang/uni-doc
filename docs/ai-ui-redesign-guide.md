# UU鲨 AI 对话系统 UI 重做指南

> 本文件供专门负责 UI 实现的 AI 阅读。请严格按本文档执行，不要自行增减功能。

---

## 1. 需求概述

| # | 需求 | 说明 |
|---|------|------|
| 1 | 自动检测模型能力 | 根据 provider + model 名自动判断是否支持联网搜索（function calling）和图片理解（vision），在 UI 上动态显示/隐藏对应按钮，无需用户手动开关 |
| 2 | 多 API 配置 + 会话内切换 | 设置页支持配置多个 API Profile（每个含 provider/apiKey/apiUrl/model/temperature/maxTokens），在 AI 对话界面可下拉切换当前使用的 Profile。为后续多 AI 协作预留 |
| 3 | 多会话 | 类似聊天软件：新建会话、进入会话、删除会话，每个会话独立维护消息历史 |
| 4 | 亮色/暗色适配 | 所有新增 UI 必须使用语义 CSS 变量，禁止硬编码颜色 |

---

## 2. 现有架构（必读）

### 2.1 文件清单

| 文件 | 职责 |
|------|------|
| `src/components/layout/AiFloatingWindow.vue` | AI 浮窗组件（当前单会话） |
| `src/stores/editor.ts` | 管理 `aiFloatingState: 'closed' \| 'expanded' \| 'minimized'` |
| `src/stores/settings.ts` | AI 配置 store（当前单 API Profile） |
| `src/stores/theme.ts` | 主题 store（`mode: 'light' \| 'dark'`） |
| `src/style.css` | 全局 CSS 变量唯一定义处（`:root` 浅色 + `.dark` 深色） |
| `src/ai/agent.ts` | Agent 编排（`createAgent` 工厂，返回 `chat`/`clear`/`loadHistory`） |
| `src/ai/types.ts` | 类型定义（`ChatMessage`、`ModelConfig`、`ToolCall` 等） |
| `src/ai/model.ts` | OpenAI 兼容客户端（`streamChat`、`chat`） |
| `src/ai/tools.ts` | 工具注册（`createTools(doc, editor, enableWebSearch)`） |
| `src/ai/context.ts` | 上下文构建 + system prompt 生成 |
| `src/views/SettingsView.vue` | 设置页（含 AI 配置 section） |
| `src/components/layout/Ribbon.vue` | 左侧工具栏，第 65 行有 AI 按钮触发 `toggleAiFloating()` |

### 2.2 当前 AI 浮窗结构

```
.ai-floating (fixed, 380×540, 可拖拽可调整大小)
  ├── .float-header (标题栏, 可拖拽移动)
  │   ├── UU鲨图标 + 标题
  │   └── 清空/最小化/关闭 按钮
  ├── .chat-area (消息列表, 自动滚动到底部)
  ├── .input-area
  │   ├── 工具状态条 (调用中/已完成)
  │   ├── 图片预览行
  │   └── 输入行 (联网按钮 + 图片按钮 + textarea + 发送按钮)
  └── .resize-handle (右下角调整大小手柄)

.ai-bubble (最小化态, 44×44 圆形气泡)
```

### 2.3 当前 settings store 结构

```ts
// 单 Profile，字段直接暴露为 ref
provider: ref<ProviderPreset>
apiKey: ref<string>
apiUrl: ref<string>
model: ref<string>
temperature: ref<number>
maxTokens: ref<number>
modelCapabilities: computed<{ vision: boolean; webSearch: boolean }>
```

持久化结构（`~/.unidoc/settings.json`）：
```json
{ "provider": "...", "apiKey": "...", "apiUrl": "...", "model": "...", "temperature": 0.7, "maxTokens": 4096 }
```

### 2.4 当前 agent.ts 会话管理

```ts
createAgent(deps): Agent
  // 内部维护单个 messages: ChatMessage[] 闭包
  // chat(userInput, callbacks) — 单轮对话
  // clear() — 清空 messages
  // loadHistory() — 从 ~/.unidoc/ai_history.json 加载
```

Rust 端命令：`save_ai_history(json)` / `load_ai_history()` / `clear_ai_history()`

### 2.5 当前 AI 消息历史持久化

单一文件 `~/.unidoc/ai_history.json`，存储扁平的 `ChatMessage[]`。

---

## 3. 目标 UI 设计

### 3.1 整体布局变更

从「单列浮窗」改为「左侧会话列表 + 右侧对话区」的双栏浮窗。

```
┌──────────────────────────────────────────────┐
│  UU鲨          [Profile ▼]  [+] [—] [×]     │  ← 标题栏
├────────────┬─────────────────────────────────┤
│            │                                 │
│  + 新建会话 │                                 │
│            │         消息区                   │
│ ● 会话1    │                                 │
│   会话2    │                                 │
│   会话3    │                                 │
│            │                                 │
│            ├─────────────────────────────────┤
│            │ 🌐 📎 [ textarea... ] [发送]    │
│            │                                 │
└────────────┴─────────────────────────────────┘
     ↑ 会话列表        ↑ 对话区
     (可折叠)           (含输入栏)
```

### 3.2 窗口尺寸

- 默认尺寸：**480×600**（比当前 380×540 略大，容纳会话列表）
- 最小尺寸：**360×450**
- 最大尺寸：不限制（用户可拖拽到任意大小）
- 会话列表宽度：**160px**，可折叠（折叠后仅显示图标条 40px）
- 保持现有的拖拽移动 + 右下角调整大小功能

### 3.3 三种窗口状态

| 状态 | 描述 |
|------|------|
| `closed` | 不渲染任何 AI UI |
| `expanded` | 完整双栏浮窗 |
| `minimized` | 44×44 圆形气泡（无红色消息数提示） |

### 3.4 会话列表（左侧栏）

```
┌──────────────┐
│ + 新建会话    │  ← 按钮，点击创建新会话
├──────────────┤
│ ● 会话标题1   │  ← 当前活跃会话（高亮）
│   会话标题2   │
│   会话标题3   │
│   ...        │
│              │
│              │
├──────────────┤
│   会话标题N   │  ← 列表可滚动
└──────────────┘
```

- 每个会话项显示：标题（取第一条用户消息前 20 字，无消息时显示"新对话"）
- 当前活跃会话：左侧有 3px 蓝色竖条 + 背景色高亮
- 鼠标悬停会话项：显示删除按钮（小垃圾桶图标，右上角）
- 点击会话项：切换到该会话
- 点击删除：弹出确认（用自定义浮层，不用原生 confirm）
- 会话列表按最后更新时间降序排列
- 空状态：列表为空时显示"点击上方新建会话开始对话"

### 3.5 标题栏

```
[UU鲨图标] UU鲨    [Profile名 ▼]    [+] [—] [×]
```

- 左侧：UU鲨图标 + "UU鲨" 标题
- 中间：当前 API Profile 下拉选择器（显示 Profile 名称，点击展开下拉列表）
- 右侧按钮组：
  - `[+]` 新建会话（与左侧栏的新建按钮功能相同）
  - `[—]` 最小化
  - `[×]` 关闭

### 3.6 Profile 下拉选择器

```
点击 [Profile名 ▼] 展开：
┌──────────────────────┐
│ ✓ DeepSeek (当前)     │
│   OpenAI GPT-4o      │
│   通义千问            │
│   Ollama 本地         │
│ ───────────────────  │
│   管理配置...         │  ← 跳转到设置页
└──────────────────────┘
```

- 显示每个 Profile 的名称 + 模型能力图标（🌐=联网 / 📷=图片）
- 当前使用的 Profile 前面有 ✓
- 点击 Profile 项：切换当前会话使用的 API 配置
- 底部"管理配置..."跳转到设置页的 AI 配置区域

### 3.7 输入区

```
┌─────────────────────────────────┐
│ 📷 [img1] [img2] [img3]        │  ← 图片预览行（仅有图片时显示）
├─────────────────────────────────┤
│ 🌐  📎  [ textarea... ] [发送]  │
└─────────────────────────────────┘
```

- **🌐 联网搜索按钮**：仅当 `modelCapabilities.webSearch === true` 时显示
  - 点击切换激活/关闭状态
  - 激活时：蓝色背景 + 白色图标（使用 `--primary` / `--primary-foreground`）
  - 未激活：灰色图标（使用 `--muted-foreground`），hover 时 `--secondary` 背景
- **📎 图片上传按钮**：仅当 `modelCapabilities.vision === true` 时显示
  - 点击触发隐藏的 `<input type="file" accept="image/*" multiple>`
  - 最多 3 张图片，超出时忽略
  - 已选图片在上方预览行显示缩略图，每张右上角有 × 可移除
- **textarea**：Enter 发送，Shift+Enter 换行
- **发送按钮**：有内容时可点击，无内容时禁用

### 3.8 消息区

保持现有样式不变，但需注意：
- 用户消息：右对齐，蓝色气泡（`--primary` 背景 + `--primary-foreground` 文字）
- AI 消息：左对齐，灰色气泡（`--secondary` 背景 + `--foreground` 文字），支持 Markdown 渲染
- 错误消息：居中，红色气泡（`--destructive` 背景 + `--destructive-foreground` 文字）
- 工具调用状态条：在消息区底部显示"正在调用 xxx..."或"已完成 xxx"
- 打开窗口 / 切换会话 / 新消息到达时，自动滚动到底部

### 3.9 最小化气泡

```
     ┌────┐
     │ 🦈 │  44×44 圆形，--primary 背景
     └────┘
```

- 不显示红色消息数提示（已在上一轮移除）
- 点击展开为完整浮窗

---

## 4. 设置页变更

### 4.1 从单 API 配置改为多 Profile 管理

设置页的 AI 配置 section 改为：

```
AI 配置
┌─────────────────────────────────────────────┐
│ API 配置列表                                 │
│ ┌─────────────────────────────────────────┐ │
│ │ DeepSeek                  [编辑] [删除]  │ │
│ │ deepseek-chat · 联网✓ 图片✗              │ │
│ ├─────────────────────────────────────────┤ │
│ │ OpenAI                    [编辑] [删除]  │ │
│ │ gpt-4o-mini · 联网✓ 图片✓               │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ [+ 添加配置]                                  │
│                                              │
│ ── 编辑区（添加/编辑时显示）──────────────  │
│ 名称:    [______________]                    │
│ 服务商:  [DeepSeek ▼]                        │
│ API Key: [sk-......] [👁]                    │
│ API URL: [https://......]                    │
│ 模型:    [deepseek-chat]                    │
│ 温度:    [━━●━━━] 0.7                       │
│ Max Tokens: [4096]                          │
│ 模型能力: 联网✓ 图片✗（自动检测）           │
│ [保存] [取消]                                │
└─────────────────────────────────────────────┘
```

- Profile 列表：每项显示名称、模型名、能力标签
- 点击"添加配置"或"编辑"：展开编辑表单
- 点击"删除"：确认后删除（至少保留一个 Profile，最后一个不允许删除）
- 保存时自动检测能力（调用 `detectCapabilities`）
- 不再需要单独的"测试连接"按钮，可在编辑区加一个"测试"按钮

---

## 5. 数据结构变更

### 5.1 settings store（多 Profile）

```ts
/** 单个 API 配置 */
interface ApiProfile {
  id: string          // 唯一标识，用 crypto.randomUUID() 生成
  name: string        // 用户自定义名称，如"我的 DeepSeek"
  provider: ProviderPreset
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  maxTokens: number
}

/** 持久化结构 */
interface SettingsPayload {
  profiles: ApiProfile[]
  activeProfileId: string  // 当前使用的 Profile ID
}
```

store 暴露：
```ts
profiles: Ref<ApiProfile[]>
activeProfileId: Ref<string>
activeProfile: ComputedRef<ApiProfile>
modelCapabilities: ComputedRef<{ vision: boolean; webSearch: boolean }>
addProfile(profile: ApiProfile): void
updateProfile(id: string, patch: Partial<ApiProfile>): void
deleteProfile(id: string): void
setActiveProfile(id: string): void
getModelConfig(): ModelConfig  // 返回 activeProfile 的配置快照
save(): void
load(): Promise<void>
```

### 5.2 多会话数据结构

新增 `src/stores/aiConversation.ts`：

```ts
interface Conversation {
  id: string           // crypto.randomUUID()
  title: string        // 第一条用户消息前 20 字，或"新对话"
  messages: ChatMessage[]
  profileId: string    // 该会话使用的 API Profile ID（创建时锁定，可后续切换）
  createdAt: number    // Date.now()
  updatedAt: number    // 最后一条消息的时间
}
```

store 暴露：
```ts
conversations: Ref<Conversation[]>
activeConversationId: Ref<string | null>
activeConversation: ComputedRef<Conversation | null>
createConversation(profileId: string): string  // 返回新会话 ID
deleteConversation(id: string): void
switchConversation(id: string): void
renameConversation(id: string, title: string): void
addMessage(conversationId: string, message: ChatMessage): void
updateLastMessage(conversationId: string, content: string): void  // 流式更新
clearMessages(conversationId: string): void
```

### 5.3 持久化变更

Rust 端需要新增/修改命令（`src-tauri/src/lib.rs`）：

```rust
// 替换现有的 save_ai_history / load_ai_history / clear_ai_history
#[tauri::command]
fn save_ai_conversations(json: String) -> Result<(), String>  // 保存所有会话

#[tauri::command]
fn load_ai_conversations() -> Result<String, String>  // 加载所有会话
```

持久化文件：`~/.unidoc/ai_conversations.json`

结构：
```json
{
  "conversations": [
    {
      "id": "uuid",
      "title": "帮我写一篇作文",
      "messages": [...],
      "profileId": "uuid",
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    }
  ],
  "activeConversationId": "uuid"
}
```

### 5.4 agent.ts 变更

Agent 不再自己维护 `messages` 闭包，改为接收外部传入的 `messages` 数组：

```ts
export interface AgentDeps {
  doc: ...
  editor: ...
  getConfig: () => ModelConfig
  canvasEl: () => HTMLElement | null
  enableWebSearch: () => boolean
}

export interface Agent {
  // chat 方法接收 messages 数组，在内部修改它（push 消息），调用方负责持久化
  chat(messages: ChatMessage[], userInput: string | MessageContent[], callbacks?: StreamCallbacks): Promise<void>
}
```

或者保持现有接口，但 `clear()` 和 `loadHistory()` 不再需要，由 conversation store 管理。

---

## 6. CSS 变量使用规范

### 6.1 必须使用的语义变量

所有颜色必须使用以下变量，**禁止硬编码**任何颜色值：

| 用途 | 变量 |
|------|------|
| 浮窗背景 | `var(--popover)` |
| 浮窗文字 | `var(--popover-foreground)` |
| 边框 | `var(--border)` |
| 次要背景（会话项 hover、输入框背景） | `var(--secondary)` |
| 次要文字（时间戳、提示文字） | `var(--muted-foreground)` |
| 品牌色（发送按钮、激活态） | `var(--primary)` |
| 品牌色前景（按钮文字） | `var(--primary-foreground)` |
| 危险色（删除按钮） | `var(--destructive)` |
| 危险色前景 | `var(--destructive-foreground)` |
| 成功色（能力标签 ✓） | `var(--success)` |
| 焦点环 | `var(--ring)` |
| 卡片背景 | `var(--card)` |
| 前景文字 | `var(--foreground)` |

### 6.2 圆角

| 元素 | 变量 |
|------|------|
| 浮窗、对话框 | `var(--radius-compact)` |
| 按钮、输入框 | `var(--radius-button)` |
| 小标签、tag | `var(--radius-tag)` |

### 6.3 阴影

| 元素 | 变量 |
|------|------|
| 浮窗 | `var(--shadow-xl)` |
| 最小化气泡 | `var(--shadow-lg)` |
| 下拉菜单 | `var(--shadow-md)` |

### 6.4 字体

| 用途 | 变量 |
|------|------|
| 正文 | `var(--font-sans)` |
| 代码 | `var(--font-mono)` |

### 6.5 现有代码中的硬编码问题（重做时修复）

以下位置使用了硬编码颜色，重做时必须替换为语义变量：

1. `.tool-status.completed` — `rgba(0, 180, 100, 0.1)` → `rgba(var(--success-rgb), 0.1)` 或改用 `var(--success-surface)`；文字色 `rgba(0, 180, 100, 0.9)` → `var(--success)`
2. `.preview-remove` — `color: #fff` → `var(--destructive-foreground)`
3. Markdown 代码块背景 — `rgba(0, 0, 0, 0.08)` → 在浅色下可用，深色下需改为 `rgba(255, 255, 255, 0.06)`，建议用 `var(--secondary)` 或新增 `--code-bg` 变量
4. SettingsView 的 `.toast.success` / `.toast.error` — `#16a34a` / `#dc2626` → `var(--success)` / `var(--destructive)`
5. SettingsView 的 `.cap-tag.on` — `rgba(0, 180, 100, ...)` → `var(--success-surface)` + `var(--success)`
6. **所有 `var(--brand-500)` 引用** → 改为 `var(--primary)`（深色下自动变为 brand-400）

### 6.6 需要新增的 CSS 变量

如果现有变量无法满足，可在 `src/style.css` 的 `:root` 和 `.dark` 中新增：

```css
:root {
  /* 会话列表激活态左侧竖条 */
  --conversation-active-bar: var(--brand-500);
  /* 会话列表激活态背景 */
  --conversation-active-bg: var(--brand-50);
  /* 代码块背景 */
  --code-bg: rgba(0, 0, 0, 0.06);
}

.dark {
  --conversation-active-bar: var(--brand-400);
  --conversation-active-bg: rgba(46, 141, 255, 0.12);
  --code-bg: rgba(255, 255, 255, 0.06);
}
```

---

## 7. 组件拆分建议

当前 `AiFloatingWindow.vue` 有 894 行，重做后建议拆分为以下子组件：

```
src/components/ai/
├── AiFloatingWindow.vue      # 主容器（状态管理、布局编排）
├── ConversationList.vue       # 左侧会话列表
├── ConversationItem.vue       # 单个会话项
├── ChatArea.vue               # 消息区
├── MessageBubble.vue          # 单条消息气泡
├── ChatInput.vue              # 输入区（含联网/图片按钮）
├── ProfileSelector.vue        # 标题栏中的 Profile 下拉选择器
└── ConfirmDialog.vue          # 通用确认对话框（删除会话/清空消息）
```

`AiFloatingWindow.vue` 负责组装子组件 + 管理拖拽/调整大小/窗口状态。

---

## 8. 交互细节

### 8.1 新建会话

- 点击标题栏 `[+]` 或会话列表顶部的"新建会话"按钮
- 创建一个空会话，自动切换到该会话
- 如果当前会话有未完成的 AI 响应（`sending === true`），不允许新建
- 新会话使用当前 `activeProfileId`

### 8.2 切换会话

- 点击会话列表中的会话项
- 切换时保存当前会话的输入框草稿（可选，V1 可不做）
- 如果当前 `sending === true`，不允许切换
- 切换后消息区自动滚动到底部

### 8.3 删除会话

- 鼠标悬停会话项，右上角出现删除按钮
- 点击删除 → 弹出确认对话框（自定义浮层，不用原生 confirm）
- 确认后删除该会话及其消息历史
- 如果删除的是当前活跃会话，自动切换到列表中的下一个会话（或显示空状态）
- 最后一个会话不允许删除（或删除后显示空状态引导新建）

### 8.4 切换 Profile

- 点击标题栏的 Profile 下拉选择器
- 选择目标 Profile
- 切换后：
  - 当前会话的 `profileId` 更新
  - `modelCapabilities` 重新计算
  - 联网/图片按钮根据新能力显示/隐藏
  - 如果当前有正在进行的对话，等完成后再生效

### 8.5 联网搜索

- 联网搜索按钮（🌐）是会话级别的开关
- 激活时：当前会话的所有消息都会带 `web_search` 工具
- 切换会话时恢复该会话的联网搜索状态（每个会话独立保存）

### 8.6 图片上传

- 点击图片按钮（📎）→ 系统文件选择器
- 选择图片后显示缩略图预览（最多 3 张）
- 发送时图片以 base64 `image_url` 格式附加到用户消息
- 发送后清空图片列表
- 如果模型不支持 vision（`modelCapabilities.vision === false`），图片按钮不显示

### 8.7 拖拽与调整大小

保持现有逻辑：
- 标题栏可拖拽移动浮窗位置
- 右下角调整大小手柄可拖拽改变窗口尺寸
- 最小尺寸 360×450

---

## 9. 实现步骤建议

按以下顺序实现，每步完成后验证类型检查（`npx vue-tsc --noEmit`）：

1. **数据层**：新建 `src/stores/aiConversation.ts`；改造 `src/stores/settings.ts` 为多 Profile；更新 `src/ai/types.ts` 添加 Conversation 类型
2. **Rust 端**：新增 `save_ai_conversations` / `load_ai_conversations` 命令；保留旧的 `save_ai_history` / `load_ai_history` 做数据迁移
3. **Agent 层**：改造 `src/ai/agent.ts`，移除内部的 `messages` 闭包，改为接收外部 messages 数组
4. **设置页**：改造 `src/views/SettingsView.vue` 为多 Profile 管理 UI
5. **AI 浮窗**：拆分子组件，实现双栏布局（会话列表 + 对话区）
6. **Profile 选择器**：实现标题栏的下拉选择器
7. **会话交互**：新建/切换/删除会话的完整流程
8. **主题适配**：全局检查所有颜色是否使用语义变量，修复硬编码
9. **数据迁移**：首次加载时将旧的 `ai_history.json` 迁移为新的 `ai_conversations.json` 格式

---

## 10. 约束与注意事项

1. **不使用原生 `window.confirm` / `window.alert` / `window.prompt`**：Tauri 环境下原生对话框有兼容性问题，必须用自定义浮层组件
2. **Rust target 目录必须设为 `C:\temp\unidoc-target`**：避免中文路径导致编译 panic
3. **Rust 结构体使用 `#[serde(rename_all = "camelCase")]`**：与前端 TypeScript 一致
4. **Vue 递归组件需要 `defineOptions({ name: 'xxx' })`**：如果 ConversationItem 有递归需求
5. **`ref<TabInstance[]>` 等类实例需要 `markRaw()`**：防止 Vue 响应式系统 strip 私有字段
6. **保存防抖**：设置保存用 300ms 防抖，会话保存用 500ms 防抖（避免频繁 IO）
7. **HMR 可能不可靠**：结构性改动（新增组件、新增事件处理）后需要 Ctrl+R 刷新
8. **路径安全**：Rust 端文件操作必须做 canonicalize + starts_with 检查，防止路径穿越
9. **不要创建文档文件**：除非用户明确要求
10. **保持极简实用风格**：不要过度设计，UI 应简洁高效

---

## 11. 现有 CSS 变量完整参考

### Primitive 色阶

| 角色 | 色阶 |
|------|------|
| brand | `--brand-50` ~ `--brand-900`（50=#e8f2ff, 500=#007aff, 900=#00275a） |
| background | `--background-50` ~ `--background-900`（50=#ffffff, 900=#000000） |
| text | `--text-50` ~ `--text-900`（50=#f5f5f7, 900=#000000） |
| icon | `--icon-50` ~ `--icon-900` |
| success | `--state-success` #34c759, `--state-success-dark` #30d158, `--state-success-surface` #e9f9ee, `--state-success-foreground` #ffffff |
| error | `--state-error` #ff3b30, `--state-error-dark` #ff453a, `--state-error-surface` #ffecea, `--state-error-foreground` #ffffff |

### Semantic 变量（浅色 / 深色自动切换）

| 变量 | 浅色 | 深色 |
|------|------|------|
| `--background` | `--background-50` #fff | `--background-900` #000 |
| `--foreground` | `--text-800` | `--text-50` |
| `--card` | `--background-50` | `--background-800` |
| `--popover` | `--background-50` | `--background-700` |
| `--primary` | `--brand-500` | `--brand-400` |
| `--primary-foreground` | `--background-50` | `--background-900` |
| `--secondary` | `--background-200` | `--background-800` |
| `--muted` | `--background-200` | `--background-800` |
| `--muted-foreground` | `--text-400` | `--text-400` |
| `--accent` | `--background-100` | `--background-700` |
| `--destructive` | `--state-error` | `--state-error-dark` |
| `--success` | `--state-success` | `--state-success-dark` |
| `--border` | `--background-300` | `--background-700` |
| `--ring` | `--brand-500` | `--brand-400` |

### 非颜色 token

| 类型 | 变量 |
|------|------|
| 字体 | `--font-sans`, `--font-mono` |
| 圆角 | `--radius` (1.2rem), `--radius-compact` (8px), `--radius-button` (6px), `--radius-tag` (4px) |
| 阴影 | `--shadow-2xs` ~ `--shadow-2xl` |
| 布局 | `--ribbon-width` (48px), `--statusbar-height` (24px), `--titlebar-height` (32px) 等 |

---

## 附录：模型能力检测函数（已实现，直接复用）

位于 `src/stores/settings.ts` 中的 `detectCapabilities(provider, model)` 函数：

- **Vision 检测**：匹配 `gpt-4o`、`claude-3`、`qwen-vl`、`glm-4v`、`llava`、`gemini` 等已知多模态模型名，或包含 `vision`/`vl`/`4o`/`4v` 关键词
- **WebSearch 检测**：联网搜索通过 `web_search` 工具实现，只要模型支持 function calling。云端提供商（OpenAI/DeepSeek/通义/智谱）默认支持；Ollama 仅 `llama3.1+`/`qwen2`/`mistral` 等已知模型支持；custom 默认支持

重做多 Profile 后，每个 Profile 的能力标签调用此函数计算即可。
