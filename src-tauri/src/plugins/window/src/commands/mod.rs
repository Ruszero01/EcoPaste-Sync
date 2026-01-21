use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use tauri_plugin_eco_common::config::{get_nested, read_config};

// 主窗口的label
pub static MAIN_WINDOW_LABEL: &str = "main";
// 偏好设置窗口的label
pub static PREFERENCE_WINDOW_LABEL: &str = "preference";
// 主窗口的title
pub static MAIN_WINDOW_TITLE: &str = "EcoPaste";

// 声明来自 not_macos 的命令
#[cfg(not(target_os = "macos"))]
pub use not_macos::{clear_hidden_mark, mark_window_hidden};

// 标志：是否允许应用退出（由退出命令控制）
static ALLOW_EXIT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 允许应用退出
pub fn allow_exit() {
    ALLOW_EXIT.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod not_macos;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub use not_macos::*;

#[cfg(target_os = "macos")]
use crate::plugins::window::commands::macos::{set_macos_panel, MacOSPanelStatus};

// 获取窗口状态文件的路径
fn get_window_state_path<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    let extname = if cfg!(debug_assertions) {
        "dev.json"
    } else {
        "json"
    };
    let mut path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app data 目录失败: {}", e))?;
    path.push(format!(".window-state.{}", extname));
    Ok(path)
}

// 读取保存的窗口状态 (x, y, width, height)
pub fn get_saved_window_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    label: &str,
) -> Result<Option<(i32, i32, u32, u32)>, String> {
    let path = get_window_state_path(app_handle)?;

    if !path.exists() {
        return Ok(None);
    }

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取窗口状态文件失败: {}", e))?;

    let states: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析窗口状态文件失败: {}", e))?;

    if let Some(state) = states.get(label) {
        let x = state.get("x").and_then(|v| v.as_i64()).unwrap_or(0);
        let y = state.get("y").and_then(|v| v.as_i64()).unwrap_or(0);
        let width = state.get("width").and_then(|v| v.as_u64()).unwrap_or(0);
        let height = state.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
        return Ok(Some((x as i32, y as i32, width as u32, height as u32)));
    }

    Ok(None)
}

// 是否为主窗口
pub fn is_main_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    window.label() == MAIN_WINDOW_LABEL
}

// 共享显示窗口的方法
pub fn shared_show_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

// 设置窗口位置为跟随鼠标（支持多显示器环境）
pub fn set_window_follow_cursor<R: Runtime>(window: &WebviewWindow<R>) {
    use tauri::{Manager, PhysicalPosition, Position};

    if let Ok(cursor_pos) = window.app_handle().cursor_position() {
        // 获取窗口大小信息
        let mut window_width = 400; // 默认宽度
        let mut window_height = 600; // 默认高度

        if let Ok(size) = window.inner_size() {
            window_width = size.width;
            window_height = size.height;
        }

        // 查找鼠标所在的显示器
        let target_monitor =
            find_monitor_at_position(&window.app_handle(), cursor_pos.x, cursor_pos.y);

        if let Some(monitor) = target_monitor {
            // 在找到的显示器内计算安全的窗口位置
            let (final_x, final_y) = calculate_safe_position_in_monitor(
                cursor_pos.x as i32,
                cursor_pos.y as i32,
                window_width,
                window_height,
                &monitor,
            );

            let pos = PhysicalPosition {
                x: final_x,
                y: final_y,
            };
            let _ = window.set_position(Position::Physical(pos));
        } else {
            // 如果找不到合适的显示器，使用原始位置
            let pos = PhysicalPosition {
                x: cursor_pos.x as i32,
                y: cursor_pos.y as i32,
            };
            let _ = window.set_position(Position::Physical(pos));
        }
    }
}

// 查找指定位置所在的显示器
pub(crate) fn find_monitor_at_position<R: Runtime>(
    app_handle: &AppHandle<R>,
    x: f64,
    y: f64,
) -> Option<tauri::Monitor> {
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
pub(crate) fn calculate_safe_position_in_monitor(
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

/// WebView2 初始化等待时间（毫秒）
const WEBVIEW2_INIT_DELAY_MS: u64 = 150;

/// 焦点重试间隔（毫秒）
const FOCUS_RETRY_INTERVAL_MS: u64 = 50;

/// 焦点重试次数
const FOCUS_RETRY_COUNT: u32 = 5;

/// 安全的窗口激活函数（带重试机制和焦点冲突处理）
async fn activate_window_safely<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
    let _ = window.unminimize();

    // 多次尝试设置焦点，处理 WebView2 还没准备好的情况
    for attempt in 0..FOCUS_RETRY_COUNT {
        #[cfg(target_os = "windows")]
        {
            // Windows 上使用更激进的激活策略来强制获取焦点
            // 先尝试 set_always_on_top 切换来帮助激活
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);

            // 额外尝试：使用 set_always_on_top 切换来帮助激活
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        }

        let focus_result = window.set_focus();

        if focus_result.is_ok() {
            // 成功获取焦点，跳出循环
            if attempt > 0 {
                log::debug!("[Window] 第 {} 次尝试成功获取焦点", attempt + 1);
            }
            break;
        }

        if attempt < FOCUS_RETRY_COUNT - 1 {
            // 等待后重试
            tokio::time::sleep(tokio::time::Duration::from_millis(FOCUS_RETRY_INTERVAL_MS)).await;
        }
    }
}

// 窗口行为模式类型
pub enum WindowBehavior {
    Lightweight, // 轻量模式：直接销毁
    Resident,    // 常驻模式：隐藏
    AutoRecycle, // 自动回收：延迟销毁
}

/// 从配置文件中读取窗口行为设置
/// 返回 (mode, delay_seconds)
/// mode: "lightweight" | "resident" | "auto_recycle"
/// delay_seconds: 延迟销毁的秒数（仅 auto_recycle 模式使用）
pub fn get_window_behavior_from_config<R: Runtime>(app_handle: &AppHandle<R>) -> (String, i32) {
    let config = match read_config(app_handle) {
        Ok(c) => c,
        Err(_) => return ("resident".to_string(), 60),
    };

    if let Some(app) = get_nested(&config, &["globalStore", "app"]) {
        if let Some(wb) = app.get("windowBehavior") {
            let mode = wb
                .get("mode")
                .and_then(|m| m.as_str())
                .unwrap_or("resident")
                .to_string();
            let delay = wb
                .get("recycleDelaySeconds")
                .and_then(|d| d.as_i64())
                .unwrap_or(60) as i32;
            return (mode, delay);
        }
    }

    ("resident".to_string(), 60)
}

// 根据行为模式隐藏或销毁窗口
#[tauri::command]
pub async fn hide_window_with_behavior<R: Runtime>(
    app_handle: AppHandle<R>,
    label: String,
) -> Result<(), String> {
    // 从配置文件读取窗口行为设置
    let (mode, _delay_seconds) = get_window_behavior_from_config(&app_handle);

    let window = app_handle.get_webview_window(&label);

    if let Some(win) = window {
        match mode.as_str() {
            "lightweight" => {
                // 轻量模式：直接销毁窗口
                log::info!("[Window] 轻量模式：销毁窗口 {}", label);
                let _ = win.destroy();
            }
            "resident" => {
                // 常驻模式：隐藏窗口
                log::info!("[Window] 常驻模式：隐藏窗口 {}", label);
                let _ = win.hide();
            }
            "auto_recycle" => {
                // 自动回收模式：延迟后销毁
                log::info!("[Window] 自动回收模式：隐藏窗口 {}", label);

                // 隐藏窗口并标记为待回收
                let _ = win.hide();

                // 使用标记 + 回收器机制（Windows）
                #[cfg(not(target_os = "macos"))]
                {
                    mark_window_hidden(&app_handle, &label);
                }

                // macOS 使用 tokio 异步定时器
                #[cfg(target_os = "macos")]
                {
                    let app_handle_clone = app_handle.clone();
                    let label_clone = label.clone();
                    let delay_ms = delay_seconds * 1000;

                    spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms as u64))
                            .await;

                        // 检查窗口是否还存在且不可见
                        if let Some(win) = app_handle_clone.get_webview_window(&label_clone) {
                            if let Ok(visible) = win.is_visible() {
                                if !visible {
                                    let _ = win.destroy();
                                    log::info!("[Window] 自动回收：窗口 {} 已销毁", label_clone);
                                }
                            }
                        }
                    });
                }
            }
            _ => {
                // 默认行为：隐藏窗口
                log::warn!("[Window] 未知的窗口行为模式：{}，使用默认隐藏", mode);
                let _ = win.hide();
            }
        }
    }

    Ok(())
}

// Window state enum - returned to frontend for state synchronization
#[derive(Debug, Clone, serde::Serialize)]
pub enum WindowState {
    Shown,
    Hidden,
    Created,
}

// Hide window using behavior mode
async fn hide_with_behavior<R: Runtime>(
    app_handle: &AppHandle<R>,
    label: &str,
) -> Result<(), String> {
    let (mode, _delay_seconds) = get_window_behavior_from_config(&app_handle);

    if let Some(win) = app_handle.get_webview_window(label) {
        match mode.as_str() {
            "lightweight" => {
                log::info!("[Window] Lightweight mode: destroying window {}", label);
                let _ = win.destroy();
                // 清除隐藏标记，防止回收器误操作
                clear_hidden_mark(label);
            }
            "resident" => {
                log::info!("[Window] Resident mode: hiding window {}", label);
                let _ = win.hide();
            }
            "auto_recycle" => {
                log::info!(
                    "[Window] Auto-recycle mode: delayed destroy for window {}",
                    label
                );
                let _ = win.hide();

                #[cfg(not(target_os = "macos"))]
                {
                    mark_window_hidden(app_handle, label);
                }

                #[cfg(target_os = "macos")]
                {
                    let app_inner = app_handle.clone();
                    let label_inner = label.to_string();
                    let delay_ms = delay_seconds * 1000;

                    spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms as u64))
                            .await;
                        if let Some(win) = app_inner.get_webview_window(&label_inner) {
                            if let Ok(visible) = win.is_visible() {
                                if !visible {
                                    let _ = win.destroy();
                                    log::info!(
                                        "[Window] Auto-recycle: window {} destroyed",
                                        label_inner
                                    );
                                }
                            }
                        }
                    });
                }
            }
            _ => {
                log::warn!(
                    "[Window] Unknown window behavior: {}, using default hide",
                    mode
                );
                let _ = win.hide();
            }
        }
    }

    Ok(())
}

// Show window using position mode
async fn show_with_position<R: Runtime>(
    app_handle: &AppHandle<R>,
    label: &str,
    position_mode: Option<&str>,
) -> Result<(), String> {
    let position_mode = position_mode.unwrap_or("center");

    #[cfg(not(target_os = "macos"))]
    {
        clear_hidden_mark(label);
    }

    let mut window_opt = app_handle.get_webview_window(label);

    // If window doesn't exist, create it (all platforms)
    if window_opt.is_none() {
        if let Err(e) =
            super::create_window(app_handle.clone(), label.to_string(), Some(position_mode)).await
        {
            log::error!("[Window] Failed to create window: {}", e);
            return Err(format!("Failed to create window: {}", e));
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        window_opt = app_handle.get_webview_window(label);
    }

    if let Some(window) = window_opt {
        match position_mode {
            "remember" => {
                if let Ok(Some(state)) = get_saved_window_state(app_handle, label) {
                    let (x, y, saved_width, saved_height) = state;
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                    if saved_width > 0 && saved_height > 0 {
                        let _ =
                            window.set_size(tauri::PhysicalSize::new(saved_width, saved_height));
                    }
                }
            }
            "follow" => {
                if let Ok(cursor_pos) = app_handle.cursor_position() {
                    let mut window_width = 360;
                    let mut window_height = 600;

                    if let Ok(size) = window.inner_size() {
                        window_width = size.width;
                        window_height = size.height;
                    }

                    let (safe_x, safe_y) =
                        match find_monitor_at_position(app_handle, cursor_pos.x, cursor_pos.y) {
                            Some(monitor) => calculate_safe_position_in_monitor(
                                cursor_pos.x as i32,
                                cursor_pos.y as i32,
                                window_width,
                                window_height,
                                &monitor,
                            ),
                            None => (cursor_pos.x as i32, cursor_pos.y as i32),
                        };

                    let _ = window.set_position(tauri::PhysicalPosition::new(safe_x, safe_y));
                }
            }
            "center" | "default" | _ => {}
        }

        #[cfg(target_os = "macos")]
        {
            if is_main_window(&window) {
                if let Ok(mac) = app_handle.try_state::<super::macos::MacOSPanelState>() {
                    let state = mac.lock().unwrap();
                    if let Some(panel) = &state.panel {
                        let _ = panel.set_visible(true);
                    }
                }
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(WEBVIEW2_INIT_DELAY_MS)).await;
            activate_window_safely(&window).await;
        }
    }

    Ok(())
}

// Unified window toggle command
// If window is visible, hide it; otherwise show it
// position_mode: Position mode when showing ("center", "follow", "remember", "default")
#[tauri::command]
pub async fn toggle_window<R: Runtime>(
    app_handle: AppHandle<R>,
    label: String,
    position_mode: Option<String>,
) -> Result<WindowState, String> {
    let window = app_handle.get_webview_window(&label);

    match window {
        Some(win) => {
            if let Ok(is_visible) = win.is_visible() {
                if is_visible {
                    hide_with_behavior(&app_handle, &label).await?;
                    log::info!("[Window] Window {} hidden", label);
                    Ok(WindowState::Hidden)
                } else {
                    show_with_position(&app_handle, &label, position_mode.as_deref()).await?;
                    log::info!("[Window] Window {} shown", label);
                    Ok(WindowState::Shown)
                }
            } else {
                show_with_position(&app_handle, &label, position_mode.as_deref()).await?;
                Ok(WindowState::Shown)
            }
        }
        None => {
            show_with_position(&app_handle, &label, position_mode.as_deref()).await?;
            log::info!("[Window] Window {} created and shown", label);
            Ok(WindowState::Created)
        }
    }
}

// Internal exit command for tray control
// This is NOT exposed to frontend - only called by tray plugin
// Allows graceful exit when webview2 processes are being closed
#[tauri::command]
pub async fn exit_app<R: Runtime>(app_handle: AppHandle<R>) {
    allow_exit();
    log::info!("[Window] Exit command received, shutting down application");
    let _ = app_handle.exit(0);
}
