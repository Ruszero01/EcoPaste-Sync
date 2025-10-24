use super::{shared_hide_window, shared_show_window, set_window_follow_cursor};
use tauri::{command, AppHandle, Runtime, WebviewWindow};

// 显示窗口
#[command]
pub async fn show_window<R: Runtime>(_app_handle: AppHandle<R>, window: WebviewWindow<R>) {
    shared_show_window(&window);
}

// 显示窗口并设置位置
#[command]
pub async fn show_window_with_position<R: Runtime>(
    _app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    position: String,
) {
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

    shared_show_window(&window);
}

// 隐藏窗口
#[command]
pub async fn hide_window<R: Runtime>(_app_handle: AppHandle<R>, window: WebviewWindow<R>) {
    shared_hide_window(&window);
}

// 显示任务栏图标
#[command]
pub async fn show_taskbar_icon<R: Runtime>(
    _app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    visible: bool,
) {
    let _ = window.set_skip_taskbar(!visible);
}
