# Open Source Software Usage Declaration / 开源软件使用声明

This document declares the open source software used by the **unidoc** project, along with their respective licenses. We sincerely thank the authors and communities of these projects for their contributions.

本文档声明 **unidoc** 项目所使用的开源软件及其对应的开源协议。我们衷心感谢这些项目的作者与社区所做出的贡献。

> Licenses are sourced from each project's official repository / package metadata. The notation "MIT OR Apache-2.0" indicates a dual-licensed project where either license may be applied.
>
> 协议信息来源于各项目官方仓库 / 包元数据。「MIT OR Apache-2.0」表示该项目采用双协议授权，可任选其一适用。

---

## 🇺🇸 English Version

### 1. Project License

unidoc itself is open-sourced under the [MIT License](./LICENSE).

### 2. Frontend Dependencies (npm)

| Package | License |
| :--- | :--- |
| [@tauri-apps/api](https://github.com/tauri-apps/tauri) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-dialog](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-fs](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-notification](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [@types/katex](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [jszip](https://github.com/Stuk/jszip) | MIT |
| [katex](https://github.com/KaTeX/KaTeX) | MIT |
| [lucide-vue-next](https://github.com/lucide-icons/lucide) | ISC |
| [mermaid](https://github.com/mermaid-js/mermaid) | MIT |
| [pinia](https://github.com/vuejs/pinia) | MIT |
| [vue](https://github.com/vuejs/core) | MIT |
| [vue-router](https://github.com/vuejs/router) | MIT |

### 3. Frontend Dev Dependencies (npm)

| Package | License |
| :--- | :--- |
| [@eslint/js](https://github.com/eslint/eslint) | MIT |
| [@tauri-apps/cli](https://github.com/tauri-apps/tauri) | MIT OR Apache-2.0 |
| [@typescript-eslint/eslint-plugin](https://github.com/typescript-eslint/typescript-eslint) | MIT |
| [@typescript-eslint/parser](https://github.com/typescript-eslint/typescript-eslint) | MIT |
| [@vitejs/plugin-vue](https://github.com/vitejs/vite-plugin-vue) | MIT |
| [eslint](https://github.com/eslint/eslint) | MIT |
| [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier) | MIT |
| [eslint-plugin-prettier](https://github.com/prettier/eslint-plugin-prettier) | MIT |
| [eslint-plugin-vue](https://github.com/vuejs/eslint-plugin-vue) | MIT |
| [prettier](https://github.com/prettier/prettier) | MIT |
| [typescript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [vite](https://github.com/vitejs/vite) | MIT |
| [vue-tsc](https://github.com/vuejs/language-tools) | MIT |

### 4. Backend Dependencies (Cargo / Rust)

| Crate | License |
| :--- | :--- |
| [tauri](https://github.com/tauri-apps/tauri) | MIT OR Apache-2.0 |
| [tauri-plugin-dialog](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [tauri-plugin-fs](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [tauri-plugin-notification](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [tauri-plugin-log](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [serde](https://github.com/serde-rs/serde) | MIT OR Apache-2.0 |
| [serde_json](https://github.com/serde-rs/json) | MIT OR Apache-2.0 |
| [uuid](https://github.com/uuid-rs/uuid) | MIT OR Apache-2.0 |
| [chrono](https://github.com/chronotope/chrono) | MIT OR Apache-2.0 |
| [log](https://github.com/rust-lang/log) | MIT OR Apache-2.0 |
| [dirs](https://github.com/soc/dirs-rs) | MIT OR Apache-2.0 |
| [ureq](https://github.com/algesten/ureq) | MIT OR Apache-2.0 |
| [html-escape](https://github.com/emoon/rust-html-escape) | MIT OR Apache-2.0 |
| [urlencoding](https://github.com/kornelski/rust_urlencoding) | MIT |

### 5. Notes

- This declaration lists the **direct** dependencies declared in [`package.json`](./package.json) and [`src-tauri/Cargo.toml`](./src-tauri/Cargo.toml). Each transitive dependency retains its own license as declared by its authors.
- All trademarks referenced herein are the property of their respective owners.
- If you believe any license information is incorrect or incomplete, please open an issue or submit a pull request.

---

## 🇨🇳 中文版

### 1. 项目协议

unidoc 本身基于 [MIT License](./LICENSE) 开源。

### 2. 前端依赖 (npm)

| 包名 | 协议 |
| :--- | :--- |
| [@tauri-apps/api](https://github.com/tauri-apps/tauri) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-dialog](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-fs](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-notification](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [@types/katex](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [jszip](https://github.com/Stuk/jszip) | MIT |
| [katex](https://github.com/KaTeX/KaTeX) | MIT |
| [lucide-vue-next](https://github.com/lucide-icons/lucide) | ISC |
| [mermaid](https://github.com/mermaid-js/mermaid) | MIT |
| [pinia](https://github.com/vuejs/pinia) | MIT |
| [vue](https://github.com/vuejs/core) | MIT |
| [vue-router](https://github.com/vuejs/router) | MIT |

### 3. 前端开发依赖 (npm)

| 包名 | 协议 |
| :--- | :--- |
| [@eslint/js](https://github.com/eslint/eslint) | MIT |
| [@tauri-apps/cli](https://github.com/tauri-apps/tauri) | MIT OR Apache-2.0 |
| [@typescript-eslint/eslint-plugin](https://github.com/typescript-eslint/typescript-eslint) | MIT |
| [@typescript-eslint/parser](https://github.com/typescript-eslint/typescript-eslint) | MIT |
| [@vitejs/plugin-vue](https://github.com/vitejs/vite-plugin-vue) | MIT |
| [eslint](https://github.com/eslint/eslint) | MIT |
| [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier) | MIT |
| [eslint-plugin-prettier](https://github.com/prettier/eslint-plugin-prettier) | MIT |
| [eslint-plugin-vue](https://github.com/vuejs/eslint-plugin-vue) | MIT |
| [prettier](https://github.com/prettier/prettier) | MIT |
| [typescript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [vite](https://github.com/vitejs/vite) | MIT |
| [vue-tsc](https://github.com/vuejs/language-tools) | MIT |

### 4. 后端依赖 (Cargo / Rust)

| Crate | 协议 |
| :--- | :--- |
| [tauri](https://github.com/tauri-apps/tauri) | MIT OR Apache-2.0 |
| [tauri-plugin-dialog](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [tauri-plugin-fs](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [tauri-plugin-notification](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [tauri-plugin-log](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [serde](https://github.com/serde-rs/serde) | MIT OR Apache-2.0 |
| [serde_json](https://github.com/serde-rs/json) | MIT OR Apache-2.0 |
| [uuid](https://github.com/uuid-rs/uuid) | MIT OR Apache-2.0 |
| [chrono](https://github.com/chronotope/chrono) | MIT OR Apache-2.0 |
| [log](https://github.com/rust-lang/log) | MIT OR Apache-2.0 |
| [dirs](https://github.com/soc/dirs-rs) | MIT OR Apache-2.0 |
| [ureq](https://github.com/algesten/ureq) | MIT OR Apache-2.0 |
| [html-escape](https://github.com/emoon/rust-html-escape) | MIT OR Apache-2.0 |
| [urlencoding](https://github.com/kornelski/rust_urlencoding) | MIT |

### 5. 说明

- 本声明仅列出 [`package.json`](./package.json) 与 [`src-tauri/Cargo.toml`](./src-tauri/Cargo.toml) 中声明的**直接**依赖。每个间接（传递）依赖保留其作者各自声明的协议。
- 本文件中提及的所有商标均归各自所有者所有。
- 若您发现任何协议信息有误或不完整，欢迎提交 Issue 或 Pull Request。
