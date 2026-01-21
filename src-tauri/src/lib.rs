mod core;

use core::{prevent_default, setup};
use std::sync::atomic::AtomicBool;
use tauri::{generate_context, Builder, Listener, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_eco_migration::auto_migrate;
use tauri_plugin_eco_window::{
    create_window, get_window_behavior_from_config, show_main_window, MAIN_WINDOW_LABEL,
    PREFERENCE_WINDOW_LABEL,
};
use tauri_plugin_log::{Target, TargetKind};

/// 标志：是否允许应用退出（由 window 插件控制）
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

/// 允许应用退出（供 window 插件使用）
pub fn allow_exit() {
    ALLOW_EXIT.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = Builder::default()
        .setup(|app| {
            let app_handle = app.handle();

            // 动态获取或创建主窗口
            let main_window = app.get_webview_window(MAIN_WINDOW_LABEL);

            // 动态获取或创建设置窗口
            let preference_window = app.get_webview_window(PREFERENCE_WINDOW_LABEL);

            setup::default(&app_handle, main_window, preference_window);

            // 常驻模式下静默创建主窗口（创建但不显示，加速首次显示）
            {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let (behavior_mode, _) = get_window_behavior_from_config(&app_handle);

                    if behavior_mode == "resident" {
                        if app_handle.get_webview_window(MAIN_WINDOW_LABEL).is_none() {
                            if let Err(e) = create_window(app_handle.clone(), MAIN_WINDOW_LABEL.to_string(), Some("center")).await {
                                log::error!("[Lib] 常驻模式静默创建主窗口失败: {}", e);
                            } else {
                                log::info!("[Lib] 常驻模式：主窗口已静默创建");
                            }
                        }
                    }
                });
            }

            // 自动迁移检查（应用启动时执行）
            {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = auto_migrate(&app_handle).await {
                        log::error!("[Lib] 自动迁移失败: {}", e);
                    }
                });
            }

            // 监听托盘退出允许事件
            {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app_handle.listen("tray://allow-exit-and-exit", move |_event| {
                        allow_exit();
                        log::info!("[Lib] 收到退出允许事件");
                    });
                });
            }

            Ok(())
        })
        // 确保在 windows 和 linux 上只有一个 app 实例在运行：https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/single-instance
        .plugin(tauri_plugin_single_instance::init(
            |app_handle, _argv, _cwd| {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    show_main_window(app_handle, None).await;
                });
            },
        ))
        // app 自启动：https://github.com/tauri-apps/tauri-plugin-autostart/tree/v2
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--auto-launch"]),
        ))
        // 数据库：https://github.com/tauri-apps/tauri-plugin-sql/tree/v2
        .plugin(tauri_plugin_sql::Builder::default().build())
        // 日志插件：https://github.com/tauri-apps/tauri-plugin-log/tree/v2
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        // 快捷键插件: https://github.com/tauri-apps/tauri-plugin-global-shortcut
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // 操作系统相关信息插件：https://github.com/tauri-apps/tauri-plugin-os
        .plugin(tauri_plugin_os::init())
        // 系统级别对话框插件：https://github.com/tauri-apps/tauri-plugin-dialog
        .plugin(tauri_plugin_dialog::init())
        // 访问文件系统插件：https://github.com/tauri-apps/tauri-plugin-fs
        .plugin(tauri_plugin_fs::init())
        // 更新插件：https://github.com/tauri-apps/tauri-plugin-updater
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 进程相关插件：https://github.com/tauri-apps/tauri-plugin-process
        .plugin(tauri_plugin_process::init())
        // 拖拽插件：https://github.com/crabnebula-dev/drag-rs
        .plugin(tauri_plugin_drag::init())
        // 检查和请求 macos 系统权限：https://github.com/ayangweb/tauri-plugin-macos-permissions
        .plugin(tauri_plugin_macos_permissions::init())
        // 拓展了对文件和目录的操作：https://github.com/ayangweb/tauri-plugin-fs-pro
        .plugin(tauri_plugin_fs_pro::init())
        // 获取系统获取系统的区域设置：https://github.com/ayangweb/tauri-plugin-locale
        .plugin(tauri_plugin_locale::init())
        // 打开文件或者链接：https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/opener
        .plugin(tauri_plugin_opener::init())
        // 禁用 webview 的默认行为：https://github.com/ferreira-tb/tauri-plugin-prevent-default
        .plugin(prevent_default::init())
        // 自定义的窗口管理插件
        .plugin(tauri_plugin_eco_window::init())
        // 自定义剪贴板插件
        .plugin(tauri_plugin_eco_clipboard::init())
        // 自定义图片识别插件
        .plugin(tauri_plugin_eco_ocr::init())
        // 自定义粘贴的插件
        .plugin(tauri_plugin_eco_paste::init())
        // 自定义判断是否自动启动的插件
        .plugin(tauri_plugin_eco_autostart::init())
        // 统一数据库插件
        .plugin(tauri_plugin_eco_database::init())
        // 云同步引擎插件
        .plugin(tauri_plugin_eco_sync::init())
        // 类型检测插件
        .plugin(tauri_plugin_eco_detector::init())
        // 快捷键插件
        .plugin(tauri_plugin_eco_hotkey::init())
        // 通用功能插件
        .plugin(tauri_plugin_eco_common::init())
        // 系统托盘插件
        .plugin(tauri_plugin_eco_tray::init())
        // 数据迁移插件
        .plugin(tauri_plugin_eco_migration::init())
        // Shell 插件：https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/shell
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| match event {
            // 让 app 保持在后台运行：https://tauri.app/v1/guides/features/system-tray/#preventing-the-app-from-closing
            WindowEvent::CloseRequested { api, .. } => {
                window.hide().unwrap();

                api.prevent_close();
            }
            _ => {}
        })
        .build(generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| match event {
        // 阻止应用在没有窗口时自动退出（轻量模式）
        // 除非 ALLOW_EXIT 标志为 true（托盘菜单触发的退出）
        tauri::RunEvent::ExitRequested { api, .. } => {
            if !ALLOW_EXIT.load(std::sync::atomic::Ordering::SeqCst) {
                api.prevent_exit();
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if has_visible_windows {
                return;
            }

            let app_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                tauri_plugin_eco_window::show_preference_window(app_handle, None).await;
            });
        }
        _ => {
            let _ = app_handle;
        }
    });
}
