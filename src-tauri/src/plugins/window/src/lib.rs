use tauri::{generate_handler, plugin::Builder, plugin::TauriPlugin, Runtime};

mod commands;

pub use commands::*;
pub use commands::{toggle_window, WindowState};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-window")
        .invoke_handler(generate_handler![
            commands::toggle_window,
            commands::show_taskbar_icon,
            commands::apply_mica_effect,
            commands::clear_mica_effect,
            commands::is_mica_supported,
            commands::create_window,
            commands::exit_app, // Internal: only for tray plugin
            commands::set_window_always_on_top,
        ])
        .build()
}
