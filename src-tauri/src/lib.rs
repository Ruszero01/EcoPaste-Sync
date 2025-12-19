mod core;

use core::{prevent_default, setup};
use tauri::{generate_context, Builder, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_eco_window::{show_main_window, MAIN_WINDOW_LABEL, PREFERENCE_WINDOW_LABEL};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_eco_sync::{create_shared_engine, create_shared_client, create_shared_manager};
use tauri_plugin_eco_database::create_shared_database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = Builder::default()
        .setup(|app| {
            let app_handle = app.handle();

            let main_window = app.get_webview_window(MAIN_WINDOW_LABEL).unwrap();

            let preference_window = app.get_webview_window(PREFERENCE_WINDOW_LABEL).unwrap();

  // 在 Windows 11 上自动应用 Mica 效果
            #[cfg(target_os = "windows")]
            {
                let main_window_clone = main_window.clone();
                std::thread::spawn(move || {
                    // 等待窗口完全初始化
                    std::thread::sleep(std::time::Duration::from_millis(500));

                    #[cfg(target_os = "windows")]
                    {
                        use window_vibrancy::{apply_mica};

                        // 应用 Mica 效果，使用 None 自动匹配系统主题
                        if let Err(e) = apply_mica(&main_window_clone, None) {
                            eprintln!("❌ Failed to apply Mica effect: {}", e);
                        } else {
                            println!("✅ Mica effect applied to main window");
                        }
                    }
                });
            }

            setup::default(&app_handle, main_window.clone(), preference_window.clone());

            Ok(())
        })
        // 确保在 windows 和 linux 上只有一个 app 实例在运行：https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/single-instance
        .plugin(tauri_plugin_single_instance::init(
            |app_handle, _argv, _cwd| {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    show_main_window(app_handle).await;
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
        // 自定义WebDAV插件
        .plugin(tauri_plugin_eco_webdav::init())
        // 自定义自动同步插件
        .plugin(tauri_plugin_eco_auto_sync::init())
        // 自定义活动窗口插件
        .plugin(tauri_plugin_eco_active_window::init())
        // 统一数据库插件
        .plugin(tauri_plugin_eco_database::init())
        // 云同步引擎插件
        .plugin(tauri_plugin_eco_sync::init())
        // Shell 插件：https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/shell
        .plugin(tauri_plugin_shell::init())
        // 初始化共享状态
        .manage(create_shared_client())
        .manage(create_shared_manager())
        // 先创建并管理数据库实例，供所有组件使用
        .manage(create_shared_database())
        // 创建并管理同步引擎实例
        .manage(create_shared_engine(create_shared_client(), create_shared_manager()))
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
          tauri_plugin_eco_window::show_preference_window(app_handle).await;
      });
        }
        _ => {
            let _ = app_handle;
        }
    });
}
