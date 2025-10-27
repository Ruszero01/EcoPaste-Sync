use tauri::{async_runtime::spawn, AppHandle, Manager, Runtime, WebviewWindow};

// 主窗口的label
pub static MAIN_WINDOW_LABEL: &str = "main";
// 偏好设置窗口的label
pub static PREFERENCE_WINDOW_LABEL: &str = "preference";
// 主窗口的title
pub static MAIN_WINDOW_TITLE: &str = "EcoPaste";

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod not_macos;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub use not_macos::*;

#[cfg(target_os = "macos")]
use crate::plugins::window::commands::macos::{MacOSPanelStatus, set_macos_panel};

// 是否为主窗口
pub fn is_main_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    window.label() == MAIN_WINDOW_LABEL
}

// 共享显示窗口的方法
fn shared_show_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

// 设置窗口位置为跟随鼠标（支持多显示器环境）
pub fn set_window_follow_cursor<R: Runtime>(window: &WebviewWindow<R>) {
    use tauri::{Manager, Position, PhysicalPosition};

    if let Ok(cursor_pos) = window.app_handle().cursor_position() {
        // 获取窗口大小信息
        let mut window_width = 400; // 默认宽度
        let mut window_height = 600; // 默认高度

        if let Ok(size) = window.inner_size() {
            window_width = size.width;
            window_height = size.height;
        }

        // 查找鼠标所在的显示器
        let target_monitor = find_monitor_at_position(&window.app_handle(), cursor_pos.x, cursor_pos.y);

        if let Some(monitor) = target_monitor {
            // 在找到的显示器内计算安全的窗口位置
            let (final_x, final_y) = calculate_safe_position_in_monitor(
                cursor_pos.x as i32,
                cursor_pos.y as i32,
                window_width,
                window_height,
                &monitor,
            );

            let pos = PhysicalPosition { x: final_x, y: final_y };
            let _ = window.set_position(Position::Physical(pos));
        } else {
            // 如果找不到合适的显示器，使用原始位置
            let pos = PhysicalPosition {
                x: cursor_pos.x as i32,
                y: cursor_pos.y as i32
            };
            let _ = window.set_position(Position::Physical(pos));
        }
    }
}

// 查找指定位置所在的显示器
fn find_monitor_at_position<R: Runtime>(app_handle: &AppHandle<R>, x: f64, y: f64) -> Option<tauri::Monitor> {
    if let Ok(monitors) = app_handle.available_monitors() {
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();

            // 检查鼠标位置是否在当前显示器范围内
            let monitor_left = pos.x as f64;
            let monitor_top = pos.y as f64;
            let monitor_right = monitor_left + size.width as f64;
            let monitor_bottom = monitor_top + size.height as f64;

            if x >= monitor_left && x < monitor_right && y >= monitor_top && y < monitor_bottom {
                return Some(monitor);
            }
        }
    }
    None
}

// 在指定显示器内计算安全的窗口位置
fn calculate_safe_position_in_monitor(
    mouse_x: i32,
    mouse_y: i32,
    window_width: u32,
    window_height: u32,
    monitor: &tauri::Monitor,
) -> (i32, i32) {
    let window_w = window_width as i32;
    let window_h = window_height as i32;

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();

    let monitor_left = monitor_pos.x;
    let monitor_top = monitor_pos.y;
    let monitor_right = monitor_left + monitor_size.width as i32;
    let monitor_bottom = monitor_top + monitor_size.height as i32;

    // 计算目标位置（鼠标位置作为窗口的左上角）
    let target_x = mouse_x;
    let target_y = mouse_y;

    // 确保窗口不会超出显示器右边界
    let safe_x = if target_x + window_w > monitor_right {
        (monitor_right - window_w).max(monitor_left)
    } else {
        target_x
    };

    // 确保窗口不会超出显示器底部边界
    let safe_y = if target_y + window_h > monitor_bottom {
        (monitor_bottom - window_h).max(monitor_top)
    } else {
        target_y
    };

    // 确保窗口不会超出显示器左边界和顶部边界
    let final_x = safe_x.max(monitor_left);
    let final_y = safe_y.max(monitor_top);

    (final_x, final_y)
}

// 共享隐藏窗口的方法
fn shared_hide_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.hide();
}

// 显示主窗口
#[tauri::command]
pub async fn show_main_window<R: Runtime>(app_handle: AppHandle<R>) {
    show_window_by_label(&app_handle, MAIN_WINDOW_LABEL);
}

// 显示偏好设置窗口
#[tauri::command]
pub async fn show_preference_window<R: Runtime>(app_handle: AppHandle<R>) {
    show_window_by_label(&app_handle, PREFERENCE_WINDOW_LABEL);
}

// 显示指定 label 的窗口
fn show_window_by_label<R: Runtime>(app_handle: &AppHandle<R>, label: &str) {
    if let Some(window) = app_handle.get_webview_window(label) {
        let _app_handle_clone = app_handle.clone();
        let _label_clone = label.to_string();

        spawn(async move {
            #[cfg(target_os = "macos")]
            {
                if is_main_window(&window) {
                    set_macos_panel(&app_handle_clone, &window, MacOSPanelStatus::Show);
                } else {
                    shared_show_window(&window);
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                shared_show_window(&window);
            }
        });
    }
}
