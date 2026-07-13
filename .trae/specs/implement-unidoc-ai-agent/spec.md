# UniDoc AI Agent 实现规格

## Why
当前 `AiFloatingWindow.vue` 仅是 M1 占位（执行指令只清空输入框、不调用真实模型）。需要按 PRD 实现一套自研 Agent（约 200 行 agent + 150 行 model，零外部依赖），让用户用自然语言直接操作 UniDoc 的全部功能，并支持任意 OpenAI 兼容接口与本地 Ollama。

## What Changes
- 新增 `src/ai/types.ts`：AI 模块类型定义（ChatMessage / ToolDefinition / ToolCall / FunctionCall 等）。
- 新增 `src/ai/model.ts`：纯 fetch 实现的 OpenAI 兼容客户端，支持 SSE 流式解析与 Function Calling，零第三方依赖。
- 新增 `src/ai/tools.ts`：注册 13 个工具并封装其执行逻辑，映射到现有 `document` / `editor` / `vault` 模块方法。
- 新增 `src/ai/context.ts`：构建上下文（当前文档名、视口可见块、选中块、选中文本），滚动防抖 200ms。
- 新增 `src/ai/agent.ts`：Agent 多轮对话循环（构建上下文 → 调用模型 → 检测工具调用 → 执行工具 → 追加结果回环），最多 5 轮防死循环。
- 新增 `src/stores/settings.ts`：AI 配置 Pinia store，包含 provider/apiKey/apiUrl/model/temperature/maxTokens，预设 OpenAI/DeepSeek/通义/智谱/Ollama/自定义。
- 新增 Tauri 命令 `save_settings`/`load_settings`，写入 `~/.unidoc/settings.json`；Web 开发环境降级到 localStorage。
- 改造 `src/components/layout/AiFloatingWindow.vue`：
  - 接入真实 `agent.ts`，替换 M1 占位逻辑。
  - 流式渲染（打字机效果）。
  - 多轮对话历史持久到内存（store 内）。
  - 工具调用过程展示（消息列表中显示"调用工具: xxx"）。
  - 清空对话按钮。
- 改造 `src/views/SettingsView.vue`：新增 AI 配置面板卡片（provider 预设选择、apiKey、apiUrl、model、temperature、maxTokens、测试连接按钮）。
- **BREAKING**：`AiFloatingWindow.vue` 中的 `execute()` 占位逻辑被替换为真实 Agent 调用。

## Impact
- Affected specs: 无（首次为 AI Agent 模块编写 spec）。
- Affected code:
  - 新增文件：`src/ai/types.ts`、`src/ai/model.ts`、`src/ai/tools.ts`、`src/ai/context.ts`、`src/ai/agent.ts`、`src/stores/settings.ts`
  - 修改文件：`src/components/layout/AiFloatingWindow.vue`、`src/views/SettingsView.vue`、`src-tauri/src/lib.rs`（新增 2 个 command）、`src-tauri/Cargo.toml`（如需 `dirs` crate 获取 home 路径）
  - 依赖文件：现有 `src/stores/document.ts`、`src/stores/editor.ts`、`src/core/vault/vault.ts`（不修改，仅被 tools.ts 调用）

## ADDED Requirements

### Requirement: AI 模型调用层（model.ts）
系统 SHALL 提供纯 fetch 实现的 OpenAI 兼容客户端，零第三方依赖。

#### Scenario: 流式响应
- **WHEN** 调用 `streamChat(messages, tools, config, onDelta)`
- **THEN** 使用 `fetch` 发起 POST 到 `${apiUrl}/chat/completions`，`stream: true`
- **AND** 逐 chunk 解析 SSE，提取 `delta.content` 调用 `onDelta(text)`
- **AND** 解析 `tool_calls` 增量，返回完整的 `ToolCall[]`

#### Scenario: 非流式降级
- **WHEN** `streamChat` 失败且配置允许降级
- **THEN** 调用 `chat()` 非流式接口，一次性返回完整响应

#### Scenario: Function Calling
- **WHEN** 模型返回 `finish_reason: "tool_calls"`
- **THEN** 返回 `tool_calls` 数组供 Agent 执行
- **AND** 不返回 `content`（或返回空字符串）

### Requirement: Agent 工具调用层（tools.ts）
系统 SHALL 注册 13 个工具，每个工具映射到现有 store/vault 方法，包含 `name`/`description`/`parameters`(JSON Schema)/`execute`。

#### Scenario: 文档编辑工具
- **WHEN** 模型调用 `insert_block` / `update_block` / `delete_block` / `move_block` / `convert_block`
- **THEN** 映射到 `useDocumentStore` 对应方法
- **AND** 返回 `{ ok: true, blockId }` 或 `{ ok: false, error }`

#### Scenario: 文档分析工具
- **WHEN** 模型调用 `get_document` / `get_outline`
- **THEN** 返回当前 active tab 的 Markdown 全文 / 大纲数组

#### Scenario: 文件管理工具
- **WHEN** 模型调用 `search_files` / `read_file` / `write_file` / `create_file` / `list_dir`
- **THEN** 映射到 `vault.ts` 的对应函数（`findFileByName`/`readVaultFile`/`writeVaultFile`/`createVaultFile`/`readVaultTree`）
- **AND** `search_files` 在 `vaultTree` 中按文件名模糊匹配返回候选列表

#### Scenario: 标签切换工具
- **WHEN** 模型调用 `switch_tab`
- **THEN** 调用 `doc.switchTab(tabId)`，返回操作结果

### Requirement: 上下文构建（context.ts）
系统 SHALL 在每次 Agent 调用前构建上下文，包含当前文档名、视口可见块、选中块、选中文本。

#### Scenario: 视口可见块计算
- **WHEN** 调用 `buildContext(doc, editor, canvasEl)`
- **THEN** 遍历所有块 DOM 节点（`[data-block-id]`）
- **AND** 用 `getBoundingClientRect()` 计算与画布视口的交集比例
- **AND** 仅保留可见比例 > 30% 的块
- **AND** 按块类型格式化输出（heading 含 level、list 含 items、table 含行列数等）

#### Scenario: 滚动防抖
- **WHEN** 画布滚动事件触发
- **THEN** 200ms 防抖后才重新计算可见块
- **AND** 防抖期内重复滚动重置计时器

### Requirement: Agent 多轮循环（agent.ts）
系统 SHALL 实现"用户输入 → 构建上下文 → 调用模型 → 检测工具调用 → 执行工具 → 追加结果回环"循环。

#### Scenario: 单轮无工具
- **WHEN** 模型返回纯文本（无 tool_calls）
- **THEN** 流式输出到 UI，结束循环

#### Scenario: 多轮工具调用
- **WHEN** 模型返回 tool_calls
- **THEN** 依次执行每个工具，将结果以 `role: "tool"` 消息追加到 messages
- **AND** 继续调用模型（不流式输出工具调用轮次的内容）
- **AND** 设置最大循环次数 5 防死循环，超出后返回错误提示

#### Scenario: 错误处理
- **WHEN** 模型调用 API 失败（网络/鉴权/超时）
- **THEN** 返回友好错误提示到 UI，不抛出未捕获异常
- **WHEN** 工具执行抛异常
- **THEN** 将异常信息以 `{ ok: false, error: e.message }` 形式追加到 messages，让模型自行处理

### Requirement: AI 配置管理（settings store + Tauri 持久化）
系统 SHALL 提供 Pinia store 管理 AI 配置，并通过 Tauri 命令持久化到本地 `~/.unidoc/settings.json`。

#### Scenario: 配置字段
- **WHEN** 访问 `useSettingsStore()`
- **THEN** 暴露字段：`provider` / `apiKey` / `apiUrl` / `model` / `temperature` / `maxTokens`

#### Scenario: 预设
- **WHEN** 用户选择预设 provider（OpenAI / DeepSeek / 通义 / 智谱 / Ollama / 自定义）
- **THEN** 自动填入默认 `apiUrl` 和 `model`，apiKey 留空
- **AND** 自定义预设允许用户自由填写所有字段

#### Scenario: 持久化
- **WHEN** 配置变更后调用 `save()`
- **THEN** Tauri 环境调用 `save_settings` 命令写入 `~/.unidoc/settings.json`
- **AND** Web 开发环境降级到 `localStorage`

#### Scenario: 加载
- **WHEN** 应用启动时调用 `load()`
- **THEN** 读取本地配置，无配置则使用默认值（provider: 'custom', temperature: 0.7, maxTokens: 2048）

### Requirement: AI 浮窗 UI 接入真实 Agent
系统 SHALL 改造 `AiFloatingWindow.vue` 接入真实 Agent。

#### Scenario: 发送消息
- **WHEN** 用户输入文本并按 Enter 或点击发送
- **THEN** 调用 `agent.chat(input, context)`，传入 `onDelta` 回调实时更新最后一条 assistant 消息
- **AND** 发送期间禁用输入框和发送按钮

#### Scenario: 工具调用过程展示
- **WHEN** Agent 执行工具调用
- **THEN** 在消息列表中插入"调用工具: {toolName}"系统消息
- **AND** 工具执行成功后插入"结果: {简要摘要}"系统消息

#### Scenario: 清空对话
- **WHEN** 用户点击清空按钮
- **THEN** 清空 `messages` 数组并重置 Agent 内部状态

#### Scenario: 错误展示
- **WHEN** Agent 返回错误
- **THEN** 在消息列表中插入红色错误气泡

### Requirement: 设置页 AI 配置面板
系统 SHALL 在 `SettingsView.vue` 新增 AI 配置卡片。

#### Scenario: 表单字段
- **WHEN** 进入设置页
- **THEN** 显示：provider 下拉（含预设）、apiKey 密码框、apiUrl 输入、model 输入、temperature 滑块（0-2，步进 0.1）、maxTokens 数字输入
- **AND** 修改任意字段自动触发 `save()`（300ms 防抖）

#### Scenario: 测试连接
- **WHEN** 点击"测试连接"按钮
- **THEN** 发送一条 `ping` 消息到当前配置的 API
- **AND** 返回成功（绿色提示）或失败原因（红色提示）

## MODIFIED Requirements

### Requirement: AiFloatingWindow.vue 浮窗
原 M1 占位逻辑（`execute()` 只清空输入框）替换为真实 Agent 调用。保留原有：拖拽、最小化、关闭、模式 Tab、快捷指令 chips。新增：流式渲染、工具调用过程展示、清空对话按钮、错误气泡。
