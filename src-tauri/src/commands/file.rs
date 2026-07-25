use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn save_md_file(file_path: String, content: String) -> Result<(), String> {
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

#[tauri::command]
pub fn load_md_file(file_path: String) -> Result<String, String> {
    let mut file = File::open(&file_path)
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(content)
}

#[tauri::command]
pub fn save_md_dialog(
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

#[tauri::command]
pub fn open_md_dialog(
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
