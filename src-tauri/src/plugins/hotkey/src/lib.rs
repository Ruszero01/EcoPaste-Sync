use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::plugin::{Builder, TauriPlugin};

pub use commands::*;

mod commands;

// 用于追踪 setup 是否已执行的原子计数器
static SETUP_CALLED: AtomicUsize = AtomicUsize::new(0);

pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-hotkey")
        .invoke_handler(tauri::generate_handler![commands::register_all_shortcuts])
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

            // 默认快捷键配置
            let clipboard_shortcut = "Alt+C".to_string();
            let preference_shortcut = "Alt+X".to_string();
            let quick_paste_shortcuts: Vec<String> = vec![];

            // 在后台注册默认快捷键
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
                    )
                    .await;
                    if let Err(e) = result {
                        log::error!("[Hotkey] 默认快捷键注册失败: {}", e);
                    } else {
                        log::info!("[Hotkey] 默认快捷键注册成功");
                    }
                });
            });
            Ok(())
        })
        .build()
}
