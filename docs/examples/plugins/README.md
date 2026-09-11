# UniDoc 插件示例

> **想自己写插件？** 完整开发指南见 [docs/PLUGIN-DEV.md](../../docs/PLUGIN-DEV.md)。

本目录包含 5 个示例插件，展示了 UniDoc 插件系统的核心能力。

## 目录结构

```
examples/plugins/
├── callout-block/    # 自定义 Callout 提示块
├── word-count/       # 字数统计
├── insert-date/      # 插入日期/时间
├── timer-block/      # 倒计时/正计时块
└── theme-color/      # 主题色切换
```

## 安装方法

将需要的插件文件夹整个拷贝到你的 vault 目录下的 `.unidoc/plugins/` 中：

```
你的 Vault/
├── .unidoc/
│   └── plugins/
│       ├── callout-block/   ← 拷贝到这里
│       ├── word-count/
│       └── insert-date/
├── 文档1.md
└── 文档2.md
```

重启 UniDoc 或在「设置 → 插件」中点击「重新加载插件」即可生效。

## 插件说明

### 1. callout-block — 自定义 Callout 提示块

**能力**：`registerBlockType`（注册自定义块类型）

添加类似 Obsidian 的 Callout 块，支持 4 种类型：
- ℹ️ info（蓝色）
- ⚠️ warning（黄色）
- ✅ success（绿色）
- ❌ error（红色）

**使用**：
- 点击块左侧的图标可以循环切换类型
- 直接在块中输入内容
- 支持 Markdown 序列化（`> [!INFO]\n> 内容`）

### 2. word-count — 字数统计

**能力**：`addCommand`（注册命令 + 快捷键）+ `editor.getBlocks()`（读取编辑器内容）

按 **Ctrl+Shift+C** 弹出当前文档的统计信息：
- 字符数（含/不含空格）
- 中英文词数
- 段落数
- 块数

### 3. insert-date — 插入日期/时间

**能力**：`addCommand` + `registerSettingsPanel` + `saveData/loadData` + `editor.updateBlock`

快捷键：
- **Ctrl+Shift+D** — 插入日期
- **Ctrl+Shift+T** — 插入时间

设置：在「设置 → 插件」底部的「插入日期设置」中选择日期格式（6 种预设），设置会自动保存。

### 4. timer-block — 倒计时/正计时块

**能力**：`registerBlockType`（自定义块 + 复杂状态 + 定时器）

支持两种模式：
- ⏱ **倒计时**：预设 5/15/25/45/60 分钟，到时自动提示
- ⏲ **正计时**：从零开始计时

特性：状态持久化、进度指示、完成时 Web Audio 提示音。

### 5. theme-color — 主题色切换

**能力**：`registerSettingsPanel` + `saveData/loadData` + CSS 变量注入

- 10 种预设色板（海洋蓝、翠绿、紫罗兰、珊瑚橙等）
- 支持自定义颜色（颜色选择器 + HEX 输入）
- 基于主色自动生成 50→900 完整色阶
- 深浅模式自动适配

---

## 插件开发文档

完整的插件开发指南（含 API 参考、权限系统、调试技巧等）见：
**[docs/PLUGIN-DEV.md](../../docs/PLUGIN-DEV.md)**
