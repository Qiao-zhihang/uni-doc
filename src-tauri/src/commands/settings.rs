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
    write_json_file("ai_memory.json", &json, "写入记忆数据失败")
}

#[tauri::command]
pub fn load_ai_memory() -> Result<String, String> {
    read_json_file("ai_memory.json", "读取记忆数据失败")
}
