pub mod active_window;
pub mod audio;
pub mod commands;
pub mod config;
pub mod constants;
pub mod file;
pub mod id;
pub mod paths;
pub mod server_config;
pub mod types;

use tauri::plugin::TauriPlugin;

/// 初始化 common 插件
pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    use tauri::plugin::Builder;

    Builder::new("eco-common")
        .invoke_handler(tauri::generate_handler![
            commands::get_current_window_info,
            commands::get_last_window_info,
            commands::get_foreground_window_info,
        ])
        .setup(|_app, _api| {
            active_window::start_foreground_listener();
            Ok(())
        })
        .build()
}
