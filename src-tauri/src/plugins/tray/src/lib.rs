use tauri::{plugin::Builder, plugin::TauriPlugin, Manager, Runtime};

mod commands;

pub use commands::*;

/// 初始化托盘插件
/// 托盘在插件加载时自动创建，无需前端调用
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-tray")
        .setup(|app, _api| {
            let handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = commands::create_tray(handle).await {
                    log::error!("[Tray] 自动创建托盘失败: {}", e);
                }
            });
            Ok(())
        })
        .build()
}
