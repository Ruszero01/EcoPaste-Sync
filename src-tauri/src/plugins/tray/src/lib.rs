use tauri::{generate_handler, plugin::Builder, Runtime};

mod commands;

pub use commands::*;

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    Builder::new("eco-tray")
        .invoke_handler(generate_handler![
            commands::create_tray,
            commands::destroy_tray,
            commands::update_tray_menu,
        ])
        .build()
}
