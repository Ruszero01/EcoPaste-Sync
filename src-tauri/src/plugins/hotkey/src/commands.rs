use tauri::{command, AppHandle, Emitter, Runtime};
use tauri_plugin_eco_window::{show_main_window, show_preference_window};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent};

/// 快捷键事件处理
fn handle_shortcut_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    shortcut: &Shortcut,
    _event: ShortcutEvent,
) {
    let shortcut_str = shortcut.to_string();
    log::info!("[Hotkey] 收到快捷键事件: {}", shortcut_str);

    let app_handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        log::info!("[Hotkey] 开始处理快捷键: {}", shortcut_str);

        // 将快捷键转换为大写进行匹配，处理不同的大小写格式
        let shortcut_upper = shortcut_str.to_uppercase();
        // 移除 KEY 前缀 (如 KeyC -> C) 和 DIGIT 前缀 (如 Digit1 -> 1)
        let shortcut_normalized = shortcut_upper
            .replace("KEY", "")
            .replace("DIGIT", "");

        match shortcut_normalized.as_str() {
            // 显示主窗口 (Alt+C)
            "ALT+C" | "COMMAND+ALT+C" | "WIN+ALT+C" => {
                log::info!("[Hotkey] 匹配到显示主窗口快捷键");
                let result = show_main_window(app_handle_clone).await;
                log::info!("[Hotkey] show_main_window 结果: {:?}", result);
            }
            // 显示偏好设置 (Alt+X)
            "ALT+X" | "COMMAND+ALT+X" | "WIN+ALT+X" => {
                log::info!("[Hotkey] 匹配到显示偏好设置快捷键");
                let result = show_preference_window(app_handle_clone).await;
                log::info!("[Hotkey] show_preference_window 结果: {:?}", result);
            }
            // 快速粘贴快捷键 (1-9) - 格式如 "ALT+1" 或 "COMMAND+ALT+1"
            _ => {
                // 检查是否是快速粘贴快捷键
                let parts: Vec<&str> = shortcut_normalized.split('+').collect();
                log::info!("[Hotkey] 快捷键部分 (normalized): {:?}", parts);

                for part in parts.iter().rev() {
                    let part = part.trim();
                    log::info!("[Hotkey] 检查部分: {}", part);

                    if let Ok(index) = part.parse::<u32>() {
                        log::info!("[Hotkey] 解析到的索引: {}", index);

                        if index >= 1 && index <= 9 {
                            log::info!("[Hotkey] 触发快速粘贴，索引: {}", index);
                            // 通过事件触发 paste 插件的 quick_paste
                            let emit_result = app_handle_clone.emit("plugin:eco-paste://quick_paste", index);
                            log::info!("[Hotkey] 发送事件结果: {:?}", emit_result);
                            return;
                        }
                    }
                }

                // 其他快捷键触发通用事件
                log::info!("[Hotkey] 触发通用事件: {}", shortcut_str);
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
    log::info!("[Hotkey] 正在注册快捷键: {}", shortcut);

    let shortcut_owned = shortcut.to_string();
    let result = global_shortcut
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            log::info!("[Hotkey] 快捷键回调触发: {}, original: {:?}", _shortcut, shortcut_owned);
            handle_shortcut_event(app, _shortcut, event);
        })
        .map_err(|e| {
            log::error!("[Hotkey] 注册快捷键失败 {}: {}", shortcut, e);
            e.to_string()
        });

    log::info!("[Hotkey] 快捷键 {} 注册结果: {:?}", shortcut, result);
    result
}

/// 注册单个快捷键
#[command]
pub async fn register_shortcut<R: Runtime>(
    app_handle: AppHandle<R>,
    shortcut: String,
) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();
    let shortcut_str = shortcut.as_str();

    // 先注销已存在的同名快捷键
    let _ = global_shortcut.unregister(shortcut_str);

    register_shortcut_internal(&global_shortcut, shortcut_str)?;
    log::info!("Registered hotkey: {}", shortcut_str);
    Ok(())
}

/// 注销单个快捷键
#[command]
pub async fn unregister_shortcut<R: Runtime>(
    app_handle: AppHandle<R>,
    shortcut: String,
) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();
    let shortcut_str = shortcut.as_str();
    global_shortcut
        .unregister(shortcut_str)
        .map_err(|e| e.to_string())?;
    log::info!("Unregistered hotkey: {}", shortcut_str);
    Ok(())
}

/// 注销所有快捷键
#[command]
pub async fn unregister_all_shortcuts<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();
    global_shortcut
        .unregister_all()
        .map_err(|e| e.to_string())?;
    log::info!("Unregistered all hotkeys");
    Ok(())
}

/// 注册默认快捷键（从配置读取）
#[command]
pub async fn register_default_shortcuts<R: Runtime>(
    app_handle: AppHandle<R>,
    clipboard_shortcut: String,
    preference_shortcut: String,
) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();

    // 先注销所有快捷键
    let _ = global_shortcut.unregister_all();

    // 注册显示窗口快捷键
    if !clipboard_shortcut.is_empty() {
        let shortcut = clipboard_shortcut.as_str();
        register_shortcut_internal(&global_shortcut, shortcut)?;
        log::info!("Registered default hotkey for clipboard: {}", shortcut);
    }

    // 注册偏好设置快捷键
    if !preference_shortcut.is_empty() {
        let shortcut = preference_shortcut.as_str();
        register_shortcut_internal(&global_shortcut, shortcut)?;
        log::info!("Registered default hotkey for preference: {}", shortcut);
    }

    Ok(())
}

/// 注册所有应用快捷键（从全局配置读取）
#[command]
pub async fn register_all_shortcuts<R: Runtime>(
    app_handle: AppHandle<R>,
    clipboard_shortcut: String,
    preference_shortcut: String,
    quick_paste_shortcuts: Vec<String>,
) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();

    // 先注销所有快捷键
    let _ = global_shortcut.unregister_all();

    // 注册显示窗口快捷键
    if !clipboard_shortcut.is_empty() {
        let shortcut = clipboard_shortcut.as_str();
        register_shortcut_internal(&global_shortcut, shortcut)?;
        log::info!("Registered hotkey for clipboard: {}", shortcut);
    }

    // 注册偏好设置快捷键
    if !preference_shortcut.is_empty() {
        let shortcut = preference_shortcut.as_str();
        register_shortcut_internal(&global_shortcut, shortcut)?;
        log::info!("Registered hotkey for preference: {}", shortcut);
    }

    // 注册快速粘贴快捷键
    for shortcut in quick_paste_shortcuts {
        if !shortcut.is_empty() {
            let shortcut_str = shortcut.as_str();
            register_shortcut_internal(&global_shortcut, shortcut_str)?;
            log::info!("Registered hotkey for quick paste: {}", shortcut_str);
        }
    }

    log::info!("All shortcuts registered successfully");
    Ok(())
}

/// 获取当前快捷键状态
#[command]
pub async fn get_shortcut_state<R: Runtime>(
    _app_handle: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "shortcuts": []
    }))
}
