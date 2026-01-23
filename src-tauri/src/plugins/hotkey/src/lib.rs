use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{plugin::Builder, plugin::TauriPlugin, AppHandle, Runtime};

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

            // 在后台注册用户快捷键
            let app_handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    let result = commands::register_all_shortcuts(
                        app_handle,
                        clipboard_shortcut,
                        preference_shortcut,
                        quick_paste_shortcuts,
                        paste_plain_shortcut,
                    )
                    .await;
                    if let Err(e) = result {
                        log::error!("[Hotkey] 用户快捷键注册失败: {}", e);
                    } else {
                        log::info!("[Hotkey] 用户快捷键注册成功");
                    }
                });
            });
            Ok(())
        })
        .build()
}
