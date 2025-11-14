use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
};

mod commands;

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("eco-auto-sync")
        .invoke_handler(generate_handler![
            commands::start_auto_sync,
            commands::stop_auto_sync,
            commands::get_auto_sync_status,
            commands::update_sync_interval,
        ])
        .build()
}