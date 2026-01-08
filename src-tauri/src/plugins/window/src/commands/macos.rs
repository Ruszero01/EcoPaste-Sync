use super::{is_main_window, set_window_follow_cursor, shared_hide_window, shared_show_window};
use crate::MAIN_WINDOW_LABEL;
use tauri::{command, AppHandle, Runtime, WebviewWindow};
use tauri_nspanel::ManagerExt;

pub enum MacOSPanelStatus {
    Show,
    Hide,
    Resign,
}

// 显示窗口
#[command]
pub async fn show_window<R: Runtime>(app_handle: AppHandle<R>, window: WebviewWindow<R>) {
    if is_main_window(&window) {
        set_macos_panel(&app_handle, &window, MacOSPanelStatus::Show);
    } else {
        shared_show_window(&window);
    }
}

// 显示窗口并设置位置
#[command]
pub async fn show_window_with_position<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    position: String,
) {
    // 根据位置设置调整窗口位置
    match position.as_str() {
        "follow" => {
            // 跟随鼠标位置
            set_window_follow_cursor(&window);
        }
        "center" => {
            // 居中显示，不设置特定位置
            // 让窗口使用默认居中位置
        }
        "remember" => {
            // 记住位置，在 restoreState 中已处理
        }
        _ => {
            // 默认行为
        }
    }

    // 然后显示窗口
    if is_main_window(&window) {
        set_macos_panel(&app_handle, &window, MacOSPanelStatus::Show);
    } else {
        shared_show_window(&window);
    }
}

// 隐藏窗口（轻量模式：当所有窗口都隐藏时，关闭最后一个窗口会销毁所有窗口）
#[command]
pub async fn hide_window<R: Runtime>(app_handle: AppHandle<R>, window: WebviewWindow<R>) {
    let current_label = window.label().to_string();

    // 获取所有窗口，检查是否有其他可见窗口
    let windows = app_handle.webview_windows();
    let other_windows: Vec<_> = windows
        .iter()
        .filter(|(label, _)| label.as_str() != current_label)
        .collect();

    let has_other_visible_window = other_windows
        .iter()
        .any(|(_, w)| w.is_visible().unwrap_or(false));

    if has_other_visible_window {
        // 还有其他窗口打开，只隐藏当前窗口
        if is_main_window(&window) {
            set_macos_panel(&app_handle, &window, MacOSPanelStatus::Hide);
        } else {
            shared_hide_window(&window);
        }
    } else {
        // 当前是最后一个可见窗口，隐藏当前窗口 + 隐藏所有其他已隐藏的窗口
        for (label, _) in other_windows {
            if label == MAIN_WINDOW_LABEL {
                if let Some(panel) = app_handle.get_webview_panel(label) {
                    panel.order_out(None);
                    log::info!("[Window] 隐藏已隐藏窗口: {}", label);
                }
            }
        }
        // 隐藏当前窗口
        if is_main_window(&window) {
            set_macos_panel(&app_handle, &window, MacOSPanelStatus::Hide);
        } else {
            shared_hide_window(&window);
        }
    }
}

// 显示任务栏图标
#[command]
pub async fn show_taskbar_icon<R: Runtime>(
    app_handle: AppHandle<R>,
    _window: WebviewWindow<R>,
    visible: bool,
) {
    let _ = app_handle.set_dock_visibility(visible);
}

// 设置 macos 的 ns_panel 的状态
pub fn set_macos_panel<R: Runtime>(
    app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
    status: MacOSPanelStatus,
) {
    if is_main_window(window) {
        let app_handle_clone = app_handle.clone();

        let _ = app_handle.run_on_main_thread(move || {
            if let Ok(panel) = app_handle_clone.get_webview_panel(MAIN_WINDOW_LABEL) {
                match status {
                    MacOSPanelStatus::Show => {
                        panel.show();
                    }
                    MacOSPanelStatus::Hide => {
                        panel.order_out(None);
                    }
                    MacOSPanelStatus::Resign => {
                        panel.resign_key_window();
                    }
                }
            }
        });
    }
}

// macOS 不支持 Mica 效果的占位实现
#[command]
pub async fn apply_mica_effect<R: Runtime>(_window: WebviewWindow<R>) -> Result<(), String> {
    Err("Mica effect is only supported on Windows".to_string())
}

#[command]
pub async fn clear_mica_effect<R: Runtime>(_window: WebviewWindow<R>) -> Result<(), String> {
    Err("Mica effect is only supported on Windows".to_string())
}

#[command]
pub async fn is_mica_supported() -> bool {
    false
}
