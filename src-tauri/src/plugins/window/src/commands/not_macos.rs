use super::{shared_hide_window, shared_show_window, set_window_follow_cursor};
use tauri::{command, AppHandle, Runtime, WebviewWindow};

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
