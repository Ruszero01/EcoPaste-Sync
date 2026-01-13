use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod auto_sync_manager;
mod bookmark_sync_manager;
mod commands;
mod config_sync_manager;
mod data_manager;
mod file_sync_manager;
mod sync_core;
mod sync_engine;
mod sync_utils;
mod types;
mod webdav;

pub use auto_sync_manager::{create_shared_manager, AutoSyncManagerState};
pub use bookmark_sync_manager::{BookmarkSyncData, BookmarkSyncManager, BookmarkSyncResult};
pub use config_sync_manager::{AppConfig, ConfigSyncManager, ConfigSyncResult};
pub use data_manager::{create_shared_manager as create_data_manager, DataManager};
pub use file_sync_manager::{
    create_shared_manager as create_file_sync_manager, FileDownloadTask, FileMetadata,
    FileOperationResult, FileSyncManager, FileUploadTask,
};
pub use sync_core::{SyncCore, SyncDataItem, SyncModeConfig, SyncProcessResult};
pub use sync_engine::{create_shared_engine, CloudSyncEngine};
pub use types::*;
pub use webdav::{create_shared_client, WebDAVClientState, WebDAVConfig};

/// 从本地文件读取同步配置
/// 返回值：Some(SyncConfig) 表示配置有效，None 表示无有效配置
/// 注意：连接测试会在 init() 时自动执行
pub fn read_sync_config_from_file() -> Option<types::SyncConfig> {
    use std::fs;

    // 获取应用数据目录
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .map(|p| p.join("com.Rains.EcoPaste-Sync"));

    let config_path = match data_dir {
        Some(dir) if dir.exists() => {
            if cfg!(debug_assertions) {
                dir.join(".store.dev.json")
            } else {
                dir.join(".store.json")
            }
        }
        _ => return None,
    };

    if !config_path.exists() {
        return None;
    }

    match fs::read_to_string(&config_path) {
        Ok(content) => {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => {
                    // 提取服务器配置（不再检查连接测试状态，连接测试在 init() 时自动执行）
                    if let Some(server_config) = json
                        .get("globalStore")
                        .and_then(|v| v.get("cloudSync"))
                        .and_then(|v| v.get("serverConfig"))
                    {
                        // 检查必要字段是否存在
                        let has_server_url = server_config
                            .get("url")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .is_some();
                        let has_username = server_config
                            .get("username")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .is_some();

                        if !has_server_url || !has_username {
                            log::info!("[Sync] 服务器配置不完整，跳过自动初始化");
                            return None;
                        }

                        // 读取自动同步设置
                        let auto_sync_settings = json
                            .get("globalStore")
                            .and_then(|v| v.get("cloudSync"))
                            .and_then(|v| v.get("autoSyncSettings"));

                        // 读取同步模式配置（统一配置入口）
                        let sync_mode_settings = json
                            .get("globalStore")
                            .and_then(|v| v.get("cloudSync"))
                            .and_then(|v| v.get("syncModeConfig"))
                            .and_then(|v| v.get("settings"));

                        let (auto_sync, auto_sync_interval_minutes) =
                            if let Some(settings) = auto_sync_settings {
                                let enabled = settings
                                    .get("enabled")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                let interval_hours = settings
                                    .get("intervalHours")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(1.0);
                                (enabled, (interval_hours * 60.0) as u64)
                            } else {
                                (false, 60)
                            };

                        // 从 syncModeConfig.settings 读取同步模式配置
                        let only_favorites = sync_mode_settings
                            .and_then(|v| v.get("onlyFavorites"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let include_files = sync_mode_settings
                            .and_then(|v| v.get("includeFiles"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                            || sync_mode_settings
                                .and_then(|v| v.get("includeImages"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);

                        Some(types::SyncConfig {
                            server_url: server_config
                                .get("url")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            username: server_config
                                .get("username")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            password: server_config
                                .get("password")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            path: server_config
                                .get("path")
                                .and_then(|v| v.as_str())
                                .unwrap_or("/EcoPaste-Sync")
                                .to_string(),
                            timeout: server_config
                                .get("timeout")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(60000),
                            auto_sync,
                            auto_sync_interval_minutes,
                            only_favorites,
                            include_files,
                        })
                    } else {
                        None
                    }
                }
                Err(_) => None,
            }
        }
        Err(_) => None,
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-sync")
        .invoke_handler(generate_handler![
            commands::init_sync,
            commands::get_sync_status,
            commands::trigger_sync,
            commands::start_auto_sync,
            commands::stop_auto_sync,
            commands::get_auto_sync_status,
            commands::update_auto_sync_interval,
            commands::test_webdav_connection,
            commands::update_sync_config,
            commands::reload_config_from_file,
            commands::upload_local_config,
            commands::apply_remote_config,
            commands::set_bookmark_sync_data,
            // 书签本地管理命令
            commands::load_bookmark_data,
            commands::save_bookmark_data,
            commands::load_bookmark_last_modified,
            commands::add_bookmark_group,
            commands::update_bookmark_group,
            commands::delete_bookmark_group,
            commands::reorder_bookmark_groups,
        ])
        .setup(|app_handle, _webview_manager| {
            // 在插件初始化时创建共享实例
            let webdav_client = create_shared_client();
            let auto_sync_manager = create_shared_manager();
            let sync_engine =
                create_shared_engine(webdav_client.clone(), auto_sync_manager.clone());

            // 注册状态管理器，让命令可以访问这些状态
            app_handle.manage(webdav_client.clone());
            app_handle.manage(auto_sync_manager.clone());
            app_handle.manage(sync_engine.clone());

            // 尝试从本地配置文件自动初始化同步引擎
            let sync_engine_clone = sync_engine.clone();
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(config) = read_sync_config_from_file() {
                    log::info!("[Sync] 检测到已保存的服务器配置，正在测试连接并初始化...");

                    // 从应用状态获取已初始化的数据库状态
                    let database_state = app_handle_clone
                        .state::<tauri_plugin_eco_database::DatabaseState>()
                        .clone();

                    let mut engine = sync_engine_clone.lock().await;
                    match engine.init(config, &database_state).await {
                        Ok(result) => {
                            log::info!("[Sync] 自动初始化成功: {}", result.message);
                        }
                        Err(e) => {
                            log::error!("[Sync] 自动初始化失败: {}", e);
                        }
                    }
                } else {
                    log::info!("[Sync] 未找到有效的服务器配置，跳过自动初始化");
                }
            });

            log::info!("[Sync] 插件初始化成功");
            Ok(())
        })
        .build()
}
