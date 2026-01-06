use tauri::{async_runtime::spawn, AppHandle, Manager, Runtime, WebviewWindow};

// 主窗口的label
pub static MAIN_WINDOW_LABEL: &str = "main";
// 偏好设置窗口的label
pub static PREFERENCE_WINDOW_LABEL: &str = "preference";
// 主窗口的title
pub static MAIN_WINDOW_TITLE: &str = "EcoPaste";

// 声明来自 not_macos 的 cancel_auto_recycle 命令
#[cfg(not(target_os = "macos"))]
pub use not_macos::{cancel_auto_recycle, start_auto_recycle_timer};

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
use crate::plugins::window::commands::macos::{MacOSPanelStatus, set_macos_panel};

// 获取窗口状态文件的路径
fn get_window_state_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let extname = if cfg!(debug_assertions) { "dev.json" } else { "json" };
    let mut path = app_handle.path().app_data_dir()
        .map_err(|e| format!("获取 app data 目录失败: {}", e))?;
    path.push(format!(".window-state.{}", extname));
    Ok(path)
}

// 读取保存的窗口状态 (x, y, width, height)
pub fn get_saved_window_state<R: Runtime>(app_handle: &AppHandle<R>, label: &str) -> Result<Option<(i32, i32, u32, u32)>, String> {
    let path = get_window_state_path(app_handle)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取窗口状态文件失败: {}", e))?;

    let states: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析窗口状态文件失败: {}", e))?;

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
pub(crate) fn find_monitor_at_position<R: Runtime>(app_handle: &AppHandle<R>, x: f64, y: f64) -> Option<tauri::Monitor> {
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

// 显示主窗口
#[tauri::command]
pub async fn show_main_window<R: Runtime>(app_handle: AppHandle<R>, position_mode: Option<String>) {
    let app_handle_clone = app_handle.clone();
    let label = MAIN_WINDOW_LABEL.to_string();

    // 在 Windows 上，先取消该窗口的自动回收计时器
    #[cfg(not(target_os = "macos"))]
    {
        let _ = cancel_auto_recycle(app_handle_clone.clone(), label.clone()).await;
    }

    // 直接在当前 async 上下文中执行，而不是 spawn
    let mut window_opt = app_handle.get_webview_window(&label);

    #[cfg(target_os = "windows")]
    {
        if window_opt.is_none() {
            if let Err(e) = super::create_window(app_handle_clone.clone(), label.clone(), position_mode.as_deref()).await {
                log::error!("[Window] 创建窗口失败: {}", e);
                return;
            }
            window_opt = app_handle_clone.get_webview_window(&label);
        }
    }

    if let Some(window) = window_opt {
        // 根据 position_mode 设置窗口位置（仅在窗口已存在时）
        match position_mode.as_deref() {
            Some("remember") => {
                // 尝试应用保存的位置
                if let Ok(Some(state)) = get_saved_window_state(&app_handle, &label) {
                    let (x, y, saved_width, saved_height) = state;
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                    if saved_width > 0 && saved_height > 0 {
                        let _ = window.set_size(tauri::PhysicalSize::new(saved_width, saved_height));
                    }
                }
            }
            Some("follow") => {
                // 跟随鼠标位置（使用安全位置计算，不超出屏幕）
                if let Ok(cursor_pos) = app_handle.cursor_position() {
                    let mut window_width = 360;
                    let mut window_height = 600;

                    if let Ok(size) = window.inner_size() {
                        window_width = size.width;
                        window_height = size.height;
                    }

                    // 计算安全的窗口位置
                    let (safe_x, safe_y) = match find_monitor_at_position(&app_handle, cursor_pos.x, cursor_pos.y) {
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
            Some("center") | None => {
                // 居中显示 - 不设置位置，让窗口系统处理
            }
            _ => {
                log::warn!("[Window] 未知的 position_mode: {:?}", position_mode);
            }
        }

        // 显示并激活窗口
        #[cfg(target_os = "macos")]
        {
            if is_main_window(&window) {
                set_macos_panel(&app_handle_clone, &window, MacOSPanelStatus::Show);
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // Windows 上使用类似 clash-verge-rev 的激活方式
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();

            // Windows 上尝试额外的激活方法
            #[cfg(target_os = "windows")]
            {
                let _ = window.set_always_on_top(true);
                let _ = window.set_always_on_top(false);
            }
        }
    }
}

// 显示偏好设置窗口
#[tauri::command]
pub async fn show_preference_window<R: Runtime>(app_handle: AppHandle<R>, position_mode: Option<String>) {
    show_window_by_label(&app_handle, PREFERENCE_WINDOW_LABEL, position_mode);
}

// 窗口行为模式类型
pub enum WindowBehavior {
    Lightweight,     // 轻量模式：直接销毁
    Resident,        // 常驻模式：隐藏
    AutoRecycle,     // 自动回收：延迟销毁
}

/// 从配置文件中读取窗口行为设置
/// 返回 (mode, delay_seconds)
/// mode: "lightweight" | "resident" | "auto_recycle"
/// delay_seconds: 延迟销毁的秒数（仅 auto_recycle 模式使用）
pub fn get_window_behavior_from_config() -> (String, i32) {
    let bundle_id = "com.Rains.EcoPaste-Sync";
    let is_dev = cfg!(debug_assertions);

    // 根据开发/发布模式选择配置文件名（与前端 path.ts 保持一致）
    // 开发环境: .store.dev.json
    // 生产环境: .store.json
    let config_filename = if is_dev { ".store.dev.json" } else { ".store.json" };

    // 优先使用 APPDATA 环境变量（与前端的 appDataDir 对应）
    let config_path = if let Some(app_data_dir) = std::env::var_os("APPDATA") {
        std::path::PathBuf::from(app_data_dir)
            .join(bundle_id)
            .join(config_filename)
    } else {
        // 备用方案：使用 dirs crate
        let save_data_dir = dirs::data_dir()
            .or_else(|| dirs::config_dir())
            .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")));

        match save_data_dir {
            Some(data_dir) => data_dir.join(bundle_id).join(config_filename),
            None => return ("resident".to_string(), 60),
        }
    };

    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            // 解析 JSON，提取 windowBehavior 配置
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(app) = json.get("globalStore").and_then(|s| s.get("app")) {
                    if let Some(wb) = app.get("windowBehavior") {
                        let mode = wb.get("mode")
                            .and_then(|m| m.as_str())
                            .unwrap_or("resident")
                            .to_string();
                        let delay = wb.get("recycleDelaySeconds")
                            .and_then(|d| d.as_i64())
                            .unwrap_or(60) as i32;
                        return (mode, delay);
                    }
                }
            }
        }
    }

    // 默认值
    ("resident".to_string(), 60)
}

// 根据行为模式隐藏或销毁窗口
#[tauri::command]
pub async fn hide_window_with_behavior<R: Runtime>(
    app_handle: AppHandle<R>,
    label: String,
) -> Result<(), String> {
    // 从配置文件读取窗口行为设置
    let (mode, delay_seconds) = get_window_behavior_from_config();

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
                let delay_ms = delay_seconds * 1000;
                log::info!("[Window] 自动回收模式：{}ms 后销毁窗口 {}", delay_ms, label);

                // 先隐藏窗口
                let _ = win.hide();

                // 使用统一的自动回收定时器（Windows）
                #[cfg(not(target_os = "macos"))]
                {
                    start_auto_recycle_timer(&app_handle, &label, delay_ms as u64);
                }

                // macOS 使用 tokio 异步定时器
                #[cfg(target_os = "macos")]
                {
                    let app_handle_clone = app_handle.clone();
                    let label_clone = label.clone();

                    spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms as u64)).await;

                        // 检查窗口是否还存在且可见
                        if let Some(win) = app_handle_clone.get_webview_window(&label_clone) {
                            if let Ok(visible) = win.is_visible() {
                                if visible {
                                    let _ = win.destroy();
                                    log::info!("[Window] 自动回收：已销毁窗口 {}", label_clone);
                                } else {
                                    log::info!("[Window] 自动回收：窗口 {} 不可见，跳过销毁", label_clone);
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

// 显示指定 label 的窗口（简化版：窗口不存在时直接创建）
fn show_window_by_label<R: Runtime>(app_handle: &AppHandle<R>, label: &str, position_mode: Option<String>) {
    let app_handle_clone = app_handle.clone();
    let label_clone = label.to_string();

    spawn(async move {
        // 在 Windows 上，先取消该窗口的自动回收计时器
        #[cfg(not(target_os = "macos"))]
        {
            let _ = cancel_auto_recycle(app_handle_clone.clone(), label_clone.clone()).await;
        }

        // 首先尝试获取现有窗口
        let mut window_opt = app_handle_clone.get_webview_window(&label_clone);

        // 在 Windows 上，如果窗口不存在，直接创建
        #[cfg(target_os = "windows")]
        {
            if window_opt.is_none() {
                if let Err(e) = super::create_window(app_handle_clone.clone(), label_clone.clone(), position_mode.as_deref()).await {
                    log::error!("[Window] 创建窗口失败: {}", e);
                    return;
                }
                // 等待窗口管理器更新状态
                std::thread::sleep(std::time::Duration::from_millis(100));
                window_opt = app_handle_clone.get_webview_window(&label_clone);
            }
        }

        if let Some(window) = window_opt {
            #[cfg(target_os = "macos")]
            {
                if is_main_window(&window) {
                    set_macos_panel(&app_handle_clone, &window, MacOSPanelStatus::Show);
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    });
}
