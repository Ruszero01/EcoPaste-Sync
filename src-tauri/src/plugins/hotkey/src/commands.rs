use std::sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Mutex, RwLock, OnceLock};
use std::collections::HashMap;
use tauri::{command, AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent};

use super::blacklist::{add_to_blacklist, clear_blacklist, get_blacklist, is_process_in_blacklist, remove_from_blacklist};
use tauri_plugin_eco_common::{active_window::get_current_window_info, config::get_nested, paths::get_config_path};

// 用于防止并发注册的互斥锁
static REGISTRATION_LOCK: Mutex<()> = Mutex::new(());

// 用于防止快捷键事件重复触发的标记
static LAST_EVENT_TIME: AtomicUsize = AtomicUsize::new(0);
static EVENT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

// 快捷键到操作的映射（使用运行时配置）
static SHORTCUT_ACTION_MAP: OnceLock<RwLock<HashMap<String, String>>> =
    OnceLock::new();

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

        // 从运行时映射中获取对应的操作
        let action = {
            let map = SHORTCUT_ACTION_MAP.get_or_init(|| RwLock::new(HashMap::new()));
            let read_guard = map.read().unwrap();
            read_guard.get(shortcut_normalized.as_str()).cloned()
        };

        // 检查是否是主快捷键 (基于配置的快捷键)
        let is_main_shortcut = action.is_some() && matches!(action.as_deref(), Some("clipboard" | "preference"));

        // 如果是主快捷键，检查黑名单
        if is_main_shortcut {
            match get_current_window_info() {
                Ok(window_info) => {
                    if is_process_in_blacklist(&window_info.process_name) {
                        log::info!(
                            "[Hotkey] 快捷键被黑名单拦截: {} ({})",
                            window_info.window_title,
                            window_info.process_name
                        );
                        return;
                    }
                }
                Err(e) => {
                    log::warn!("[Hotkey] 获取当前窗口信息失败: {}", e);
                }
            }
        }

        // 根据映射的操作执行对应功能
        match action.as_deref() {
            // 显示主窗口
            Some("clipboard") => {
                show_main_window_by_label(&app_handle_clone, "main").await;
            }
            // 显示偏好设置
            Some("preference") => {
                show_main_window_by_label(&app_handle_clone, "preference").await;
            }
            // 粘贴纯文本快捷键
            Some("paste_plain") => {
                let _ = app_handle_clone.emit("plugin:eco-paste://paste_plain", ());
            }
            // 快速粘贴快捷键
            Some(action) if action.starts_with("quick_paste_") => {
                if let Ok(index) = action.trim_start_matches("quick_paste_").parse::<u32>() {
                    if index >= 1 && index <= 9 {
                        let _ = app_handle_clone.emit("plugin:eco-paste://quick_paste", index);
                        return;
                    }
                }
            }
            // 其他快捷键（向后兼容，保留原有逻辑）
            _ => {
                // 如果在配置映射中没找到，回退到硬编码的快捷键处理
                match shortcut_normalized.as_str() {
                    "ALT+C" | "COMMAND+ALT+C" | "WIN+ALT+C" => {
                        show_main_window_by_label(&app_handle_clone, "main").await;
                    }
                    "ALT+X" | "COMMAND+ALT+X" | "WIN+ALT+X" => {
                        show_main_window_by_label(&app_handle_clone, "preference").await;
                    }
                    _ => {
                        // 尝试匹配数字快捷键（向后兼容）
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
            }
        }
    });
}

/// 显示主窗口的辅助函数
async fn show_main_window_by_label<R: Runtime>(app_handle: &AppHandle<R>, label: &str) {
    if label == "main" {
        // 主窗口使用配置中设置的位置模式
        let position_mode = get_position_mode(app_handle);
        let _ = tauri_plugin_eco_window::toggle_window(
            app_handle.clone(),
            label.to_string(),
            position_mode,
        )
        .await;
    } else if label == "preference" {
        // 偏好设置窗口固定使用"center"模式，始终居中打开
        let _ = tauri_plugin_eco_window::toggle_window(
            app_handle.clone(),
            label.to_string(),
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
	paste_plain_shortcut: String,
) -> Result<(), String> {
    // 获取锁，防止并发调用
    let _guard = REGISTRATION_LOCK.lock().map_err(|e| e.to_string())?;

    let global_shortcut = app_handle.global_shortcut();

    // 使用 unregister_all 清除所有快捷键和回调
    let _ = global_shortcut.unregister_all();
    // 等待注销完全生效
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 更新快捷键映射表
    let action_map = SHORTCUT_ACTION_MAP.get_or_init(|| RwLock::new(HashMap::new()));
    let mut write_guard = action_map.write().unwrap();
    write_guard.clear();

    // 注册新快捷键并更新映射
    if !clipboard_shortcut.is_empty() {
        register_shortcut_internal(&global_shortcut, clipboard_shortcut.as_str())?;
        let normalized = clipboard_shortcut.to_uppercase().replace("KEY", "").replace("DIGIT", "");
        write_guard.insert(normalized, "clipboard".to_string());
    }
    if !preference_shortcut.is_empty() {
        register_shortcut_internal(&global_shortcut, preference_shortcut.as_str())?;
        let normalized = preference_shortcut.to_uppercase().replace("KEY", "").replace("DIGIT", "");
        write_guard.insert(normalized, "preference".to_string());
    }
    for (index, shortcut) in quick_paste_shortcuts.iter().enumerate() {
        if !shortcut.is_empty() {
            register_shortcut_internal(&global_shortcut, shortcut.as_str())?;
            let normalized = shortcut.to_uppercase().replace("KEY", "").replace("DIGIT", "");
            write_guard.insert(normalized, format!("quick_paste_{}", index + 1));
        }
    }

    if !paste_plain_shortcut.is_empty() {
        register_shortcut_internal(&global_shortcut, paste_plain_shortcut.as_str())?;
        let normalized = paste_plain_shortcut.to_uppercase().replace("KEY", "").replace("DIGIT", "");
        write_guard.insert(normalized, "paste_plain".to_string());
    }

    Ok(())
}

// ==================== 黑名单命令 ====================

#[command]
pub fn get_blacklist_cmd() -> Vec<super::BlacklistItem> {
    get_blacklist()
}

#[command]
pub fn add_to_blacklist_cmd<R: Runtime>(app_handle: AppHandle<R>, process_name: String) -> Result<(), String> {
    add_to_blacklist(app_handle, process_name)
}

#[command]
pub fn remove_from_blacklist_cmd<R: Runtime>(app_handle: AppHandle<R>, process_name: String) -> Result<(), String> {
    remove_from_blacklist(app_handle, &process_name)
}

#[command]
pub fn clear_blacklist_cmd<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    clear_blacklist(app_handle)
}
