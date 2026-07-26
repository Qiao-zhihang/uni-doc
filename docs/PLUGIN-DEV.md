# UniDoc 插件开发指南

> 本文档面向希望为 UniDoc 开发第三方插件的开发者。阅读后你将了解插件的目录结构、API、权限系统以及如何调试、打包和发布你的第一个插件。

---

## 目录

1. [快速开始](#1-快速开始)
2. [插件结构](#2-插件结构)
3. [manifest.json 字段详解](#3-manifestjson-字段详解)
4. [Plugin 基类](#4-plugin-基类)
5. [权限系统](#5-权限系统)
6. [完整 API 参考](#6-完整-api-参考)
7. [扩展点详解](#7-扩展点详解)
8. [事件系统](#8-事件系统)
9. [数据持久化](#9-数据持久化)
10. [调试与排错](#10-调试与排错)
11. [最佳实践](#11-最佳实践)
12. [示例插件](#12-示例插件)

---

## 1. 快速开始

### 1.1 最小插件

在你的 Vault 下创建 `.unidoc/plugins/hello-world/` 目录，包含两个文件：

```
你的 Vault/
└── .unidoc/
│   └── plugins/
│       └── hello-world/
│           ├── manifest.json
│           └── index.js
```

**manifest.json**
```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "我的第一个 UniDoc 插件",
  "author": "你的名字",
  "main": "index.js",
  "permissions": ["ui:dialog"]
}
```

**index.js**
```javascript
const { Plugin } = window.__unidoc

class HelloWorldPlugin extends Plugin {
  onload() {
    this.api.addCommand({
      id: 'say-hello',
      name: '打招呼',
      hotkey: 'Ctrl+Shift+H',
      callback: () => {
        this.api.ui.notify({ message: 'Hello, UniDoc!' })
      },
    })
  }
}

export default HelloWorldPlugin
```

### 1.2 加载插件

1. 将插件文件夹放入 `.unidoc/plugins/`
2. 打开 UniDoc，进入「设置 → 插件」
3. 在列表中找到你的插件，确保开关已打开
4. 按 **Ctrl+Shift+P** 打开命令面板，输入「打招呼」即可看到你的命令
5. 按 **Ctrl+Shift+H** 也可直接触发

---

## 2. 插件结构

每个插件是一个独立的文件夹，必须包含至少两个文件：

```
plugin-id/
├── manifest.json    # 插件清单（必填）
├── index.js     # 主入口文件（必填，文件名可在 manifest 中指定）
└── assets/      # 可选：静态资源（图片、样式等）
```

### 2.1 命名规则

- **插件 ID**（`manifest.id`）：全局唯一，建议使用小写字母 + 连字符，如 `word-count`、`theme-color`
- **文件夹名**：建议与 ID 一致，但不强制
- **主入口文件**：默认 `index.js`，可在 manifest.json 的 `main` 字段自定义

### 2.2 JavaScript 规范

- 插件代码运行在主渲染进程中，**不是**沙箱环境，可以访问完整的 DOM API、`window`、`document`
- 支持 ES Module（`export default`）
- 运行时通过动态 `import()` 加载，无需编译，不支持 `require()`
- Vue 运行时通过 `window.__unidoc.Vue` 或 `this.api.vue` 暴露，**不要**自己打包 Vue

---

## 3. manifest.json 字段详解

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "插件功能的一句话描述",
  "author": "作者名",
  "minAppVersion": "3.5.0",
  "main": "index.js",
  "permissions": ["editor:read", "ui:dialog"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | ✅ | 插件唯一标识，仅使用小写字母、数字、连字符 |
| `name` | `string` | ✅ | 插件显示名，用户可见 |
| `version` | `string` | ✅ | 语义化版本号（如 `1.0.0`） |
| `description` | `string` | ✅ | 简短功能描述 |
| `author` | `string` | ✅ | 作者名 |
| `minAppVersion` | `string` | ❌ | 最低支持的 UniDoc 版本 |
| `main` | `string` | ✅ | 主入口文件名，相对于插件目录 |
| `permissions` | `string[]` | ❌ | 声明需要的权限列表，见[权限系统](#5-权限系统) |

> **注意**：`id` 是插件的唯一身份标识，一旦发布不要修改。所有注册的命令、块类型、设置面板都会自动加上 `id:` 前缀避免冲突。

---

## 4. Plugin 基类

所有插件必须继承 `Plugin` 抽象类：

```javascript
const { Plugin } = window.__unidoc

class MyPlugin extends Plugin {
  // 构造函数不可重写，通过 this.api 访问所有能力
  onload() {
    // 插件加载时调用，在这里注册命令、块类型、事件监听等
  }

  onunload() {
    // 可选：插件卸载时调用，用于清理资源（定时器、事件监听等）
    // 注意：注册的命令、块类型、设置面板会被自动清理，无需手动移除
  }
}

export default MyPlugin
```

### 4.1 生命周期

| 阶段 | 触发时机 | 用途 |
|---|---|---|
| `onload()` | 插件被启用且加载完成后 | 注册扩展点、初始化状态 |
| `onunload()` | 插件被禁用或应用关闭时 | 清理定时器、DOM 节点、网络连接等 |

> 插件卸载时，以下资源会**自动清理**：
- 已注册的命令（`addCommand`）
- 已注册的块类型（`registerBlockType`）
- 已注册的设置面板（`registerSettingsPanel`）

以下资源**需要手动清理**：
- `setInterval` / `setTimeout`
- `addEventListener`（非插件 API 的事件）
- 手动插入的 DOM 节点
- 网络连接、WebSocket 等

---

## 5. 权限系统

UniDoc 采用声明式权限模型。插件在 `manifest.json` 的 `permissions` 字段声明所需权限，用户可在设置中查看。

> 当前版本权限为声明性质（帮助用户了解插件行为，不做强制拦截）。

### 5.1 权限列表

| 权限 | 说明 |
|---|---|
| `file-system:read` | 读取 Vault 中的文件 |
| `file-system:write` | 写入文件到 Vault |
| `editor:read` | 读取编辑器内容（块、选区） |
| `editor:modify-blocks` | 修改现有块的内容 |
| `editor:insert-blocks` | 插入新块 |
| `editor:delete-blocks` | 删除块 |
| `ui:dialog` | 弹出对话框、通知 |
| `ui:status-bar` | 修改状态栏 |
| `ui:ribbon` | 修改功能栏 |
| `ui:outline` | 修改大纲面板 |
| `settings:read` | 读取设置项 |
| `settings:modify` | 修改设置项 |
| `network` | 发起网络请求 |
| `clipboard` | 访问剪贴板 |

### 5.2 声明示例

```json
{
  "permissions": [
    "editor:read",
    "editor:insert-blocks",
    "ui:dialog"
  ]
}
```

---

## 6. 完整 API 参考

所有 API 通过 `this.api` 访问。

### 6.1 基础属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `this.api.manifest` | `PluginManifest` | 当前插件的 manifest 对象 |
| `this.api.vue` | `typeof Vue` | Vue 3 运行时（`defineComponent`、`h`、`ref` 等） |

### 6.2 扩展点 API

| 方法 | 说明 |
|---|---|
| `addCommand(command)` | 注册一个命令（支持快捷键） |
| `removeCommand(id)` | 移除一个命令 |
| `registerBlockType(def)` | 注册自定义块类型 |
| `unregisterBlockType(type)` | 移除自定义块类型 |
| `registerSettingsPanel(def)` | 注册设置面板 |
| `unregisterSettingsPanel(title)` | 移除设置面板 |

### 6.3 数据持久化

| 方法 | 说明 |
|---|---|
| `loadData(): Promise<Record<string, any>>` | 读取插件保存的数据（返回 `{}`） |
| `saveData(data): Promise<void>` | 保存数据（JSON 格式，路径 `.unidoc/plugin-data/<插件id>.json` |

### 6.4 事件系统

| 方法 | 说明 |
|---|---|
| `on(event, listener)` | 监听应用事件 |
| `off(event, listener)` | 取消监听 |

### 6.5 编辑器 API（`this.api.editor.*`）

| 方法 | 说明 |
|---|---|
| `getActiveDocumentPath(): string \| null` | 获取当前打开的文档路径 |
| `getBlocks(): Block[]` | 获取当前文档所有块 |
| `getSelectedBlockId(): string \| null` | 获取当前选中的块 ID |
| `insertBlock(type, afterBlockId?)` | 插入新块 |
| `updateBlock(blockId, updates)` | 更新块属性 |
| `deleteBlock(blockId)` | 删除块 |

### 6.6 文件系统 API（`this.api.vault.*`）

| 方法 | 说明 |
|---|---|
| `readFile(path): Promise<string>` | 读取文件内容（相对 Vault 根的路径） |
| `writeFile(path, content): Promise<void>` | 写入文件 |
| `listDir(path): Promise<{name, isDir}[]>` | 列出目录内容 |
| `exists(path): Promise<boolean>` | 判断文件/目录是否存在 |

### 6.7 UI API（`this.api.ui.*`）

| 方法 | 说明 |
|---|---|
| `notify({type?, message, duration?})` | 显示通知 |
| `showDialog({title, content?, confirmText?, cancelText?}): Promise<boolean>` | 显示确认对话框，返回用户是否确认 |

---

## 7. 扩展点详解

### 7.1 命令（Commands）

通过命令面板（**Ctrl+Shift+P**）或快捷键触发操作。

```javascript
this.api.addCommand({
  id: 'my-command',           // 命令 ID（会自动加上插件前缀）
  name: '我的命令',                // 显示名
  hotkey: 'Ctrl+Shift+M',        // 可选：快捷键
  callback: () => {
    // 命令执行逻辑
  },
})
```

#### 快捷键格式

使用 `+` 连接修饰键和主键：

| 修饰键 | 可接受的写法 |
|---|---|
| Ctrl / Cmd | `ctrl`, `cmd`, `control` |
| Shift | `shift` |
| Alt / Option | `alt`, `option` |

示例：`Ctrl+S`、`Ctrl+Shift+P`、`Cmd+Shift+D`

> 注意：所有命令快捷键会在应用内全局生效，避免和已有快捷键冲突。

### 7.2 自定义块类型（Custom Blocks）

允许插件向编辑器注入自定义块类型，支持序列化和反序列化。

```javascript
this.api.registerBlockType({
  type: 'my-block',              // 块类型名（会自动加插件前缀
  component: MyBlockComponent,      // Vue 组件
  defaultProps: { count: 0 },      // 可选：默认属性
  defaultContent: {},                // 可选：默认内容
  serialize: (block) => {           // 可选：序列化为 Markdown
    return `> 我的自定义块: ${block.props.count}\n`
  },
  deserialize: (source) => {       // 可选：从 Markdown 反序列化
    const m = source.match(/(\d+)/)
    return {
      type: 'my-block',
      content: {},
      props: { count: m ? parseInt(m[1]) : 0 },
    }
  },
})
```

#### 块组件规范

块组件接收以下 props 和 events：

```javascript
const MyBlockComponent = defineComponent({
  props: {
    block: { type: Object, required: true },
    // block: { id, type, content, props, ... }
  },
  emits: ['update', 'enter', 'backspace-merge', 'select'],
  setup(props, { emit }) {
    // 触发 update: 更新块属性
    emit('update', { props: { ...props.block.props, count: 42 })

    // 触发 enter: 用户按回车新建块
    emit('enter')

    // 触发 select: 选中该块
    emit('select')

    return () => h('div', { /* ... */ })
  },
})
```

### 7.3 设置面板（Settings Panel）

在「设置 → 插件」页面底部显示自定义设置面板。

```javascript
const SettingsPanel = defineComponent({
  setup() {
    const value = ref('')

    onMounted(async () => {
      const data = await api.loadData()
      value.value = data.setting || ''
    })

    async function save() {
      await api.saveData({ setting: value.value })
    }

    return () => h('div', [
      h('input', { value: value.value, oninput: (e) => value.value = e.target.value }),
      h('button', { onclick: save }, '保存'),
    ])
  },
})

this.api.registerSettingsPanel({
  title: '我的设置',           // 面板标题（会自动加插件前缀
  component: SettingsPanel,
})
```

---

## 8. 事件系统

### 8.1 可用事件

| 事件类型 | 附加字段 | 触发时机 |
|---|---|---|
| `document:open` | `path: string` | 打开文档时 |
| `document:close` | `path: string` | 关闭文档时 |
| `document:save` | `path: string` | 保存文档时 |
| `block:change` | `blockId: string` | 块内容变化时 |
| `block:insert` | `blockId: string` | 块被插入时 |
| `block:delete` | `blockId: string` | 块被删除时 |
| `selection:change` | `blockId: string \| null` | 选中块变化时 |
| `theme:change` | `mode: 'light' \| 'dark'` | 主题切换时 |

### 8.2 事件监听示例

```javascript
class MyPlugin extends Plugin {
  onload() {
    this.api.on('document:save', (event) => {
      console.log('文档已保存:', event.path)
    })

    this.api.on('theme:change', (event) => {
      console.log('主题切换为:', event.mode)
    })
  }
}
```

---

## 9. 数据持久化

### 9.1 基本用法

```javascript
class MyPlugin extends Plugin {
  async onload() {
    // 读取保存的数据
    const data = await this.api.loadData()
    this.format = data.format || 'YYYY-MM-DD'

    // 保存数据
    await this.api.saveData({
      format: this.format,
      count: 42,
    })
  }
}
```

### 9.2 存储位置

数据保存在当前 Vault 下：
```
你的 Vault/.unidoc/plugin-data/<插件id>.json
```

- 每个插件独立一个 JSON 文件，互不干扰
- 数据跟随 Vault，不同 Vault 有各自的插件数据
- 仅支持 JSON 可序列化的数据（不要存函数、循环引用等）

---

## 10. 调试与排错

### 10.1 查看日志

打开开发者工具（F12），在 Console 面板中查看：

- 插件加载错误会输出：`加载插件失败 <id>: <error>`
- 命令执行错误会输出：`命令 <name> 执行失败: <error>`

### 10.2 重新加载插件

修改代码后：
1. 进入「设置 → 插件」
2. 点击右上角「重新扫描插件」按钮（旋转箭头图标）
3. 或者直接关闭重启 UniDoc

### 10.3 常见问题

**Q: 插件不显示在列表中？**
- 检查文件夹是否在 `.unidoc/plugins/` 下
- 检查 `manifest.json` 是否有语法错误（JSON 不允许尾随逗号）
- 检查 `id`、`name`、`main` 字段是否都填了

**Q: 插件显示「加载失败」？**
- 按 F12 查看控制台看具体错误
- 常见原因：
  - `index.js` 有语法错误
  - 未 `export default` 一个 `Plugin` 子类
  - 使用了 `require()`（不支持，改用 ES Module）
  - 使用了未声明的全局变量

**Q: 快捷键不生效？**
- 检查格式是否正确（`Ctrl+Shift+X`，注意大小写）
- 确认没有和内置快捷键冲突
- 在命令面板中能看到命令说明快捷键本身已注册

**Q: 自定义块不显示？**
- 确认块类型注册成功（没有类型名冲突）
- 检查组件是否正确使用 `h()` 渲染
- 确认块已插入（检查 `insertBlock` 的参数正确）

---

## 11. 最佳实践

### 11.1 代码组织

```javascript
// ✅ 推荐：将组件和主逻辑分离
function buildMyComponent(api) {
  return defineComponent({ /* ... */ })
}

class MyPlugin extends Plugin {
  onload() {
    const MyComponent = buildMyComponent(this.api)
    this.api.registerBlockType({ type: 'my-type', component: MyComponent })
  }
}

// ❌ 不推荐：所有逻辑堆在一起
class MyPlugin extends Plugin {
  onload() {
    // 大堆嵌套
  }
}
```

### 11.2 错误处理

```javascript
// ✅ 推荐：捕获异步错误
try {
  const data = await this.api.loadData()
} catch (e) {
  console.error('读取数据失败', e)
}

// ✅ 推荐：给用户友好的反馈
this.api.ui.notify({
  type: 'error',
  message: '操作失败：' + (e as Error).message,
})
```

### 11.3 性能注意事项

- 避免在 `onload` 中做耗时操作，尽量懒加载
- 定时器要在 `onunload` 中清理
- 避免频繁调用 `saveData`，可做节流或防抖
- 大块数据量的 DOM 操作使用 `documentFragment` 或虚拟列表

### 11.4 命名约定

- 命令 ID：动词 + 名词，如 `insert-date`、`show-stats`
- 块类型：描述性名称，如 `callout`、`timer`
- 设置面板标题：和插件功能名一致
- 事件监听：在 `onunload` 中清理

---

## 12. 示例插件

仓库中自带了多个可直接运行的示例：

| 插件 | 路径 | 演示能力 |
|---|---|---|
| **字数统计** | `examples/plugins/word-count/` | 命令 + 编辑器读取 + 快捷键 |
| **插入日期** | `examples/plugins/insert-date/` | 命令 + 设置面板 + 数据持久化 |
| **Callout 块** | `examples/plugins/callout-block/` | 自定义块类型 + 序列化 |
| **计时器** | `examples/plugins/timer-block/` | 自定义块 + 复杂状态 + 定时器 |
| **主题色** | `examples/plugins/theme-color/` | 设置面板 + CSS 变量注入 |

每个示例都可以直接复制到 `.unidoc/plugins/` 下使用。

---

## 附录 A：类型声明

完整的 TypeScript 类型定义见：
[src/core/plugin/unidoc-api.d.ts](file:///c:/Users/乔一峰/Documents/uni-doc/src/core/plugin/unidoc-api.d.ts)

在 IDE 中安装 TypeScript 服务的开发者可获得完整的类型提示。

## 附录 B：核心源码

| 文件 | 说明 |
|---|---|
| [types.ts](file:///c:/Users/乔一峰/Documents/uni-doc/src/core/plugin/types.ts) | 类型定义与 Plugin 基类 |
| [manager.ts](file:///c:/Users/乔一峰/Documents/uni-doc/src/core/plugin/manager.ts) | 插件管理器（加载、卸载、事件分发） |
| [plugin.ts](file:///c:/Users/乔一峰/Documents/uni-doc/src/stores/plugin.ts) | Pinia 状态管理 |
