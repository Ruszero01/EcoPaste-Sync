use commands::ClipboardManager;
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;

pub use commands::toggle_listen;
pub use commands::is_listen_enabled;
pub use commands::play_copy_audio;


pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-clipboard")
        .setup(move |app, _api| {
            app.manage(ClipboardManager::new());

            // 自动启动剪贴板监听（纯后端方案）
            if let Err(e) = commands::start_listen_inner(&app) {
                log::error!("[Clipboard] 自动启动监听失败: {}", e);
            }

            Ok(())
        })
        .invoke_handler(generate_handler![
            commands::start_listen,
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
