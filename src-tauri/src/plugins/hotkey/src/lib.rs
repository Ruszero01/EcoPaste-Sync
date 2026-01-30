use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{plugin::Builder, plugin::TauriPlugin, AppHandle, Runtime};
use tauri_plugin_eco_common::active_window::ForegroundWindowInfo;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod commands;

pub use commands::*;

mod blacklist;
pub use blacklist::*;

// 用于追踪 setup 是否已执行的原子计数器
static SETUP_CALLED: AtomicUsize = AtomicUsize::new(0);

/// 从配置中读取用户保存的快捷键配置
fn load_user_shortcuts<R: Runtime>(app_handle: &AppHandle<R>) -> (String, String, Vec<String>, String) {
    let config = match tauri_plugin_eco_common::config::get_cached_config(app_handle) {
        Ok(config) => config,
        _ => return ("Alt+C".to_string(), "Alt+X".to_string(), vec![], "".to_string()),
    };

    let clipboard_shortcut = tauri_plugin_eco_common::config::get_nested(&config, &["globalStore", "shortcut", "clipboard"])
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "Alt+C".to_string());

    let preference_shortcut = tauri_plugin_eco_common::config::get_nested(&config, &["globalStore", "shortcut", "preference"])
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "Alt+X".to_string());

    let quick_paste_shortcuts: Vec<String> = vec![];

    let paste_plain_shortcut = tauri_plugin_eco_common::config::get_nested(&config, &["globalStore", "shortcut", "pastePlain"])
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "".to_string());

    (clipboard_shortcut, preference_shortcut, quick_paste_shortcuts, paste_plain_shortcut)
}

pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-hotkey")
        .invoke_handler(tauri::generate_handler![
            commands::register_all_shortcuts,
            commands::unregister_all_shortcuts_cmd,
            commands::get_blacklist_cmd,
            commands::add_to_blacklist_cmd,
            commands::remove_from_blacklist_cmd,
            commands::clear_blacklist_cmd
        ])
        .setup(|app, _api| {
            // 检查 setup 是否已执行过
            let call_count = SETUP_CALLED.fetch_add(1, Ordering::SeqCst);
            if call_count > 0 {
                log::warn!(
                    "[Hotkey] setup 被调用了 {} 次，跳过重复执行",
                    call_count + 1
                );
                return Ok(());
            }

            // 初始化黑名单
            init_blacklist(app.clone());

            // 从用户配置中读取快捷键
            let (clipboard_shortcut, preference_shortcut, quick_paste_shortcuts, paste_plain_shortcut) =
                load_user_shortcuts(&app);

            // 保存快捷键配置供多个线程使用（先 clone）
            let shortcuts_for_register = (
                clipboard_shortcut.clone(),
                preference_shortcut.clone(),
                quick_paste_shortcuts.clone(),
                paste_plain_shortcut.clone(),
            );
            let shortcuts_for_listener = (
                clipboard_shortcut,
                preference_shortcut,
                quick_paste_shortcuts,
                paste_plain_shortcut,
            );

            // 在后台注册用户快捷键
            let app_handle = app.clone();
            let (clip, pref, quick, plain) = shortcuts_for_register;
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    let result = commands::register_all_shortcuts(
                        app_handle.clone(),
                        clip,
                        pref,
                        quick,
                        plain,
                    )
                    .await;
                    if let Err(e) = result {
                        log::error!("[Hotkey] 用户快捷键注册失败: {}", e);
                    } else {
                        log::info!("[Hotkey] 用户快捷键注册成功");
                    }
                });
            });

            // 创建窗口变化通知通道
            let (sender, receiver) = std::sync::mpsc::channel::<ForegroundWindowInfo>();
            tauri_plugin_eco_common::active_window::set_window_sender(sender);

            // 在后台线程监听窗口变化，动态注册/注销快捷键
            let app_handle = app.clone();
            let shortcuts = shortcuts_for_listener;
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                for window_info in receiver {
                    let app_handle = app_handle.clone();
                    let process_name = window_info.process_name.clone();
                    let (clipboard, preference, quick_paste, paste_plain) = shortcuts.clone();
                    rt.block_on(async {
                        if is_process_in_blacklist(&process_name) {
                            // 黑名单窗口，注销快捷键
                            let global_shortcut = app_handle.global_shortcut();
                            let _ = global_shortcut.unregister_all();
                            log::debug!("[Hotkey] 黑名单窗口，注销快捷键: {}", process_name);
                        } else {
                            // 非黑名单窗口，注册快捷键
                            let _ = commands::register_all_shortcuts(
                                app_handle,
                                clipboard,
                                preference,
                                quick_paste,
                                paste_plain,
                            )
                            .await;
                            log::debug!("[Hotkey] 非黑名单窗口，注册快捷键: {}", process_name);
                        }
                    });
                }
            });

            log::info!("[Hotkey] 已启动前台窗口监听");

            Ok(())
        })
        .build()
}
