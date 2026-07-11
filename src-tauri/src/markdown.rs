//! Markdown 序列化(Rust 实现)
//! 参考 PRD §11.4(Markdown 序列化)和 §7.2(扩展 Markdown 规则)
//!
//! 与前端 TypeScript 版本(markdown.ts)保持一致的序列化逻辑:
//! - paragraph: 纯文本(带行内标记)
//! - heading:   # ~ ######
//! - list:      - / 1. / - [x]
//! - divider:   ---
//! - page_break: ---page---
//! - 行内标记:  **bold** *italic* ~~strike~~ `code` <u>underline</u>

use serde_json::Value;

/// 行内标记类型
#[derive(Clone, Copy, PartialEq)]
enum MarkType {
    Bold,
    Italic,
    Underline,
    Strikethrough,
    Code,
}

impl MarkType {
    /// 从 JSON 字符串解析标记类型
    fn from_str(s: &str) -> Option<MarkType> {
        match s {
            "bold" => Some(MarkType::Bold),
            "italic" => Some(MarkType::Italic),
            "underline" => Some(MarkType::Underline),
            "strikethrough" => Some(MarkType::Strikethrough),
            "code" => Some(MarkType::Code),
            _ => None,
        }
    }
}

/// 行内标记(位置区间 + 类型)
struct Mark {
    mark_type: MarkType,
    start: usize,
    end: usize,
}

/// 按起始位置升序、长度(end)降序排序,保证嵌套标记正确应用
/// 与前端 sortMarks 一致
fn sort_marks(marks: &mut Vec<Mark>) {
    marks.sort_by(|a, b| {
        a.start
            .cmp(&b.start)
            .then_with(|| b.end.cmp(&a.end))
    });
}

/// 从 JSON Value 解析 marks 数组
fn parse_marks(marks_value: &Value) -> Vec<Mark> {
    let mut marks = Vec::new();
    if let Some(arr) = marks_value.as_array() {
        for m in arr {
            if let (Some(type_str), Some(start), Some(end)) = (
                m.get("type").and_then(|v| v.as_str()),
                m.get("start").and_then(|v| v.as_u64()),
                m.get("end").and_then(|v| v.as_u64()),
            ) {
                if let Some(mark_type) = MarkType::from_str(type_str) {
                    marks.push(Mark {
                        mark_type,
                        start: start as usize,
                        end: end as usize,
                    });
                }
            }
        }
    }
    sort_marks(&mut marks);
    marks
}

/// 将带 Mark 的文本序列化为 Markdown 行内语法
/// 从后往前插入,避免位置偏移(与前端 serializeMarks 一致)
fn serialize_marks(text: &str, marks_value: &Value) -> String {
    let marks = parse_marks(marks_value);
    if marks.is_empty() {
        return text.to_string();
    }

    // 将文本转为字符向量,便于按字节/字符位置操作
    // 注意:前端使用 JS 字符串索引(UTF-16 码元),这里使用字符索引
    // 对于 ASCII 文本两者一致;对于含多字节字符的文本可能有微小差异,但 M1 阶段可接受
    let chars: Vec<char> = text.chars().collect();
    let mut result: Vec<char> = chars.clone();

    // 从后往前应用标记
    for mark in marks.iter().rev() {
        let start = mark.start.min(result.len());
        let end = mark.end.min(result.len());
        if start >= end {
            continue;
        }
        let seg: String = result[start..end].iter().collect();
        let wrapped = match mark.mark_type {
            MarkType::Bold => format!("**{}**", seg),
            MarkType::Italic => format!("*{}*", seg),
            MarkType::Strikethrough => format!("~~{}~~", seg),
            MarkType::Code => format!("`{}`", seg),
            MarkType::Underline => format!("<u>{}</u>", seg),
        };
        // 替换 result[start..end] 为 wrapped 的字符
        let wrapped_chars: Vec<char> = wrapped.chars().collect();
        result.splice(start..end, wrapped_chars);
    }

    result.into_iter().collect()
}

/// 从 block 的 content 中获取 text 字段
fn get_text(content: &Value) -> String {
    content
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 从 block 的 content 中获取 marks 字段(作为 Value 引用)
fn get_marks_value(content: &Value) -> Value {
    content.get("marks").cloned().unwrap_or(Value::Null)
}

/// 序列化单个 Block 为 Markdown 文本(可能多行)
fn serialize_block(block: &Value) -> String {
    let block_type = block
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match block_type {
        "heading" => {
            let content = block.get("content").unwrap_or(&Value::Null);
            let text = get_text(content);
            let marks_value = get_marks_value(content);
            let level = block
                .get("props")
                .and_then(|p| p.get("level"))
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as usize;
            let prefix = "#".repeat(level.min(6));
            format!("{} {}", prefix, serialize_marks(&text, &marks_value))
        }
        "paragraph" => {
            let content = block.get("content").unwrap_or(&Value::Null);
            let text = get_text(content);
            let marks_value = get_marks_value(content);
            serialize_marks(&text, &marks_value)
        }
        "list" => {
            let content = block.get("content").unwrap_or(&Value::Null);
            let list_type = block
                .get("props")
                .and_then(|p| p.get("listType"))
                .and_then(|v| v.as_str())
                .unwrap_or("bullet");
            let items = content
                .get("items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            items
                .iter()
                .enumerate()
                .map(|(idx, item)| {
                    let text = item
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    match list_type {
                        "ordered" => format!("{}. {}", idx + 1, text),
                        "task" => {
                            let checked = item
                                .get("checked")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let check = if checked { 'x' } else { ' ' };
                            format!("- [{}] {}", check, text)
                        }
                        _ => format!("- {}", text),
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        "divider" => "---".to_string(),
        "page_break" => "---page---".to_string(),
        _ => String::new(),
    }
}

/// blocks JSON 数组 → Markdown 字符串
/// 与前端 serializeMarkdown 一致:非空行用双换行连接
pub fn serialize_markdown(blocks_json: &str) -> Result<String, String> {
    let blocks: Vec<Value> = serde_json::from_str(blocks_json)
        .map_err(|e| format!("解析 blocks JSON 失败: {}", e))?;

    let lines: Vec<String> = blocks
        .iter()
        .map(serialize_block)
        .filter(|s| !s.is_empty())
        .collect();

    Ok(lines.join("\n\n"))
}
