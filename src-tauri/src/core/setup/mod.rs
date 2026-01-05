use tauri::{AppHandle, WebviewWindow};

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "linux")]
pub use linux::*;

pub fn default(
    app_handle: &AppHandle,
    main_window: Option<WebviewWindow>,
    preference_window: Option<WebviewWindow>,
) {
    // 如果窗口存在则执行初始化
    if let Some(main_window) = main_window {
        // 开发模式自动打开控制台：https://tauri.app/develop/debug
        #[cfg(debug_assertions)]
        main_window.open_devtools();

        platform(app_handle, main_window.clone(), preference_window);
    }
}
