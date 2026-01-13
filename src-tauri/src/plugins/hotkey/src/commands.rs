use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent};

use tauri_plugin_eco_common::{config::get_nested, paths::get_config_path};

// 用于防止并发注册的互斥锁
static REGISTRATION_LOCK: Mutex<()> = Mutex::new(());

// 用于防止快捷键事件重复触发的标记
static LAST_EVENT_TIME: AtomicUsize = AtomicUsize::new(0);
static EVENT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// 快捷键事件处理
fn handle_shortcut_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    shortcut: &Shortcut,
    _event: ShortcutEvent,
) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as usize;

    // 去重：如果 500ms 内已经有事件在处理，跳过这次
    if EVENT_IN_PROGRESS.load(Ordering::SeqCst) {
        return;
    }

    // 如果距离上次事件不到 500ms，跳过
    let last_time = LAST_EVENT_TIME.load(Ordering::SeqCst);
    if now - last_time < 500 {
        return;
    }

    EVENT_IN_PROGRESS.store(true, Ordering::SeqCst);
    LAST_EVENT_TIME.store(now, Ordering::SeqCst);

    let shortcut_str = shortcut.to_string();
    let app_handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        // 使用 scoped guard 确保无论如何都会重置标记
        struct Guard;
        impl Drop for Guard {
            fn drop(&mut self) {
                EVENT_IN_PROGRESS.store(false, Ordering::SeqCst);
            }
        }
        let _guard = Guard;

        let shortcut_upper = shortcut_str.to_uppercase();
        let shortcut_normalized = shortcut_upper.replace("KEY", "").replace("DIGIT", "");

        log::info!("[Hotkey] 快捷键: {}", shortcut_normalized);

        match shortcut_normalized.as_str() {
            // 显示主窗口
            "ALT+C" | "COMMAND+ALT+C" | "WIN+ALT+C" => {
                show_main_window_by_label(&app_handle_clone, "main").await;
            }
            // 显示偏好设置
            "ALT+X" | "COMMAND+ALT+X" | "WIN+ALT+X" => {
                show_main_window_by_label(&app_handle_clone, "preference").await;
            }
            // 快速粘贴快捷键 (1-9)
            _ => {
                let parts: Vec<&str> = shortcut_normalized.split('+').collect();
                for part in parts.iter().rev() {
                    if let Ok(index) = part.trim().parse::<u32>() {
                        if index >= 1 && index <= 9 {
                            let _ = app_handle_clone.emit("plugin:eco-paste://quick_paste", index);
                            return;
                        }
                    }
                }
                // 其他快捷键
                let _ =
                    app_handle_clone.emit("plugin:eco-hotkey://shortcut-triggered", shortcut_str);
            }
        }
    });
}

/// 显示主窗口的辅助函数
async fn show_main_window_by_label<R: Runtime>(app_handle: &AppHandle<R>, label: &str) {
    if label == "main" {
        // 主窗口使用配置中设置的位置模式
        let position_mode = get_position_mode(app_handle);
        tauri_plugin_eco_window::show_main_window(app_handle.clone(), position_mode).await;
    } else if label == "preference" {
        // 偏好设置窗口固定使用"center"模式，始终居中打开
        tauri_plugin_eco_window::show_preference_window(
            app_handle.clone(),
            Some("center".to_string()),
        )
        .await;
    }
}

/// 获取位置模式配置
fn get_position_mode<R: Runtime>(app_handle: &AppHandle<R>) -> Option<String> {
    let config_path = get_config_path(app_handle)?;
    if !config_path.exists() {
        return None;
    }

    let config_content = std::fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&config_content).ok()?;

    get_nested(&config, &["clipboardStore", "window", "position"])
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

/// 内部注册快捷键的辅助函数
fn register_shortcut_internal<R: Runtime>(
    global_shortcut: &tauri_plugin_global_shortcut::GlobalShortcut<R>,
    shortcut: &str,
) -> Result<(), String> {
    global_shortcut
        .on_shortcut(shortcut, |app, _shortcut, event| {
            handle_shortcut_event(app, _shortcut, event);
        })
        .map_err(|e| {
            if e.to_string().contains("already registered") {
                return String::new();
            }
            e.to_string()
        })
}

/// 注册所有应用快捷键（从全局配置读取）
///
/// 逻辑：
/// 1. 获取互斥锁，防止并发调用
/// 2. 注销所有快捷键（使用 unregister_all）
/// 3. 等待注销生效
/// 4. 注册新的快捷键
#[command]
pub async fn register_all_shortcuts<R: Runtime>(
    app_handle: AppHandle<R>,
    clipboard_shortcut: String,
    preference_shortcut: String,
    quick_paste_shortcuts: Vec<String>,
) -> Result<(), String> {
    // 获取锁，防止并发调用
    let _guard = REGISTRATION_LOCK.lock().map_err(|e| e.to_string())?;

    let global_shortcut = app_handle.global_shortcut();

    // 使用 unregister_all 清除所有快捷键和回调
    let _ = global_shortcut.unregister_all();
    // 等待注销完全生效
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 注册新快捷键
    if !clipboard_shortcut.is_empty() {
        register_shortcut_internal(&global_shortcut, clipboard_shortcut.as_str())?;
    }
    if !preference_shortcut.is_empty() {
        register_shortcut_internal(&global_shortcut, preference_shortcut.as_str())?;
    }
    for shortcut in quick_paste_shortcuts {
        if !shortcut.is_empty() {
            register_shortcut_internal(&global_shortcut, shortcut.as_str())?;
        }
    }

    Ok(())
}
