use super::{is_main_window, shared_hide_window, shared_show_window, set_window_follow_cursor};
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

// 隐藏窗口
#[command]
pub async fn hide_window<R: Runtime>(app_handle: AppHandle<R>, window: WebviewWindow<R>) {
    if is_main_window(&window) {
        set_macos_panel(&app_handle, &window, MacOSPanelStatus::Hide);
    } else {
        shared_hide_window(&window);
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
