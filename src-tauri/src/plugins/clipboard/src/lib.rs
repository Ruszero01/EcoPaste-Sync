use commands::ClipboardManager;
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Listener, Manager, Runtime,
};

mod commands;

pub use commands::is_listen_enabled;
pub use commands::play_copy_audio;
pub use commands::toggle_listen;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-clipboard")
        .setup(move |app, _api| {
            app.manage(ClipboardManager::new());

            // 监听配置变更事件，刷新配置缓存
            let app_handle = app.app_handle().clone();
            let app_handle_for_listen = app_handle.clone();
            let _unlisten = app_handle.listen("store-changed", move |_event| {
                // 通知 common 插件刷新配置缓存
                tauri_plugin_eco_common::config::refresh_config_cache(&app_handle_for_listen);
            });

            // 自动启动剪贴板监听（纯后端方案）
            if let Err(e) = commands::start_listen_inner(app) {
                log::error!("[Clipboard] 自动启动监听失败: {}", e);
            }

            Ok(())
        })
        .invoke_handler(generate_handler![
            commands::stop_listen,
            commands::has_files,
            commands::has_image,
            commands::has_html,
            commands::has_rtf,
            commands::has_text,
            commands::read_files,
            commands::read_image,
            commands::read_html,
            commands::read_rtf,
            commands::read_text,
            commands::write_files,
            commands::write_image,
            commands::write_html,
            commands::write_rtf,
            commands::write_text,
            commands::get_image_dimensions,
            commands::preview_audio,
        ])
        .build()
}
