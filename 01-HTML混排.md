---
title: 01-HTML混排
author: UniDoc User
version: 1.0.0
created_at: "2026-06-30T16:29:51.688Z"
updated_at: "2026-07-03T11:55:47.757Z"
---

# HTML 混排测试

## 基础 HTML 标签

### 文字格式

这是 粗体，这是 斜体，这是 下划线，这是 删除线。

这是 高亮文本，这是 小号文本。

### 上标和下标

H2O 是水的化学式，210 = 1024。

### 键盘按键

按 Ctrl + Shift + P 打开命令面板。

---

## 布局元素

### 居中对齐

 这是居中的标题 这是居中的段落文本内容。 

### 右对齐

这段文字右对齐显示。

### 左右分栏

<table> <tr> <td width="50%">

**左栏内容**

- 项目一
- 项目二
- 项目三

</td> <td width="50%">

**右栏内容**

- 项目 A
- 项目 B
- 项目 C

</td> </tr> </table>

---

## 折叠内容

### details/summary

<details> 点击展开查看详情

这是折叠的内容，点击标题可以展开或收起。

- 可以包含列表
- 可以包含代码
- 可以包含图片

```python
print("Hello from details!")
```

</details>

### 默认展开

<details open> 默认展开的折叠面板

这个面板默认是展开状态的。

</details>

---

## 进度条

### 基础进度条

70%

### 不同进度

- 完成度：25% 25%
- 完成度：50% 50%
- 完成度：90% 90%

---

## 选项卡

<details> 选项卡 1

这是选项卡 1 的内容。

</details>

<details> 选项卡 2

这是选项卡 2 的内容。

</details>

<details> 选项卡 3

这是选项卡 3 的内容。

</details>

---

## 表格增强

### 带边框的表格

<table border="1" cellpadding="8" cellspacing="0">   <tr>     <th>姓名</th>     <th>年龄</th>     <th>城市</th>   </tr>   <tr>     <td>张三</td>     <td>25</td>     <td>北京</td>   </tr>   <tr>     <td>李四</td>     <td>30</td>     <td>上海</td>   </tr> </table>

---

## 其他 HTML 元素

### 缩写

<abbr title="HyperText Markup Language">HTML</abbr> 是网页的标准标记语言。

### 定义术语

<dfn>Markdown</dfn> 是一种轻量级标记语言。

### 引用

根据 <cite>维基百科</cite> 的定义，Markdown 由 John Gruber 于 2004 年创建。

### 时间

发布时间：<time datetime="2026-06-28">2026年6月28日</time>

---

## 水平线变体

<hr color="#333" size="2">

<hr style="border: 2px dashed #666;">

---

*文件结束*