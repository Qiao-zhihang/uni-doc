// UniDoc Tauri 后端入口
// 参考 PRD §8.2(架构分层)— 后端层负责窗口/系统交互、文件 I/O(.uni-doc 读写)

mod markdown;

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

/// .uni-doc 文件格式常量
/// 参考 PRD §7.1:本质为 ZIP,包含 content.md / blocks.json / assets/ / meta.json
const UNIDOC_VERSION: &str = "1.0.0";

/// 保存 .uni-doc 文件
/// 接收前端传来的 JSON 字符串,用 zip crate 创建 ZIP 文件
/// 参考 PRD §7.1(专属文件格式)
#[tauri::command]
fn save_uni_doc(
    file_path: String,
    blocks_json: String,
    meta_json: String,
) -> Result<(), String> {
    // 将 blocks 序列化为 Markdown(与前端 serializeMarkdown 一致)
    let content_md = markdown::serialize_markdown(&blocks_json)?;

    // 解析并更新 meta 的 updated_at
    let mut meta: serde_json::Value = if meta_json.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(&meta_json).map_err(|e| format!("解析 meta JSON 失败: {}", e))?
    };
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(obj) = meta.as_object_mut() {
        obj.entry("updated_at").or_insert(serde_json::Value::String(now.clone()));
        // 若缺少 version,补充默认值
        if !obj.contains_key("version") {
            obj.insert("version".to_string(), serde_json::Value::String(UNIDOC_VERSION.to_string()));
        }
    }
    let meta_str = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("序列化 meta 失败: {}", e))?;

    // 美化 blocks JSON(与前端 JSON.stringify(blocks, null, 2) 一致)
    let blocks_pretty = prettify_json(&blocks_json)?;

    // 创建 ZIP 文件
    let file = File::create(&file_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    // 写入 content.md
    zip.start_file("content.md", options)
        .map_err(|e| format!("写入 content.md 失败: {}", e))?;
    zip.write_all(content_md.as_bytes())
        .map_err(|e| format!("写入 content.md 内容失败: {}", e))?;

    // 写入 blocks.json
    zip.start_file("blocks.json", options)
        .map_err(|e| format!("写入 blocks.json 失败: {}", e))?;
    zip.write_all(blocks_pretty.as_bytes())
        .map_err(|e| format!("写入 blocks.json 内容失败: {}", e))?;

    // 写入 meta.json
    zip.start_file("meta.json", options)
        .map_err(|e| format!("写入 meta.json 失败: {}", e))?;
    zip.write_all(meta_str.as_bytes())
        .map_err(|e| format!("写入 meta.json 内容失败: {}", e))?;

    // 创建空的 assets/ 目录
    zip.add_directory("assets/", options)
        .map_err(|e| format!("创建 assets 目录失败: {}", e))?;

    zip.finish()
        .map_err(|e| format!("完成 ZIP 写入失败: {}", e))?;

    Ok(())
}

/// 加载 .uni-doc 文件
/// 读取 ZIP 文件,解压 content.md / blocks.json / meta.json,返回 JSON 字符串
/// 返回格式: { "content": "...", "blocks": "...", "meta": "..." }
/// (前端解析 blocks 和 meta 字段为对象)
#[tauri::command]
fn load_uni_doc(file_path: String) -> Result<String, String> {
    let file = File::open(&file_path)
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("读取 ZIP 失败: {}", e))?;

    // 读取 content.md
    let content = read_zip_entry(&mut archive, "content.md")?;

    // 读取 blocks.json
    let blocks_json = read_zip_entry(&mut archive, "blocks.json")?;

    // 读取 meta.json(若不存在则使用默认值)
    let meta_json = read_zip_entry(&mut archive, "meta.json")
        .unwrap_or_else(|_| {
            let now = chrono::Utc::now().to_rfc3339();
            serde_json::json!({
                "title": "未命名文档",
                "created_at": now,
                "updated_at": now,
                "version": UNIDOC_VERSION,
                "author": "UniDoc User"
            })
            .to_string()
        });

    // 构建返回的 JSON 对象
    let result = serde_json::json!({
        "content": content,
        "blocks": blocks_json,
        "meta": meta_json,
    });

    Ok(result.to_string())
}

/// 保存 .md 文件(纯文本)
#[tauri::command]
fn save_md_file(file_path: String, content: String) -> Result<(), String> {
    let mut file = File::create(&file_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/// 加载 .md 文件内容
#[tauri::command]
fn load_md_file(file_path: String) -> Result<String, String> {
    let mut file = File::open(&file_path)
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(content)
}

/// 弹出保存 .md 文件对话框
#[tauri::command]
fn save_md_dialog(
    app: tauri::AppHandle,
    title: String,
    default_name: String,
) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .set_title(&title)
        .set_file_name(&default_name)
        .add_filter("Markdown 文件", &["md"])
        .add_filter("文本文件", &["txt"])
        .blocking_save_file();

    match file_path {
        Some(fp) => {
            let path = fp.simplified();
            Ok(Some(path.to_string()))
        }
        None => Ok(None),
    }
}

/// 弹出打开 .md 文件对话框
#[tauri::command]
fn open_md_dialog(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .set_title("打开 Markdown 文件")
        .add_filter("Markdown 文件", &["md", "markdown", "txt"])
        .blocking_pick_file();

    match file_path {
        Some(fp) => {
            let path = fp.simplified();
            Ok(Some(path.to_string()))
        }
        None => Ok(None),
    }
}
#[tauri::command]
fn save_uni_doc_dialog(
    app: tauri::AppHandle,
    title: String,
    default_name: String,
) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .set_title(&title)
        .set_file_name(&default_name)
        .add_filter("UniDoc 文档", &["uni-doc"])
        .blocking_save_file();

    match file_path {
        Some(fp) => {
            let path = fp.simplified();
            Ok(Some(path.to_string()))
        }
        None => Ok(None),
    }
}

/// 弹出打开文件对话框,返回用户选择的路径
#[tauri::command]
fn open_uni_doc_dialog(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .set_title("打开 UniDoc 文档")
        .add_filter("UniDoc 文档", &["uni-doc"])
        .blocking_pick_file();

    match file_path {
        Some(fp) => {
            let path = fp.simplified();
            Ok(Some(path.to_string()))
        }
        None => Ok(None),
    }
}

/// Vault 操作:选择 vault 根目录
/// 返回用户选择的文件夹路径,None 表示用户取消
#[tauri::command]
fn pick_vault_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("选择 Vault 文件夹")
        .blocking_pick_folder();

    match folder {
        Some(fp) => {
            let path = fp.simplified();
            Ok(Some(path.to_string()))
        }
        None => Ok(None),
    }
}

/// Vault 文件节点(前端用)
/// name: 显示名(含扩展名)
/// path: 相对 vault 根的路径(用 / 分隔,跨平台一致)
/// is_dir: 是否为文件夹
/// children: 子节点(仅文件夹有)
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<VaultNode>>,
}

/// 递归扫描 vault 目录,返回树结构
/// 仅返回 .md / .markdown 文件,排除隐藏目录(以 . 开头)和 node_modules
#[tauri::command]
fn read_vault_tree(root_path: String) -> Result<Vec<VaultNode>, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err(format!("路径不存在: {}", root_path));
    }
    if !root.is_dir() {
        return Err(format!("不是文件夹: {}", root_path));
    }
    let root_canonical = root
        .canonicalize()
        .map_err(|e| format!("规范化路径失败: {}", e))?;
    Ok(scan_dir(&root_canonical, &root_canonical)?)
}

/// 递归扫描目录
fn scan_dir(dir: &Path, root: &Path) -> Result<Vec<VaultNode>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;
    let mut nodes: Vec<VaultNode> = Vec::new();

    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut files: Vec<PathBuf> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // 跳过隐藏文件/文件夹(以 . 开头)
        if name.starts_with('.') {
            continue;
        }
        // 跳过 node_modules
        if name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }

        if path.is_dir() {
            dirs.push(path);
        } else if is_markdown_file(&name) {
            files.push(path);
        }
    }

    // 文件夹优先,各自按名称升序
    dirs.sort_by(|a, b| file_name_lower(a).cmp(&file_name_lower(b)));
    files.sort_by(|a, b| file_name_lower(a).cmp(&file_name_lower(b)));

    for d in dirs {
        let name = file_name_display(&d);
        let rel = relative_path(&d, root)?;
        let children = scan_dir(&d, root)?;
        // 保留所有非隐藏文件夹(包括空文件夹),让用户看到完整目录结构
        nodes.push(VaultNode {
            name,
            path: rel,
            is_dir: true,
            children: Some(children),
        });
    }

    for f in files {
        let name = file_name_display(&f);
        let rel = relative_path(&f, root)?;
        nodes.push(VaultNode {
            name,
            path: rel,
            is_dir: false,
            children: None,
        });
    }

    Ok(nodes)
}

/// 判断是否为 markdown 文件
fn is_markdown_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// 提取路径末尾文件名(小写,用于排序比较)
/// Path::file_name() 返回 Option<&OsStr>,此处统一解包为 &str
fn file_name_lower(p: &Path) -> String {
    p.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// 提取路径末尾文件名(原始大小写,用于显示)
fn file_name_display(p: &Path) -> String {
    p.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

/// 计算相对路径(用 / 分隔)
fn relative_path(p: &Path, root: &Path) -> Result<String, String> {
    let rel = p
        .strip_prefix(root)
        .map_err(|e| format!("计算相对路径失败: {}", e))?;
    // 统一用 / 分隔,跨平台一致
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// 重命名 vault 条目(文件或文件夹)
#[tauri::command]
fn rename_vault_entry(root_path: String, old_rel: String, new_rel: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let old_path = root.join(&old_rel);
    let new_path = root.join(&new_rel);

    if !old_path.exists() {
        return Err(format!("源路径不存在: {}", old_path.display()));
    }
    // 确保新路径的父目录存在
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(())
}

/// 删除 vault 条目(文件或空文件夹)
/// 安全限制:仅允许删除 vault 内的文件或空文件夹
#[tauri::command]
fn delete_vault_entry(root_path: String, rel: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let target = root.join(&rel);

    if !target.exists() {
        return Err(format!("路径不存在: {}", target.display()));
    }

    // 安全检查:target 必须在 root 内
    let target_canonical = target
        .canonicalize()
        .map_err(|e| format!("规范化路径失败: {}", e))?;
    let root_canonical = root
        .canonicalize()
        .map_err(|e| format!("规范化根路径失败: {}", e))?;
    if !target_canonical.starts_with(&root_canonical) {
        return Err("拒绝删除 vault 外的文件".to_string());
    }

    if target.is_file() {
        fs::remove_file(&target).map_err(|e| format!("删除文件失败: {}", e))?;
    } else if target.is_dir() {
        // 仅允许删除空文件夹(避免误删大量文件)
        let count = fs::read_dir(&target)
            .map_err(|e| format!("读取目录失败: {}", e))?
            .count();
        if count > 0 {
            return Err("仅允许删除空文件夹".to_string());
        }
        fs::remove_dir(&target).map_err(|e| format!("删除文件夹失败: {}", e))?;
    }
    Ok(())
}

/// 在 vault 内创建新文件
#[tauri::command]
fn create_vault_file(root_path: String, rel: String, content: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let target = root.join(&rel);

    if target.exists() {
        return Err(format!("文件已存在: {}", target.display()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    let mut file = File::create(&target).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/// 在 vault 内创建文件夹
#[tauri::command]
fn create_vault_dir(root_path: String, rel: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let target = root.join(&rel);
    if target.exists() {
        return Err(format!("文件夹已存在: {}", target.display()));
    }
    fs::create_dir_all(&target).map_err(|e| format!("创建文件夹失败: {}", e))?;
    Ok(())
}

/// 将图片二进制数据写入"文档所在目录/assets/",返回相对路径(相对文档目录)
/// data: 原始字节,ext: 扩展名(无点)
/// file_rel_path: 当前文档相对 vault 根的路径(用 / 分隔),用于定位所在目录
#[tauri::command]
fn write_image_to_vault(
    root_path: String,
    file_rel_path: String,
    data: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let root = Path::new(&root_path);
    // 算出文档所在目录(空则落到 vault 根)
    let dir = std::path::Path::new(&file_rel_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let assets_dir = if dir.is_empty() {
        root.join("assets")
    } else {
        root.join(&dir).join("assets")
    };
    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| format!("创建 assets 目录失败: {}", e))?;
    }
    let ts = chrono::Utc::now().timestamp_millis();
    let dest_name = format!("paste_{}.{}", ts, ext);
    let dest_abs = assets_dir.join(&dest_name);
    let mut file = File::create(&dest_abs).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&data).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(format!("assets/{}", dest_name))
}

/// 弹出文件选择器选图片,复制到"文档所在目录/assets/",返回相对路径(相对文档目录)
#[tauri::command]
fn pick_image_to_vault(
    app: tauri::AppHandle,
    root_path: String,
    file_rel_path: String,
) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .set_title("选择图片")
        .add_filter("图片", &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"])
        .blocking_pick_file();

    let selected = match file_path {
        Some(fp) => fp.simplified().to_string(),
        None => return Ok(None),
    };

    let src = Path::new(&selected);
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();

    // 读取源文件
    let mut file = File::open(src).map_err(|e| format!("打开源文件失败: {}", e))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)
        .map_err(|e| format!("读取源文件失败: {}", e))?;

    // 写入"文档所在目录/assets/"
    let root = Path::new(&root_path);
    let dir = std::path::Path::new(&file_rel_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let assets_dir = if dir.is_empty() {
        root.join("assets")
    } else {
        root.join(&dir).join("assets")
    };
    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| format!("创建 assets 目录失败: {}", e))?;
    }
    // 保留原文件名,加时间戳防重名
    let original_name = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let ts = chrono::Utc::now().timestamp_millis();
    let dest_name = format!("{}_{}.{}", original_name, ts, ext);
    let dest_abs = assets_dir.join(&dest_name);
    let mut dest_file = File::create(&dest_abs).map_err(|e| format!("创建文件失败: {}", e))?;
    dest_file
        .write_all(&data)
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(Some(format!("assets/{}", dest_name)))
}

/// 在系统默认浏览器中打开外部 URL
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    Ok(())
}

/// 保存 AI 设置 JSON 到 ~/.unidoc/settings.json
#[tauri::command]
fn save_settings(json: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let dir = home.join(".unidoc");
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let file_path = dir.join("settings.json");
    fs::write(&file_path, json).map_err(|e| format!("写入配置文件失败: {}", e))?;
    Ok(())
}

/// 读取 ~/.unidoc/settings.json,不存在返回空字符串
#[tauri::command]
fn load_settings() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let file_path = home.join(".unidoc").join("settings.json");
    if !file_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&file_path).map_err(|e| format!("读取配置文件失败: {}", e))
}

/// 保存 AI 对话历史 JSON 到 ~/.unidoc/ai_history.json
#[tauri::command]
fn save_ai_history(json: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let dir = home.join(".unidoc");
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let file_path = dir.join("ai_history.json");
    fs::write(&file_path, json).map_err(|e| format!("写入对话历史失败: {}", e))?;
    Ok(())
}

/// 读取 ~/.unidoc/ai_history.json,不存在返回空字符串
#[tauri::command]
fn load_ai_history() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let file_path = home.join(".unidoc").join("ai_history.json");
    if !file_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&file_path).map_err(|e| format!("读取对话历史失败: {}", e))
}

/// 清除 ~/.unidoc/ai_history.json
#[tauri::command]
fn clear_ai_history() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let file_path = home.join(".unidoc").join("ai_history.json");
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("删除对话历史失败: {}", e))?;
    }
    Ok(())
}

/// 从 ZIP 中读取指定条目为字符串
fn read_zip_entry<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| format!("ZIP 中未找到 {}: {}", name, e))?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| format!("读取 {} 失败: {}", name, e))?;
    Ok(buf)
}

/// 将 JSON 字符串美化输出(pretty print)
/// 与前端 JSON.stringify(obj, null, 2) 一致
fn prettify_json(json_str: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;
    serde_json::to_string_pretty(&value).map_err(|e| format!("序列化 JSON 失败: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_md_file,
            load_md_file,
            save_md_dialog,
            open_md_dialog,
            save_uni_doc,
            load_uni_doc,
            save_uni_doc_dialog,
            open_uni_doc_dialog,
            pick_vault_folder,
            read_vault_tree,
            rename_vault_entry,
            delete_vault_entry,
            create_vault_file,
            create_vault_dir,
            write_image_to_vault,
            pick_image_to_vault,
            open_external_url,
            save_settings,
            load_settings,
            save_ai_history,
            load_ai_history,
            clear_ai_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
