use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{generate_handler, plugin::Builder, plugin::TauriPlugin, Runtime};

mod commands;

pub use commands::*;

/// 全局窗口自动回收状态
static AUTO_RECYCLE_TIMERS: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, std::thread::JoinHandle<()>>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 获取自动回收计时器状态
pub fn get_auto_recycle_timers() -> Arc<Mutex<HashMap<String, std::thread::JoinHandle<()>>>> {
    AUTO_RECYCLE_TIMERS.clone()
}

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
            commands::hide_window_with_behavior,
            commands::cancel_auto_recycle,
        ])
        .build()
}
