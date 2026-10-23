use std::fs;

fn unidoc_dir() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    Ok(home.join(".unidoc"))
}

fn write_json_file(name: &str, json: &str, err_prefix: &str) -> Result<(), String> {
    let dir = unidoc_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let file_path = dir.join(name);
    fs::write(&file_path, json).map_err(|e| format!("{}: {}", err_prefix, e))
}

/// 原子写入：先写入同目录下的临时文件，再重命名覆盖目标文件，
/// 避免写入过程中崩溃导致 JSON 数据损坏。
fn write_json_file_atomic(name: &str, json: &str, err_prefix: &str) -> Result<(), String> {
    let dir = unidoc_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let file_path = dir.join(name);
    let tmp_path = dir.join(format!("{}.tmp", name));
    if let Err(e) = fs::write(&tmp_path, json) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("{}: {}", err_prefix, e));
    }
    // Windows 下 rename 不会覆盖已存在的目标文件，需先删除旧文件。
    if file_path.exists() {
        if let Err(e) = fs::remove_file(&file_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("{}: {}", err_prefix, e));
        }
    }
    if let Err(e) = fs::rename(&tmp_path, &file_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("{}: {}", err_prefix, e));
    }
    Ok(())
}

fn read_json_file(name: &str, err_prefix: &str) -> Result<String, String> {
    let file_path = unidoc_dir()?.join(name);
    if !file_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&file_path).map_err(|e| format!("{}: {}", err_prefix, e))
}

#[tauri::command]
pub fn save_settings(json: String) -> Result<(), String> {
    write_json_file("settings.json", &json, "写入配置文件失败")
}

#[tauri::command]
pub fn load_settings() -> Result<String, String> {
    read_json_file("settings.json", "读取配置文件失败")
}

#[tauri::command]
pub fn save_ai_history(json: String) -> Result<(), String> {
    write_json_file("ai_history.json", &json, "写入对话历史失败")
}

#[tauri::command]
pub fn load_ai_history() -> Result<String, String> {
    read_json_file("ai_history.json", "读取对话历史失败")
}

#[tauri::command]
pub fn clear_ai_history() -> Result<(), String> {
    let file_path = unidoc_dir()?.join("ai_history.json");
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("删除对话历史失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_ai_conversations(json: String) -> Result<(), String> {
    write_json_file("ai_conversations.json", &json, "写入会话数据失败")
}

#[tauri::command]
pub fn load_ai_conversations() -> Result<String, String> {
    read_json_file("ai_conversations.json", "读取会话数据失败")
}

#[tauri::command]
pub fn save_ai_memory(json: String) -> Result<(), String> {
    write_json_file_atomic("ai_memory.json", &json, "写入记忆数据失败")
}

#[tauri::command]
pub fn save_ai_memory_backup(json: String) -> Result<(), String> {
    write_json_file_atomic("ai_memory.backup.json", &json, "写入记忆备份失败")
}

#[tauri::command]
pub fn load_ai_memory() -> Result<String, String> {
    read_json_file("ai_memory.json", "读取记忆数据失败")
}

#[tauri::command]
pub fn save_reminders(json: String) -> Result<(), String> {
    write_json_file("reminders.json", &json, "写入提醒数据失败")
}

#[tauri::command]
pub fn load_reminders() -> Result<String, String> {
    read_json_file("reminders.json", "读取提醒数据失败")
}
