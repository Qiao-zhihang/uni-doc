use std::path::{Path, PathBuf};

pub fn is_markdown_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

pub fn is_vault_file(name: &str) -> bool {
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

pub fn file_name_lower(p: &Path) -> String {
    p.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
}

pub fn file_name_display(p: &Path) -> String {
    p.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

pub fn relative_path(p: &Path, root: &Path) -> Result<String, String> {
    let rel = p
        .strip_prefix(root)
        .map_err(|e| format!("计算相对路径失败: {}", e))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

pub fn ensure_within_vault(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("无效的 vault 根路径: {}", e))?;
    let target_canon = target.canonicalize().or_else(|_| {
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

pub fn sanitize_ext(ext: &str) -> String {
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

pub fn sanitize_file_name(name: &str) -> String {
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
