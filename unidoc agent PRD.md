# UniDoc AI Agent PRD

---

## 一、目标功能

### 核心目标

AI 能直接操作 UniDoc 的全部功能，用户用自然语言就能完成文档编辑、文件管理等操作。

### 具体功能

**1. AI 对话浮窗**

- 可拖拽、最小化、关闭
- 流式响应（打字机效果）
- 支持多轮对话

**2. 智能上下文感知**

- 自动获取当前打开的文档
- 自动获取屏幕可见的所有块（视口内）
- 用户说"这个/这里"时，AI 知道指的是什么

**3. 工具调用（Agent 能力）**

- 文档编辑：插入/修改/删除/移动/转换块
- 文件管理：读/写/创建/搜索文件
- 文档分析：获取全文/大纲/统计

**4. 交互模式**

- 自由对话：用户在小窗口直接输入，AI 自动调用工具

**5. 用户自配置 API**

- 支持任意 OpenAI 兼容接口（OpenAI/DeepSeek/通义/智谱等）
- 支持本地 Ollama
- 可配置 API Key、地址、模型、温度
- 配置保存在本地，不上传

---

## 二、实现方法

### 技术架构

```plaintext
UI层: AiFloatingWindow.vue (浮窗组件)
    ↓
Agent层: agent.ts (自研，~200行)
    ├── 上下文构建 (context.ts)
    ├── 工具注册与调用 (tools.ts)
    └── 多轮对话循环
    ↓
模型层: model.ts (纯 fetch，零框架依赖，~150行)
    ├── OpenAI 兼容 API 调用
    ├── 流式响应解析 (SSE)
    └── Function Calling 处理
    ↓
配置层: settings store + 本地 JSON
    ↓
核心层: DocumentStore / EditorStore / Vault (现有)
```

### 文件结构

```plaintext
src/
├── ai/
│   ├── agent.ts          # Agent 编排逻辑
│   ├── model.ts          # 模型调用 (纯 fetch)
│   ├── tools.ts          # 工具定义 + 执行
│   ├── context.ts        # 上下文构建 (视口/选区)
│   └── types.ts          # 类型定义
├── stores/
│   └── settings.ts       # AI 配置管理
└── components/
    └── ai/
        └── AiFloating.vue  # AI 浮窗组件
```

### 关键实现

**1. 模型调用 (model.ts)**

- 原生 fetch 调用 OpenAI 兼容接口
- SSE 流式解析，支持打字机效果
- Function Calling 解析（工具调用）
- 零外部依赖

**2. 工具列表 (tools.ts)**

| 工具 | 功能 | 映射 |
| :--- | :--- | :--- |
| `get_document` | 获取当前文档全文 | `doc.exportMarkdown()` |
| `get_outline` | 获取大纲 | `doc.outline` |
| `insert_block` | 插入块 | `doc.insertBlockAfter()` |
| `update_block` | 修改块 | `doc.updateBlock()` |
| `delete_block` | 删除块 | `doc.removeBlock()` |
| `move_block` | 移动块 | `doc.moveBlockUp/Down()` |
| `convert_block` | 转换块类型 | `doc.convertBlock()` |
| `search_files` | 搜索 vault 文件 | `doc.searchVault()` |
| `read_file` | 读取文件 | `readVaultFile()` |
| `write_file` | 写入文件 | `writeVaultFile()` |
| `create_file` | 新建文件 | `createVaultFile()` |
| `list_dir` | 列出目录 | `readVaultTree()` |
| `switch_tab` | 切换标签 | `doc.switchTab()` |

**3. 上下文构建 (context.ts)**

- 计算视口内可见的块（`getBoundingClientRect` + 可见比例 > 30%）
- 包含：当前文档名、可见块范围、选中块、选中文本
- 可见块内容格式化输出（按块类型）
- 滚动防抖更新（200ms）

**4. Agent 循环 (agent.ts)**

```plaintext
用户输入 → 构建上下文 → 调用模型 → 检测工具调用 → 执行工具
    ↑                                                    ↓
    └──── 追加工具结果，继续调用模型（直到无工具调用） ────┘
```

**5. AI 配置 (settings store)**

- 配置项：provider / apiKey / apiUrl / model / temperature / maxTokens
- 预设：OpenAI / Anthropic / Ollama / 自定义
- 存储：Tauri 端写本地 JSON 文件（`~/.unidoc/settings.json`）
- Web 开发环境降级到 localStorage

**6. AI 浮窗 (AiFloating.vue)**

- 可拖拽（按住标题栏）
- 可最小化（缩为右下角气泡）
- 消息列表 + 输入框
- 快捷指令按钮
- 流式渲染

### 开发步骤

1. **模型层**：实现 `model.ts`，能调通 API + 流式 + Function Calling（2天）
2. **工具层**：实现 `tools.ts`，封装 8-10 个核心工具（2天）
3. **Agent层**：实现 `agent.ts`，对话循环 + 工具调用（1天）
4. **上下文**：实现 `context.ts`，视口可见块计算（1天）
5. **配置层**：实现 settings store + 设置页 AI 面板（2天）
6. **UI层**：实现 AI 浮窗组件（3天）
7. **选区操作**：右键菜单 + 选区模式快捷指令（1天）

总计：约 12 天