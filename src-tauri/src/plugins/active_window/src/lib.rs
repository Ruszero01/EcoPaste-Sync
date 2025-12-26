use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;

pub use commands::get_active_window_process;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-active-window").build()
}
