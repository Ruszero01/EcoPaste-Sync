use super::{find_monitor_at_position, get_saved_window_state, calculate_safe_position_in_monitor, MAIN_WINDOW_LABEL, PREFERENCE_WINDOW_LABEL};
use crate::{shared_show_window, set_window_follow_cursor};
use tauri::{command, AppHandle, Manager, Runtime, WebviewWindow};

// 窗口配置
const MAIN_WINDOW_URL: &str = "index.html/#/";
const MAIN_WINDOW_WIDTH: u32 = 360;
const MAIN_WINDOW_HEIGHT: u32 = 600;
const PREFERENCE_WINDOW_URL: &str = "index.html/#/preference";
const PREFERENCE_WINDOW_WIDTH: u32 = 700;
const PREFERENCE_WINDOW_HEIGHT: u32 = 480;

#[cfg(target_os = "windows")]
use window_vibrancy::{apply_mica, clear_mica};

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
        }
        "remember" => {
            // 记住位置，在 restoreState 中已处理
        }
        _ => {}
    }

    shared_show_window(&window);
}

// 销毁窗口
#[command]
pub async fn destroy_window<R: Runtime>(window: WebviewWindow<R>) {
    #[cfg(target_os = "windows")]
    {
        let _ = window.destroy();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.hide();
    }
}

// 创建窗口
// position_mode: "remember" | "center" | "follow" | "default" - 控制窗口位置策略
#[command]
pub async fn create_window<R: Runtime>(
    app_handle: AppHandle<R>,
    label: String,
    position_mode: Option<&str>,
) -> Result<(), String> {
    // 先检查窗口是否已存在，如果存在则销毁旧窗口
    if let Some(existing_window) = app_handle.get_webview_window(&label) {
        let _ = existing_window.destroy();
    }

    let is_main = label == MAIN_WINDOW_LABEL;

    // 根据 position_mode 计算初始位置
    let initial_position = match position_mode {
        Some("remember") => {
            // 尝试读取保存的位置
            if let Ok(Some(state)) = get_saved_window_state(&app_handle, &label) {
                let (x, y, width, height) = state;
                Some((x as f64, y as f64, width as f64, height as f64))
            } else {
                None
            }
        }
        Some("follow") => {
            // 获取鼠标位置并计算安全的屏幕位置
            if let Ok(cursor_pos) = app_handle.cursor_position() {
                let window_width = if is_main { MAIN_WINDOW_WIDTH } else { PREFERENCE_WINDOW_WIDTH };
                let window_height = if is_main { MAIN_WINDOW_HEIGHT } else { PREFERENCE_WINDOW_HEIGHT };

                // 计算安全的窗口位置（不超出屏幕）
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

                Some((safe_x as f64, safe_y as f64, window_width as f64, window_height as f64))
            } else {
                None
            }
        }
        Some("center") | None | Some(_) => {
            None
        }
    };

    let builder = if is_main {
        // 主窗口配置（无标题栏）
        let url = MAIN_WINDOW_URL;
        let width = MAIN_WINDOW_WIDTH;
        let height = MAIN_WINDOW_HEIGHT;

        let mut builder = tauri::WebviewWindowBuilder::new(
            &app_handle,
            &label,
            tauri::WebviewUrl::App(url.into()),
        )
        .title("EcoPaste-Sync")
        .inner_size(width as f64, height as f64)
        .min_inner_size(width as f64, height as f64)
        .resizable(false)
        .visible(false)
        .always_on_top(true)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .decorations(false) // 主窗口不显示标题栏
        .transparent(true); // 启用透明度以支持 Mica 效果

        // 如果有保存的位置，直接设置
        if let Some((x, y, w, h)) = initial_position {
            builder = builder.position(x, y);
            if w > 0.0 && h > 0.0 {
                builder = builder.inner_size(w, h);
            }
        } else {
            builder = builder.center();
        }

        builder
    } else if label == PREFERENCE_WINDOW_LABEL {
        // 设置窗口配置
        let url = PREFERENCE_WINDOW_URL;
        let width = PREFERENCE_WINDOW_WIDTH;
        let height = PREFERENCE_WINDOW_HEIGHT;

        let mut builder = tauri::WebviewWindowBuilder::new(
            &app_handle,
            &label,
            tauri::WebviewUrl::App(url.into()),
        )
        .title("EcoPaste-Sync 设置")
        .inner_size(width as f64, height as f64)
        .min_inner_size(width as f64, height as f64)
        .resizable(false)
        .visible(false)
        .always_on_top(true)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .transparent(true); // 启用透明度以支持 Mica 效果

        // 如果有保存的位置，直接设置
        if let Some((x, y, w, h)) = initial_position {
            builder = builder.position(x, y);
            if w > 0.0 && h > 0.0 {
                builder = builder.inner_size(w, h);
            }
        } else {
            builder = builder.center();
        }

        builder
    } else {
        return Err(format!("未知窗口类型: {}", label));
    };

    let _window = builder
        .build()
        .map_err(|e| format!("创建窗口失败: {}", e))?;

    // 监听窗口关闭事件，根据窗口行为模式处理
    let window_clone = _window.clone();
    let app_handle_clone = app_handle.clone();
    let label_clone = label.clone();
    _window.on_window_event(move |event: &tauri::WindowEvent| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();

            // 从配置文件中读取窗口行为设置
            let (mode, delay_seconds) = super::get_window_behavior_from_config();

            match mode.as_str() {
                "lightweight" => {
                    // 轻量模式：直接销毁
                    let _ = window_clone.destroy();
                }
                "resident" => {
                    // 常驻模式：隐藏
                    let _ = window_clone.hide();
                }
                "auto_recycle" => {
                    // 自动回收模式：延迟后销毁
                    let delay_ms = (delay_seconds as i64) * 1000;
                    let app_inner = app_handle_clone.clone();
                    let label_inner = label_clone.clone();

                    // 先隐藏窗口
                    let _ = window_clone.hide();

                    // 延迟后销毁
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms as u64));
                        if let Some(win) = app_inner.get_webview_window(&label_inner) {
                            let _ = win.destroy();
                        }
                    });
                }
                _ => {
                    let _ = window_clone.hide();
                }
            }
        }
    });

    Ok(())
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

// 应用 Mica 材质效果
#[command]
pub async fn apply_mica_effect<R: Runtime>(window: WebviewWindow<R>, dark_mode: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 先清除之前的 Mica 效果
        let _ = clear_mica(&window);

        // 应用 Mica 效果
        apply_mica(&window, Some(dark_mode))
            .map_err(|e| format!("Failed to apply mica effect: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Mica effect is only supported on Windows".to_string());
    }

    Ok(())
}

// 清除 Mica 材质效果
#[command]
pub async fn clear_mica_effect<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        clear_mica(&window)
            .map_err(|e| format!("Failed to clear mica effect: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Mica effect is only supported on Windows".to_string());
    }

    Ok(())
}

// 检查是否支持 Mica 效果
#[command]
pub async fn is_mica_supported() -> bool {
    #[cfg(target_os = "windows")]
    {
        true
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
