use tauri::plugin::{Builder, TauriPlugin};

pub use commands::*;

mod commands;

pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-hotkey")
        .invoke_handler(tauri::generate_handler![
            commands::register_shortcut,
            commands::unregister_shortcut,
            commands::unregister_all_shortcuts,
            commands::register_default_shortcuts,
            commands::register_all_shortcuts,
            commands::get_shortcut_state,
        ])
        .build()
}
