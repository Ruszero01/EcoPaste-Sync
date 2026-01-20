use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Listener, Manager, Runtime,
};

use tauri_plugin_eco_common::active_window::start_foreground_listener;

mod commands;

pub use commands::*;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-paste")
        .setup(move |app, _api| {
            start_foreground_listener();

            // 监听来自 hotkey 插件的快速粘贴事件
            let app_handle = app.app_handle().clone();
            log::info!("[Paste] 开始注册快速粘贴事件监听器");

            let listener = app_handle.clone();
            let unlisten = listener.listen("plugin:eco-paste://quick_paste", move |event| {
                log::info!("[Paste] 收到快速粘贴事件: {:?}", event);

                // 事件载荷是字符串，解析为 u32
                let payload = event.payload();
                log::info!("[Paste] 事件载荷: {}", payload);

                if let Ok(index) = payload.parse::<u32>() {
                    log::info!("[Paste] 解析到索引: {}", index);
                    let app_handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = commands::quick_paste(app_handle, index).await;
                    });
                } else {
                    log::warn!("[Paste] 无法解析事件载荷为数字: {}", payload);
                }
            });
            log::info!("[Paste] 事件监听器注册成功, id: {:?}", unlisten);

            Ok(())
        })
        .invoke_handler(generate_handler![
            commands::paste,
            commands::paste_with_focus,
            commands::quick_paste
        ])
        .build()
}
