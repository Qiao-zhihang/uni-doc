# UniDoc 隐私政策 / Privacy Policy

> 生效日期 / Effective Date: 2026-10-23
>
> 版本 / Version: 1.1

## 中文版

感谢您使用 UniDoc（以下简称"本软件"）。本软件坚持"本地优先，数据主权"的设计理念，我们非常重视您的隐私。本政策说明本软件如何收集、使用、存储和保护您的数据。

### 一、我们收集哪些数据

**本软件本身不收集任何个人数据。** 具体而言：

- **不采集遥测与统计**：本软件不包含任何遥测、分析、埋点或崩溃上报组件，不会在后台向任何服务器发送使用数据。
- **不要求账号**：使用本软件无需注册或登录，我们不会收集您的姓名、邮箱、电话等身份信息。
- **无广告**：本软件不含任何广告，因此不存在广告追踪。
- **无自动更新收集**：本软件不包含自动更新检查机制，不会因此连接网络。

### 二、您的数据存储在哪里

- **文档数据**：您的所有文档均以标准 `.md` 格式保存在您自己选择的本地文件夹（文档仓库）中。本软件不会将您的文档上传到任何服务器。
- **设置与配置**：您的应用设置（如界面偏好、AI 配置等）仅保存在您本机设备的本地存储中。
- **AI 配置（API Key）**：当您配置 AI 功能时填写的 API Key 仅保存在本机，并以混淆形式存储（非明文）。您的 API Key 属于您与 AI 服务商之间的凭证，本软件不会上传、共享或转售。

### 三、AI 功能如何传输数据

本软件提供 AI 协作功能。使用该功能时：

- 仅当您**主动发起** AI 操作（如向 AI 提问、请求生成或改写内容）时，相关文档内容才会发送给您**自行配置**的 AI 服务商（如 OpenAI、DeepSeek、通义千问、智谱、Ollama 本地模型或您自定义的 API 地址）。
- 内容发送遵循您所选择的服务商的隐私政策与使用条款。若您使用本地模型（如 Ollama），数据不会离开您的设备。
- 本软件不会在您未主动操作的情况下发送任何内容。

### 四、AI 记忆数据

本软件的 AI 记忆功能用于让助手记住您的偏好与背景信息。这些数据**只保存在本机**，不会上传到我们的服务器：

- **存储位置与格式**：桌面端保存在 `~/.unidoc/ai_memory.json`，浏览器端保存在 localStorage 的 `unidoc-ai-memory` 键；两者都是**明文 JSON**，不做加密。
- **存储内容**：①用户画像（姓名/别称、写作风格、格式偏好、关注主题、技术栈、备注）；②记忆事实（自动提取或手动添加的条目，含内容、分类、标签、来源、时间与排序信息）；③记忆行为设置（总开关、自动提取、注入条数与长度上限、自动清理）。
- **用途与传输**：这些数据仅作为提示词上下文，在您发起 AI 对话时发送给您**自行配置**的 AI 服务商，不会上传到其他任何服务器；若使用本地模型（如 Ollama），数据不会离开您的设备。
- **您的控制权**：可在设置页查看、搜索、编辑、置顶、停用、删除、清空，并支持 JSON 导出与导入。关闭 AI 记忆总开关后，本软件停止注入记忆、停止注册记忆工具并停止自动提取，但已有数据仍保留在本机，可随时彻底删除。
- **自动备份**：在替换导入、清空全部记忆，以及记忆数据结构升级（v1→v2 迁移）前，本软件会自动备份当前记忆到 `~/.unidoc/ai_memory.backup.json`（浏览器端为 localStorage 的 `unidoc-ai-memory-backup` 键）；备份失败不会阻塞操作，仅在控制台记录。
- **抽取质量提示**：会话结束时的自动提取依赖关键词与模式规则，可能记录不准确的信息；请在设置页定期复核与修正。

### 五、第三方链接与外部服务

- 当您使用"搜索"功能时，搜索词会跳转到外部浏览器（如必应 Bing）进行处理，相关数据受该第三方网站的隐私政策约束。
- 当您在文档中嵌入远程图片或链接时，加载过程由浏览器/系统组件按您点击或渲染的内容自然进行，本软件不干预其中的数据传输。

### 六、系统通知

本软件可能使用系统本地通知功能（如任务提醒等），通知内容仅在本机生成与展示，不会传输到任何服务器。

### 七、数据留存与删除

- 由于本软件不收集您的个人数据，因此不存在本软件侧的数据留存。
- 您的文档、设置与 AI 记忆数据完全由您掌控。删除本软件或其本地文件（含 `~/.unidoc/ai_memory.json` 与备份文件）即完成数据删除。卸载软件不会上传或保留任何数据副本。

### 八、您的权利

- 您可以随时在本机查看、修改或删除您的文档与设置。
- 您可以在设置界面随时修改或删除您配置的 AI API Key。
- 您可以在设置页的「记忆管理」中查看、搜索、修改、删除、清空、导出或导入 AI 记忆数据，并随时关闭 AI 记忆功能。

### 九、数据共享

本软件不会出售、出租、交易或共享您的个人数据。唯一可能的第三方数据交互见上述"AI 功能"与"第三方链接"部分，且均以您主动操作为前提。

### 十、未成年人

本软件面向一般用户，不专门面向未成年人，也不会有意收集未成年人的个人信息。

### 十一、政策更新

如本政策发生变更，我们会在软件发布渠道（如微软商店页面）公布更新后的版本，并更新政策顶部的生效日期。

### 十二、联系我们

如果您对本隐私政策有任何疑问，请通过以下方式联系我们：

- 邮箱 / GitHub Issues：https://github.com/Qiao-zhihang/uni-doc

---

## English Version

Thank you for using UniDoc ("the Software"). UniDoc is built on a "Local First, Data Sovereignty" philosophy, and we take your privacy seriously. This policy describes how the Software collects, uses, stores, and protects your data.

### 1. What Data We Collect

**The Software itself does not collect any personal data.** Specifically:

- **No telemetry or analytics**: The Software contains no telemetry, analytics, tracking, or crash-reporting components, and does not send usage data to any server in the background.
- **No account required**: No registration or login is needed to use the Software. We do not collect your name, email, phone number, or any identity information.
- **No advertising**: The Software contains no ads and therefore no ad tracking.
- **No automatic updates**: The Software has no auto-update mechanism that would connect to the network on its own.

### 2. Where Your Data Is Stored

- **Documents**: All of your documents are saved as standard `.md` files in a local folder (your document repository) that you choose. The Software never uploads your documents to any server.
- **Settings & configuration**: Your app settings (e.g., UI preferences, AI configuration) are stored only in local storage on your device.
- **AI configuration (API keys)**: Any API key you enter when configuring the AI feature is stored only on your device, in an obfuscated (non-plaintext) form. Your API key is a credential between you and the AI provider; the Software does not upload, share, or resell it.

### 3. How the AI Feature Transfers Data

The Software provides AI-assisted features. When you use them:

- Only when you **explicitly initiate** an AI action (e.g., asking the AI a question or requesting generation/rewriting of content) are the relevant document contents sent to the AI provider **you have configured** (such as OpenAI, DeepSeek, Qwen, Zhipu, a local Ollama model, or a custom API endpoint).
- Transfers are governed by the privacy policy and terms of the provider you select. If you use a local model (e.g., Ollama), your data never leaves your device.
- The Software never sends content without your explicit action.

### 4. AI Memory Data

The Software's AI memory feature lets the assistant remember your preferences and background. This data **stays on your device only** and is never uploaded to our servers:

- **Location and format**: in the desktop app it is stored in `~/.unidoc/ai_memory.json`; in the browser build it is stored under the `unidoc-ai-memory` localStorage key. Both are **plaintext JSON** and are not encrypted.
- **What is stored**: (1) user profile (name / aliases, writing style, format preferences, themes, tech stack, notes); (2) memory facts extracted from conversations or added by hand, including content, category, tags, source, timestamps, and ranking metadata; (3) memory behaviour settings (master switch, auto-extraction, injection count and length limits, automatic cleanup).
- **Purpose and transfer**: the data is used only as prompt context and is sent to the AI provider **you configured** when you initiate an AI conversation. It is never uploaded to any other server; if you use a local model (e.g. Ollama), the data never leaves your device.
- **Your control**: you can view, search, edit, pin, disable, delete, and clear this data in the Settings memory manager, and export or import it as JSON. When the AI memory master switch is off, the Software stops injecting memories, stops registering memory tools, and stops auto-extraction; existing data remains on your device and can be deleted at any time.
- **Automatic backup**: before replacing via import, clearing all memory, or upgrading the memory data schema (v1 → v2 migration), the Software backs up the current memory to `~/.unidoc/ai_memory.backup.json` (in the browser build: the `unidoc-ai-memory-backup` localStorage key). A failed backup does not block the operation; it is only logged to the console.
- **Extraction quality**: end-of-conversation extraction relies on keyword and pattern rules and may record inaccurate information; please review and correct it in Settings periodically.

### 5. Third-Party Links and External Services

- When you use the "Search" feature, search terms are handed off to an external browser (e.g., Bing) for processing; that data is subject to the third-party site's privacy policy.
- When you embed remote images or links in a document, loading occurs naturally via the browser/system components as you click or render content; the Software does not intervene in that data transfer.

### 6. System Notifications

The Software may use local system notifications (e.g., task reminders). Notification content is generated and displayed locally on your device and is not transmitted to any server.

### 7. Data Retention and Deletion

- Because the Software does not collect personal data, there is nothing for us to retain.
- Your documents, settings, and AI memory data are fully under your control. Deleting the Software or its local files (including `~/.unidoc/ai_memory.json` and its backup) deletes the data. Uninstalling the app does not upload or retain any copy of your data.

### 8. Your Rights

- You may view, modify, or delete your documents and settings on your device at any time.
- You may modify or delete your configured AI API key at any time in the settings screen.
- You may view, search, modify, delete, clear, export, or import your AI memory data in the Settings memory manager, and disable the AI memory feature at any time.

### 9. Data Sharing

The Software does not sell, rent, trade, or share your personal data. The only possible third-party data interactions are described in the "AI Feature" and "Third-Party Links" sections above, and all occur only at your explicit initiative.

### 10. Children

The Software is intended for general audiences, is not directed at children, and does not knowingly collect personal information from children.

### 11. Policy Changes

If this policy changes, we will publish the updated version on the distribution channel (e.g., the Microsoft Store listing) and update the effective date at the top of this policy.

### 12. Contact Us

If you have any questions about this privacy policy, please contact us at:

- Email / GitHub Issues: https://github.com/Qiao-zhihang/uni-doc