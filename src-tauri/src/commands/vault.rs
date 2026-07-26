use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

use crate::utils::path::{
    ensure_within_vault, file_name_display, file_name_lower, is_vault_file, relative_path,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<VaultNode>>,
}

#[tauri::command]
pub fn pick_vault_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
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

#[tauri::command]
pub fn read_vault_tree(root_path: String) -> Result<Vec<VaultNode>, String> {
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
    scan_dir(&root_canonical, &root_canonical, 0, 32)
}

fn scan_dir(dir: &Path, root: &Path, depth: usize, max_depth: usize) -> Result<Vec<VaultNode>, String> {
    if depth >= max_depth {
        log::warn!(
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

        if name.starts_with('.') {
            continue;
        }
        if name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(e) => {
                log::warn!("[scan_dir] 读取文件类型失败 ({}): {}", path.display(), e);
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

    dirs.sort_by_key(|a| file_name_lower(a));
    files.sort_by_key(|a| file_name_lower(a));

    for d in dirs {
        let name = file_name_display(&d);
        let rel = relative_path(&d, root)?;
        let children = scan_dir(&d, root, depth + 1, max_depth)?;
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

#[tauri::command]
pub fn rename_vault_entry(root_path: String, old_rel: String, new_rel: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let old_path = root.join(&old_rel);
    let new_path = root.join(&new_rel);

    if !old_path.exists() {
        return Err(format!("源路径不存在: {}", old_path.display()));
    }
    ensure_within_vault(root, &old_path)?;
    let new_canon = ensure_within_vault(root, &new_path)?;
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    fs::rename(&old_path, &new_canon).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_vault_entry(root_path: String, rel: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let target = root.join(&rel);

    if !target.exists() {
        return Err(format!("路径不存在: {}", target.display()));
    }

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

#[tauri::command]
pub fn create_vault_file(root_path: String, rel: String, content: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let target = root.join(&rel);

    if target.exists() {
        return Err(format!("文件已存在: {}", target.display()));
    }
    ensure_within_vault(root, &target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    let mut file = File::create(&target).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn create_vault_dir(root_path: String, rel: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let target = root.join(&rel);
    if target.exists() {
        return Err(format!("文件夹已存在: {}", target.display()));
    }
    ensure_within_vault(root, &target)?;
    fs::create_dir_all(&target).map_err(|e| format!("创建文件夹失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn create_dir_at_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if target.exists() {
        return Ok(());
    }
    fs::create_dir_all(target).map_err(|e| format!("创建文件夹失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn plugin_dir_exists(path: String) -> bool {
    Path::new(&path).exists() && Path::new(&path).is_dir()
}

#[derive(serde::Serialize)]
pub struct PluginDirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn list_plugin_dirs(path: String) -> Result<Vec<PluginDirEntry>, String> {
    let dir = Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;
    let mut result: Vec<PluginDirEntry> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        result.push(PluginDirEntry {
            name,
            is_dir: file_type.is_dir(),
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn write_plugin_data(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }
    let mut file = File::create(target).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn read_plugin_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取插件文件失败 {}: {}", path, e))
}
