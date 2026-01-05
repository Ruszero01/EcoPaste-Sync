use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;

pub use commands::*;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-window")
        .invoke_handler(generate_handler![
            commands::show_window,
            commands::show_window_with_position,
            commands::destroy_window,
            commands::show_taskbar_icon,
            commands::show_main_window,
            commands::show_preference_window,
            commands::apply_mica_effect,
            commands::clear_mica_effect,
            commands::is_mica_supported,
            commands::create_window,
        ])
        .build()
}
