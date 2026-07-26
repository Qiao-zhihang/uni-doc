// UniDoc Tauri 后端入口
// 参考 PRD §8.2(架构分层)— 后端层负责窗口/系统交互、文件 I/O(.md 读写)

mod commands;
mod utils;

pub use commands::vault::VaultNode;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(level)
                    .build(),
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::file::save_md_file,
            commands::file::load_md_file,
            commands::file::save_md_dialog,
            commands::file::open_md_dialog,
            commands::vault::pick_vault_folder,
            commands::vault::read_vault_tree,
            commands::vault::rename_vault_entry,
            commands::vault::delete_vault_entry,
            commands::vault::create_vault_file,
            commands::vault::create_vault_dir,
            commands::vault::create_dir_at_path,
            commands::image::write_image_to_vault,
            commands::image::pick_image_to_vault,
            commands::shell::open_external_url,
            commands::settings::save_settings,
            commands::settings::load_settings,
            commands::settings::save_ai_history,
            commands::settings::load_ai_history,
            commands::settings::clear_ai_history,
            commands::settings::save_ai_conversations,
            commands::settings::load_ai_conversations,
            commands::settings::save_ai_memory,
            commands::settings::load_ai_memory,
            commands::settings::save_reminders,
            commands::settings::load_reminders,
            commands::search::web_search,
        ])
        .run(tauri::generate_context!())
    {
        log::error!("Tauri 启动失败: {}", e);
        std::process::exit(1);
    }
}
