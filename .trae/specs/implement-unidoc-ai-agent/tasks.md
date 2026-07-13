# Tasks

- [x] Task 1: 创建 AI 类型定义 `src/ai/types.ts`
  - [x] SubTask 1.1: 定义 `ChatMessage`（role: system/user/assistant/tool, content, tool_calls, tool_call_id）
  - [x] SubTask 1.2: 定义 `ToolDefinition`（name, description, parameters: JSON Schema, execute 函数签名）
  - [x] SubTask 1.3: 定义 `ToolCall`（id, function: { name, arguments }）
  - [x] SubTask 1.4: 定义 `ModelConfig`（apiKey, apiUrl, model, temperature, maxTokens）
  - [x] SubTask 1.5: 定义 `AgentContext`（documentName, visibleBlocks, selectedBlock, selectedText）

- [x] Task 2: 实现模型调用层 `src/ai/model.ts`
  - [x] SubTask 2.1: 实现 `streamChat(messages, tools, config, onDelta)`：原生 fetch POST 到 `${apiUrl}/chat/completions`，`stream: true`，逐 chunk 解析 SSE
  - [x] SubTask 2.2: 实现 `tool_calls` 增量解析（按 `index` 聚合 `function.arguments` 片段）
  - [x] SubTask 2.3: 实现 `chat()` 非流式降级接口（供测试连接用）
  - [x] SubTask 2.4: 错误处理：网络错误/HTTP 非 200/解析失败抛友好 Error

- [x] Task 3: 实现工具注册与执行 `src/ai/tools.ts`
  - [x] SubTask 3.1: 定义工具 JSON Schema（insert_block/update_block/delete_block/move_block/convert_block/get_document/get_outline/search_files/read_file/write_file/create_file/list_dir/switch_tab）
  - [x] SubTask 3.2: 实现 `executeTool(name, args, doc, editor)`，每个工具调用对应 store/vault 方法并返回 `{ ok, data/error }`
  - [x] SubTask 3.3: 实现 `getToolDefinitions()` 返回 OpenAI Function Calling 格式的工具定义数组

- [x] Task 4: 实现上下文构建 `src/ai/context.ts`
  - [x] SubTask 4.1: 实现 `buildContext(doc, editor, canvasEl)`：遍历 `[data-block-id]` DOM 节点，用 `getBoundingClientRect()` 计算与画布视口交集比例 > 30% 的块
  - [x] SubTask 4.2: 按块类型格式化输出可见块摘要（heading 含 level、list 含 items 文本、table 含行列数等）
  - [x] SubTask 4.3: 包含当前文档名、可见块范围、选中块、选中文本（`window.getSelection()`）
  - [x] SubTask 4.4: 实现 `useScrollContext` composable 提供 200ms 防抖的可见块刷新

- [x] Task 5: 实现 Agent 循环 `src/ai/agent.ts`
  - [x] SubTask 5.1: 实现 `createAgent()` 工厂，返回 `{ chat, clear }` 接口
  - [x] SubTask 5.2: 实现 `chat(userInput, context, onDelta, onToolCall)`：构建 messages → 调用 `streamChat` → 检测 tool_calls → 执行 → 追加 `role: "tool"` 消息 → 回环
  - [x] SubTask 5.3: 设置最大循环 5 次防死循环，超出抛错
  - [x] SubTask 5.4: 工具异常捕获：将 `{ ok: false, error }` 作为 tool 消息追加，让模型处理
  - [x] SubTask 5.5: 维护内部对话历史（messages 数组），`clear()` 清空

- [x] Task 6: 实现 settings store `src/stores/settings.ts`
  - [x] SubTask 6.1: 定义 state：provider/apiKey/apiUrl/model/temperature/maxTokens
  - [x] SubTask 6.2: 定义预设列表（OpenAI: `https://api.openai.com/v1` + `gpt-4o-mini`；DeepSeek: `https://api.deepseek.com/v1` + `deepseek-chat`；通义: `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen-plus`；智谱: `https://open.bigmodel.cn/api/paas/v4` + `glm-4-flash`；Ollama: `http://localhost:11434/v1` + `llama3`；自定义：全空）
  - [x] SubTask 6.3: 实现 `applyPreset(provider)` 自动填默认 apiUrl/model
  - [x] SubTask 6.4: 实现 `save()`（300ms 防抖）：Tauri 调 `save_settings`，Web 降级 localStorage
  - [x] SubTask 6.5: 实现 `load()`：Tauri 调 `load_settings`，Web 降级 localStorage，无配置用默认值
  - [x] SubTask 6.6: 实现 `testConnection()`：调用 `model.chat()` 发送 "ping" 消息，返回成功/失败

- [x] Task 7: 新增 Tauri 命令 `save_settings` / `load_settings`
  - [x] SubTask 7.1: 在 `src-tauri/Cargo.toml` 添加 `dirs` crate 依赖（获取 home dir）
  - [x] SubTask 7.2: 实现 `save_settings(json: String)`：写入 `~/.unidoc/settings.json`（自动创建 `.unidoc` 目录）
  - [x] SubTask 7.3: 实现 `load_settings()`：读取 `~/.unidoc/settings.json`，不存在返回空字符串
  - [x] SubTask 7.4: 在 `invoke_handler` 注册两个新命令

- [x] Task 8: 改造 `AiFloatingWindow.vue` 接入真实 Agent
  - [x] SubTask 8.1: 替换 `execute()` 占位：调用 `agent.chat(input, context, onDelta, onToolCall)`，`onDelta` 实时更新最后一条 assistant 消息
  - [x] SubTask 8.2: 发送期间禁用输入框和发送按钮，显示 loading 指示
  - [x] SubTask 8.3: 工具调用过程展示：`onToolCall` 回调在消息列表插入"调用工具: {name}"和"结果: {摘要}"系统消息
  - [x] SubTask 8.4: 新增清空对话按钮（标题栏或输入区，调用 `agent.clear()` 和清空 `messages`）
  - [x] SubTask 8.5: 错误气泡样式（红色背景），系统消息样式（灰色小字、居中）
  - [x] SubTask 8.6: 获取 canvas DOM 元素引用（通过 props 或 inject）传给 `buildContext`

- [x] Task 9: 改造 `SettingsView.vue` 新增 AI 配置面板
  - [x] SubTask 9.1: 在主题卡片下方新增"AI 配置"卡片，字段：provider 下拉（含预设）、apiKey 密码框（含显示/隐藏切换）、apiUrl、model、temperature 滑块、maxTokens 数字输入
  - [x] SubTask 9.2: 修改任意字段触发 `settings.save()`（300ms 防抖）
  - [x] SubTask 9.3: 选择 provider 触发 `applyPreset(provider)`
  - [x] SubTask 9.4: "测试连接"按钮：调用 `settings.testConnection()`，显示成功（绿色 toast）/失败（红色 toast + 错误信息）

- [x] Task 10: 验证与调试
  - [x] SubTask 10.1: TypeScript 类型检查通过（`vue-tsc --noEmit` 退出码 0）
  - [x] SubTask 10.2: 修复 agent.ts 中未使用的 ToolCall 导入
  - [x] SubTask 10.3: 修复 AiFloatingWindow.vue 中未使用的 args 参数
  - [x] SubTask 10.4: 补充 context.ts 的 useScrollContext composable（SubTask 4.4）
  - [x] SubTask 10.5: App.vue 启动时调用 settings.load() 加载本地配置
  - [ ] SubTask 10.6: 端到端测试（需用户运行 Tauri 应用 + 真实 API Key 后人工执行）

# Task Dependencies
- Task 2 (model) 依赖 Task 1 (types)
- Task 3 (tools) 依赖 Task 1 (types)
- Task 4 (context) 依赖 Task 1 (types)
- Task 5 (agent) 依赖 Task 2、Task 3、Task 4
- Task 6 (settings store) 依赖 Task 1 (types) 和 Task 7 (Tauri 命令)
- Task 8 (AiFloatingWindow 改造) 依赖 Task 5、Task 6、Task 4
- Task 9 (SettingsView 改造) 依赖 Task 6
- Task 10 (验证) 依赖 Task 7、Task 8、Task 9
- 可并行：Task 1 + Task 7（无依赖）
- 可并行：Task 2 + Task 3 + Task 4（均依赖 Task 1）
