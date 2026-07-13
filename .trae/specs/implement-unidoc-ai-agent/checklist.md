# Checklist

- [x] `src/ai/types.ts` 已创建，包含 ChatMessage / ToolDefinition / ToolCall / ModelConfig / AgentContext 类型定义
- [x] `src/ai/model.ts` 的 `streamChat` 使用原生 fetch，逐 chunk 解析 SSE 并通过 `onDelta` 回调输出文本
- [x] `src/ai/model.ts` 正确解析 `tool_calls` 增量（按 index 聚合 arguments 片段）
- [x] `src/ai/model.ts` 网络错误/HTTP 非 200/解析失败抛出友好的 Error
- [x] `src/ai/tools.ts` 注册了 13 个工具（insert_block/update_block/delete_block/move_block/convert_block/get_document/get_outline/search_files/read_file/write_file/create_file/list_dir/switch_tab）
- [x] `src/ai/tools.ts` 每个工具的 execute 正确映射到 document store / editor store / vault.ts 的方法
- [x] `src/ai/tools.ts` 的 `getToolDefinitions()` 返回 OpenAI Function Calling 兼容格式
- [x] `src/ai/context.ts` 用 `getBoundingClientRect()` 计算视口可见块（比例 > 30%）
- [x] `src/ai/context.ts` 按块类型格式化输出可见块摘要
- [x] `src/ai/context.ts` 包含当前文档名、可见块范围、选中块、选中文本
- [x] `src/ai/context.ts` 滚动防抖 200ms（`useScrollContext` composable）
- [x] `src/ai/agent.ts` 实现多轮循环（构建上下文 → 调用模型 → 检测工具 → 执行 → 回环）
- [x] `src/ai/agent.ts` 设置最大循环 5 次防死循环
- [x] `src/ai/agent.ts` 工具异常以 `{ ok: false, error }` 追加为 tool 消息
- [x] `src/ai/agent.ts` 维护内部对话历史，`clear()` 可清空
- [x] `src/stores/settings.ts` 暴露 provider/apiKey/apiUrl/model/temperature/maxTokens 字段
- [x] `src/stores/settings.ts` 包含 6 个预设（OpenAI/DeepSeek/通义/智谱/Ollama/自定义）及默认 apiUrl/model
- [x] `src/stores/settings.ts` 的 `applyPreset(provider)` 自动填入默认值
- [x] `src/stores/settings.ts` 的 `save()` 在 Tauri 环境调 `save_settings`，Web 降级 localStorage
- [x] `src/stores/settings.ts` 的 `load()` 在 Tauri 环境调 `load_settings`，Web 降级 localStorage
- [x] `src/stores/settings.ts` 的 `testConnection()` 调用 `model.chat()` 发送 ping 并返回结果
- [x] `src-tauri/Cargo.toml` 添加 `dirs` crate 依赖（v5）
- [x] `src-tauri/src/lib.rs` 实现 `save_settings(json: String)`：写入 `~/.unidoc/settings.json`（自动创建目录）
- [x] `src-tauri/src/lib.rs` 实现 `load_settings()`：读取配置文件，不存在返回空字符串
- [x] `invoke_handler` 已注册 `save_settings` 和 `load_settings`
- [x] `AiFloatingWindow.vue` 的 `execute()` 已替换为真实 `agent.chat()` 调用
- [x] `AiFloatingWindow.vue` 流式渲染（onDelta 实时更新最后一条 assistant 消息）
- [x] `AiFloatingWindow.vue` 发送期间禁用输入框和发送按钮
- [x] `AiFloatingWindow.vue` 工具调用过程展示（调用工具系统消息 + 结果摘要系统消息）
- [x] `AiFloatingWindow.vue` 新增清空对话按钮
- [x] `AiFloatingWindow.vue` 错误气泡红色样式 + 系统消息灰色小字样式
- [x] `AiFloatingWindow.vue` 获取 canvas DOM 引用（`document.querySelector('.editor-canvas')`）传给 `buildContext`
- [x] `SettingsView.vue` 新增 AI 配置卡片（provider/apiKey/apiUrl/model/temperature/maxTokens）
- [x] `SettingsView.vue` apiKey 密码框支持显示/隐藏切换
- [x] `SettingsView.vue` 修改字段触发 `settings.save()`（300ms 防抖）
- [x] `SettingsView.vue` 选择 provider 触发 `applyPreset`
- [x] `SettingsView.vue` 测试连接按钮调用 `settings.testConnection()` 并显示成功/失败 toast
- [x] `App.vue` 启动时调用 `settings.load()` 加载本地配置
- [x] TypeScript 类型检查通过（`vue-tsc --noEmit` 退出码 0）

# 端到端测试（需用户运行时验证,以下为代码层验证说明）

- [ ] 端到端测试：流式对话正常 — 代码层验证：`model.ts` 的 streamChat 正确解析 SSE,`AiFloatingWindow.vue` 的 onDelta 实时更新 reactive assistant 消息
- [ ] 端到端测试：13 个工具全部可被 AI 正确调用 — 代码层验证：`tools.ts` 中每个工具的 execute 已正确映射到 document/editor/vault 方法,类型检查通过
- [ ] 端到端测试：视口可见块计算准确 — 代码层验证：`context.ts` 的 buildContext 用 getBoundingClientRect + visibleRatio > 0.3 过滤,符合 spec
- [ ] 端到端测试：配置修改后刷新应用仍保留 — 代码层验证：`save_settings`/`load_settings` Rust 命令实现正确,App.vue 启动时调用 load
- [ ] 端到端测试：错误 API Key 时有友好错误提示 — 代码层验证：`model.ts` HTTP 非 200 抛 Error,`agent.ts` catch 后调 onError,`AiFloatingWindow.vue` 推入 error 气泡

> 注：以上 5 项端到端测试需用户启动 Tauri 应用并配置真实 API Key 后人工执行,代码层架构已全部就绪并通过类型检查。
