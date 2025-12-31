use std::str::FromStr;
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, Runtime};
use tauri_plugin_eco_window::{show_main_window, show_preference_window};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent};

// 用于防止并发注册的互斥锁
static REGISTRATION_LOCK: Mutex<()> = Mutex::new(());

/// 快捷键事件处理
fn handle_shortcut_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    shortcut: &Shortcut,
    _event: ShortcutEvent,
) {
    let shortcut_str = shortcut.to_string();
    let app_handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        let shortcut_upper = shortcut_str.to_uppercase();
        let shortcut_normalized = shortcut_upper.replace("KEY", "").replace("DIGIT", "");

        match shortcut_normalized.as_str() {
            // 显示主窗口
            "ALT+C" | "COMMAND+ALT+C" | "WIN+ALT+C" => {
                show_main_window(app_handle_clone).await;
            }
            // 显示偏好设置
            "ALT+X" | "COMMAND+ALT+X" | "WIN+ALT+X" => {
                show_preference_window(app_handle_clone).await;
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
                let _ = app_handle_clone.emit("plugin:eco-hotkey://shortcut-triggered", shortcut_str);
            }
        }
    });
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
/// 2. 注销所有可能存在的旧快捷键（当前配置 + 历史所有可能的组合）
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

    // 注销当前配置的快捷键
    if !clipboard_shortcut.is_empty() {
        if let Ok(shortcut) = Shortcut::from_str(&clipboard_shortcut) {
            if global_shortcut.is_registered(shortcut) {
                let _ = global_shortcut.unregister(shortcut);
            }
        }
    }
    if !preference_shortcut.is_empty() {
        if let Ok(shortcut) = Shortcut::from_str(&preference_shortcut) {
            if global_shortcut.is_registered(shortcut) {
                let _ = global_shortcut.unregister(shortcut);
            }
        }
    }

    // 注销所有可能的历史快捷键组合
    let old_modifiers = ["Ctrl+Alt", "Command+Alt", "Shift+Alt", "Shift+Control", "Alt", "Shift"];
    for modifier in old_modifiers.iter() {
        for i in 1..=9 {
            let old_shortcut = format!("{}+{}", modifier, i);
            if let Ok(shortcut) = Shortcut::from_str(&old_shortcut) {
                if global_shortcut.is_registered(shortcut) {
                    let _ = global_shortcut.unregister(shortcut);
                }
            }
        }
    }

    // 等待注销生效
    std::thread::sleep(std::time::Duration::from_millis(150));

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
