use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

use crate::utils::path::{ensure_within_vault, sanitize_ext, sanitize_file_name};

#[tauri::command]
pub fn write_image_to_vault(
    root_path: String,
    file_rel_path: String,
    data: Vec<u8>,
    ext: String,
) -> Result<String, String> {
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
    let safe_ext = sanitize_ext(&ext);
    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| format!("创建 assets 目录失败: {}", e))?;
    }
    ensure_within_vault(root, &assets_dir)?;
    let ts = chrono::Utc::now().timestamp_millis();
    let dest_name = format!("paste_{}.{}", ts, safe_ext);
    let dest_abs = assets_dir.join(&dest_name);
    let mut file = File::create(&dest_abs).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&data).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(format!("assets/{}", dest_name))
}

#[tauri::command]
pub fn pick_image_to_vault(
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
    let safe_ext = sanitize_ext(&raw_ext);

    let mut file = File::open(src).map_err(|e| format!("打开源文件失败: {}", e))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)
        .map_err(|e| format!("读取源文件失败: {}", e))?;

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
    ensure_within_vault(root, &assets_dir)?;
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
