// UniDoc Tauri 后端入口
// 参考 PRD §8.2(架构分层)— 后端层负责窗口/系统交互、文件 I/O(.md 读写)

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

/// 保存 .md 文件(纯文本)
#[tauri::command]
fn save_md_file(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
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
    Ok(scan_dir(&root_canonical, &root_canonical, 0, 32)?)
}

/// 递归扫描目录
/// max_depth 限制递归深度,防止过深嵌套或恶意结构
/// 跳过 symlink(不跟随),防止路径逃逸或循环
fn scan_dir(dir: &Path, root: &Path, depth: usize, max_depth: usize) -> Result<Vec<VaultNode>, String> {
    if depth >= max_depth {
        eprintln!(
            "[scan_dir] 已达最大深度 {} (路径: {}),停止递归",
            max_depth,
            dir.display()
        );
        return Ok(Vec::new());
    }

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

        // 跳过 symlink(不跟随),防止路径逃逸或循环
        // 使用 entry.file_type() 而非 path.is_dir() 以避免自动跟随 symlink
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(e) => {
                eprintln!("[scan_dir] 读取文件类型失败 ({}): {}", path.display(), e);
                continue;
            }
        };
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            dirs.push(path);
        } else if file_type.is_file() && is_vault_file(&name) {
            files.push(path);
        }
    }

    // 文件夹优先,各自按名称升序
    dirs.sort_by(|a, b| file_name_lower(a).cmp(&file_name_lower(b)));
    files.sort_by(|a, b| file_name_lower(a).cmp(&file_name_lower(b)));

    for d in dirs {
        let name = file_name_display(&d);
        let rel = relative_path(&d, root)?;
        let children = scan_dir(&d, root, depth + 1, max_depth)?;
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

/// 判断是否为 vault 中需要展示的文件(markdown + 图片)
fn is_vault_file(name: &str) -> bool {
    if is_markdown_file(name) {
        return true;
    }
    let lower = name.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".svg")
        || lower.ends_with(".bmp")
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

/// 路径逃逸校验:确保 target 在 vault 根目录内
/// 目标可能尚不存在(创建场景),此时 canonicalize 父目录后再拼接文件名
fn ensure_within_vault(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("无效的 vault 根路径: {}", e))?;
    let target_canon = target.canonicalize().or_else(|_| {
        // 目标可能尚不存在(创建场景),canonicalize 父目录
        if let Some(parent) = target.parent() {
            parent
                .canonicalize()
                .map(|p| p.join(target.file_name().unwrap_or_default()))
        } else {
            Err(std::io::Error::new(std::io::ErrorKind::NotFound, "no parent"))
        }
    }).map_err(|e| format!("无效的目标路径: {}", e))?;
    if !target_canon.starts_with(&root_canon) {
        return Err(format!("路径逃逸: {} 不在 vault 内", target.display()));
    }
    Ok(target_canon)
}

/// 校验扩展名:仅允许字母数字,非法时回退 "png"
/// 等价于正则 ^[a-zA-Z0-9]+$
fn sanitize_ext(ext: &str) -> String {
    let valid = !ext.is_empty()
        && ext
            .chars()
            .all(|c| c.is_ascii_alphanumeric());
    if valid {
        ext.to_string()
    } else {
        "png".to_string()
    }
}

/// 过滤文件名中的危险字符(`..`、`/`、`\`、`:`、`<`、`>`、`"`、`|`、`?`、`*`)
fn sanitize_file_name(name: &str) -> String {
    let mut s = name.replace("..", "");
    for c in ['/', '\\', ':', '<', '>', '"', '|', '?', '*'] {
        s = s.replace(c, "");
    }
    if s.is_empty() {
        "image".to_string()
    } else {
        s
    }
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
    // 路径逃逸校验:确保新旧路径都在 vault 内
    ensure_within_vault(root, &old_path)?;
    let new_canon = ensure_within_vault(root, &new_path)?;
    // 确保新路径的父目录存在
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    fs::rename(&old_path, &new_canon).map_err(|e| format!("重命名失败: {}", e))?;
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
        // TOCTOU 安全:捕获 remove_dir 错误,即便 read_dir 与 remove_dir 之间状态变化也返回友好信息
        let count = fs::read_dir(&target)
            .map_err(|e| format!("读取目录失败: {}", e))?
            .count();
        if count > 0 {
            return Err("文件夹非空".to_string());
        }
        fs::remove_dir(&target).map_err(|_| "文件夹非空".to_string())?;
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
    // 路径逃逸校验
    ensure_within_vault(root, &target)?;
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
    // 路径逃逸校验
    ensure_within_vault(root, &target)?;
    fs::create_dir_all(&target).map_err(|e| format!("创建文件夹失败: {}", e))?;
    Ok(())
}

/// 创建任意目录(用于新建仓库)
#[tauri::command]
fn create_dir_at_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if target.exists() {
        return Ok(());
    }
    fs::create_dir_all(target).map_err(|e| format!("创建文件夹失败: {}", e))?;
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
    // 校验扩展名:仅允许字母数字,非法时回退 "png"
    let safe_ext = sanitize_ext(&ext);
    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| format!("创建 assets 目录失败: {}", e))?;
    }
    // 路径逃逸校验:assets_dir 必须在 vault 内
    ensure_within_vault(root, &assets_dir)?;
    let ts = chrono::Utc::now().timestamp_millis();
    let dest_name = format!("paste_{}.{}", ts, safe_ext);
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
    let raw_ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();
    // 校验扩展名:仅允许字母数字,非法时回退 "png"
    let safe_ext = sanitize_ext(&raw_ext);

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
    // 路径逃逸校验:assets_dir 必须在 vault 内
    ensure_within_vault(root, &assets_dir)?;
    // 保留原文件名,加时间戳防重名;对 original_name 做 sanitize
    let original_name_raw = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let original_name = sanitize_file_name(&original_name_raw);
    let ts = chrono::Utc::now().timestamp_millis();
    let dest_name = format!("{}_{}.{}", original_name, ts, safe_ext);
    let dest_abs = assets_dir.join(&dest_name);
    let mut dest_file = File::create(&dest_abs).map_err(|e| format!("创建文件失败: {}", e))?;
    dest_file
        .write_all(&data)
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(Some(format!("assets/{}", dest_name)))
}

/// 在系统默认浏览器中打开外部 URL
/// 安全限制:仅允许 http:// 或 https:// 协议,防止 file://、javascript:、cmd 等注入
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    // 协议白名单校验:必须以 http:// 或 https:// 开头(大小写不敏感)
    let lower = url.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err(format!("仅允许 http/https 协议: {}", url));
    }
    #[cfg(target_os = "windows")]
    {
        // 改用 explorer 打开 URL,绕开 cmd.exe,避免命令注入风险
        std::process::Command::new("explorer")
            .arg(&url)
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

/// 保存 AI 会话列表 JSON 到 ~/.unidoc/ai_conversations.json
#[tauri::command]
fn save_ai_conversations(json: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let dir = home.join(".unidoc");
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let file_path = dir.join("ai_conversations.json");
    fs::write(&file_path, json).map_err(|e| format!("写入会话数据失败: {}", e))?;
    Ok(())
}

/// 读取 ~/.unidoc/ai_conversations.json,不存在返回空字符串
#[tauri::command]
fn load_ai_conversations() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let file_path = home.join(".unidoc").join("ai_conversations.json");
    if !file_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&file_path).map_err(|e| format!("读取会话数据失败: {}", e))
}

/// 保存 AI 全局记忆 JSON 到 ~/.unidoc/ai_memory.json
#[tauri::command]
fn save_ai_memory(json: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let dir = home.join(".unidoc");
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let file_path = dir.join("ai_memory.json");
    fs::write(&file_path, json).map_err(|e| format!("写入记忆数据失败: {}", e))?;
    Ok(())
}

/// 读取 ~/.unidoc/ai_memory.json,不存在返回空字符串
#[tauri::command]
fn load_ai_memory() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let file_path = home.join(".unidoc").join("ai_memory.json");
    if !file_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&file_path).map_err(|e| format!("读取记忆数据失败: {}", e))
}

/// 联网搜索：使用 Bing 搜索，国内连通性好，绕过 CORS
/// 返回搜索结果的纯文本摘要
#[tauri::command]
fn web_search(query: String) -> Result<String, String> {
    use html_escape::decode_html_entities;
    let url = format!(
        "https://www.bing.com/search?q={}&setlang=zh-CN",
        urlencoding::encode(&query)
    );
    let resp = ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| format!("搜索请求失败: {}", e))?;
    let html = resp.into_string().map_err(|e| format!("读取响应失败: {}", e))?;

    let mut results: Vec<(String, String, String)> = Vec::new();

    // 找到搜索结果容器 id="b_results"
    let start_pos = match html.find(r#"id="b_results""#) {
        Some(i) => i,
        None => return Ok("未找到相关搜索结果。".to_string()),
    };

    // 解析 Bing 搜索结果:
    // 每个结果在 <li class="b_algo"> 中
    // 标题: <h2><a>...</a></h2>
    // 链接: h2 内 a 标签的 href
    // 摘要: <div class="b_caption"> 内的 <p> 标签
    let mut pos = start_pos;
    while let Some(idx) = html[pos..].find(r#"<li class="b_algo""#) {
        let li_start = pos + idx;
        // 找到 <li 标签结束位置
        let li_tag_end = match html[li_start..].find('>') {
            Some(i) => li_start + i + 1,
            None => { pos = li_start + 20; continue; }
        };
        // 查找下一个 <li class="b_algo" 作为当前结果的大致结束点
        let next_li = html[li_tag_end..]
            .find(r#"<li class="b_algo""#)
            .map_or(html.len(), |i| li_tag_end + i);
        let chunk = &html[li_tag_end..next_li];
        pos = next_li;

        // 提取标题和链接: 在 <h2> 标签内的 <a> 中
        let (title, link) = if let Some(h2_start) = chunk.find("<h2") {
            let h2_end = match chunk[h2_start..].find("</h2>") {
                Some(i) => h2_start + i,
                None => { continue; }
            };
            let h2_html = &chunk[h2_start..h2_end];
            // 找 <a 标签
            if let Some(a_start) = h2_html.find("<a") {
                // 找 href
                let href = if let Some(href_idx) = h2_html[a_start..].find(r#"href=""#) {
                    let href_val_start = a_start + href_idx + 6;
                    let href_val_end = match h2_html[href_val_start..].find('"') {
                        Some(i) => href_val_start + i,
                        None => { continue; }
                    };
                    h2_html[href_val_start..href_val_end].to_string()
                } else {
                    continue;
                };
                // 找 a 标签文本内容
                let a_text = if let Some(a_open_end) = h2_html[a_start..].find('>') {
                    let text_start = a_start + a_open_end + 1;
                    let text_end = match h2_html[text_start..].find("</a>") {
                        Some(i) => text_start + i,
                        None => { continue; }
                    };
                    let raw = &h2_html[text_start..text_end];
                    // 移除嵌套的 HTML 标签（如 <strong> 等）
                    let cleaned = strip_html_tags(raw);
                    decode_html_entities(&cleaned).to_string()
                } else {
                    continue;
                };
                (a_text, href)
            } else {
                continue;
            }
        } else {
            continue;
        };

        let snippet = if let Some(cap_start) = chunk.find(r#"class="b_caption""#) {
            let cap_tag_start = match chunk[..cap_start].rfind('<') {
                Some(i) => i,
                None => continue,
            };
            let cap_chunk = &chunk[cap_tag_start..];
            if let Some(p_start) = cap_chunk.find("<p") {
                let p_open_end = match cap_chunk[p_start..].find('>') {
                    Some(i) => p_start + i + 1,
                    None => continue,
                };
                let p_end = match cap_chunk[p_open_end..].find("</p>") {
                    Some(i) => p_open_end + i,
                    None => cap_chunk.len(),
                };
                let raw = &cap_chunk[p_open_end..p_end];
                let cleaned = strip_html_tags(raw);
                decode_html_entities(&cleaned).to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        results.push((title, link, snippet));
        if results.len() >= 10 { break; }
    }

    if results.is_empty() {
        return Ok("未找到相关搜索结果。".to_string());
    }

    let mut output = String::new();
    output.push_str(&format!("搜索关键词: {}\n\n", query));
    for (i, (title, link, snippet)) in results.iter().enumerate() {
        output.push_str(&format!("{}. {}\n", i + 1, title));
        if !snippet.is_empty() {
            output.push_str(&format!("   {}\n", snippet));
        }
        output.push_str(&format!("   {}\n\n", link));
    }

    Ok(output)
}

/// 移除字符串中的 HTML 标签
fn strip_html_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(c),
            _ => {}
        }
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = tauri::Builder::default()
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
            pick_vault_folder,
            read_vault_tree,
            rename_vault_entry,
            delete_vault_entry,
            create_vault_file,
            create_vault_dir,
            create_dir_at_path,
            write_image_to_vault,
            pick_image_to_vault,
            open_external_url,
            save_settings,
            load_settings,
            save_ai_history,
            load_ai_history,
            clear_ai_history,
            save_ai_conversations,
            load_ai_conversations,
            save_ai_memory,
            load_ai_memory,
            web_search,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauri 启动失败: {}", e);
        std::process::exit(1);
    }
}
