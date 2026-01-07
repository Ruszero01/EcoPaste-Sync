//! 命令实现
//! 提供前端调用的完整 API

use crate::sync_engine::CloudSyncEngine;
use crate::types::*;
use crate::webdav::{WebDAVClientState, ConnectionTestResult, WebDAVConfig};
use crate::file_sync_manager::{FileUploadTask, FileDownloadTask, FileSyncBatch, FileSyncConfig, FileOperationResult};
use base64::Engine;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::Mutex;
use tauri_plugin_eco_database::DatabaseState;

/// 初始化同步
#[tauri::command]
pub async fn init_sync(
    config: SyncConfig,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;

    log::info!("🔄 开始初始化同步引擎...");
    log::info!("📡 服务器: {}, 路径: {}", config.server_url, config.path);

    match engine.init(config, &db_state).await {
        Ok(result) => {
            log::info!("✅ 同步引擎初始化成功: {}", result.message);
            log::info!("🔍 引擎配置状态: config.is_some={}", engine.config.is_some());
            if let Some(ref engine_config) = engine.config {
                log::info!("🔍 保存的引擎配置: server_url={}", engine_config.server_url);
            }
            Ok(result)
        }
        Err(e) => {
            log::error!("❌ 同步引擎初始化失败: {}", e);
            Err(e)
        }
    }
}

/// 启动同步
#[tauri::command]
pub async fn start_sync(state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.start().await
}

/// 停止同步
#[tauri::command]
pub async fn stop_sync(state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.stop().await
}

/// 获取同步状态
#[tauri::command]
pub fn get_sync_status(state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<SyncStatus, String> {
    let engine = state.blocking_lock();
    Ok(engine.get_status().clone())
}

/// 手动触发同步（后端直接从数据库读取数据）
/// 自动检查并初始化同步引擎（如果尚未初始化）
#[tauri::command]
pub async fn trigger_sync<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    let db = db_state;

    log::info!("🔍 [TRIGGER] 引擎配置状态检查: config.is_some={}", engine.config.is_some());
    if let Some(ref engine_config) = engine.config {
        log::info!("🔍 [TRIGGER] 当前引擎配置: server_url={}", engine_config.server_url);
    }

    // 检查引擎是否已初始化，如果没有则尝试自动初始化
    if engine.config.is_none() {
        log::warn!("⚠️ [TRIGGER] 同步引擎未初始化，尝试自动初始化...");

        // 从数据库获取存储的配置信息
        // 注意：这里需要实际实现从数据库读取配置的逻辑
        // 目前我们返回错误提示用户先保存配置
        return Err("同步引擎未初始化，请先在设置中保存服务器配置".to_string());
    }

    // 获取同步模式配置
    let only_favorites = engine.get_sync_mode_only_favorites();
    log::info!("🔄 [TRIGGER] 触发同步: only_favorites={}", only_favorites);

    // 直接从数据库查询并执行同步
    let result = engine.sync_with_database(&db, only_favorites).await;

    match result {
        Ok(process_result) => {
            log::info!("✅ 同步成功: {} 项上传, {} 项下载, {} 项删除",
                process_result.uploaded_items.len(),
                process_result.downloaded_items.len(),
                process_result.deleted_items.len()
            );

            // 如果有数据变更，通知前端刷新列表
            if !process_result.uploaded_items.is_empty()
                || !process_result.downloaded_items.is_empty()
                || !process_result.deleted_items.is_empty()
            {
                let payload = serde_json::json!({ "duplicate_id": null });
                let _ = app_handle.emit("plugin:eco-clipboard://database_updated", payload);
            }

            Ok(SyncResult {
                success: process_result.success,
                message: if process_result.success {
                    if process_result.uploaded_items.is_empty()
                        && process_result.downloaded_items.is_empty()
                        && process_result.deleted_items.is_empty()
                    {
                        "✅ 同步完成".to_string()
                    } else {
                        format!(
                            "✅ 同步: 上传{} 下{} 删{}",
                            process_result.uploaded_items.len(),
                            process_result.downloaded_items.len(),
                            process_result.deleted_items.len()
                        )
                    }
                } else {
                    "❌ 同步失败".to_string()
                },
            })
        }
        Err(e) => {
            log::error!("❌ 同步失败: {}", e);
            Err(e)
        }
    }
}

/// 启动自动同步
#[tauri::command]
pub async fn start_auto_sync(
    interval_minutes: u64,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.start_auto_sync(interval_minutes, &db_state).await
}

/// 停止自动同步
#[tauri::command]
pub async fn stop_auto_sync(state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.stop_auto_sync().await
}

/// 获取自动同步状态
#[tauri::command]
pub fn get_auto_sync_status(state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<AutoSyncStatus, String> {
    let engine = state.blocking_lock();
    Ok(engine.get_auto_sync_status().clone())
}

/// 更新自动同步间隔
#[tauri::command]
pub async fn update_auto_sync_interval(interval_minutes: u64, state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.update_auto_sync_interval(interval_minutes).await
}

/// 测试 WebDAV 连接
#[tauri::command]
pub async fn test_webdav_connection(
    config: WebDAVConfig,
    _webdav_client: State<'_, WebDAVClientState>,
) -> Result<ConnectionTestResult, String> {
    // 使用传入的配置测试连接
    test_connection_with_config(&config).await
}

/// 使用指定配置测试连接
async fn test_connection_with_config(config: &WebDAVConfig) -> Result<ConnectionTestResult, String> {
    let start_time = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(config.timeout))
        .pool_max_idle_per_host(5)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 构建认证头
    let credentials = format!("{}:{}", config.username, config.password);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
    let auth_header = format!("Basic {}", encoded);

    // 构建测试URL - 使用基础 URL 而非完整路径
    let base_url = config.url.trim_end_matches('/');
    let sync_path = config.path.trim_matches('/');
    let test_url = format!("{}/{}", base_url, if sync_path.is_empty() { "" } else { sync_path });

    // 先尝试创建目录
    let directory_url = if !sync_path.is_empty() {
        Some(format!("{}/{}", base_url, sync_path))
    } else {
        None
    };

    // 如果有自定义路径，先尝试创建目录
    if let Some(dir_url) = &directory_url {
        let _ = client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), dir_url)
            .header("Authorization", &auth_header)
            .header("User-Agent", "EcoPaste-CloudSync/1.0")
            .send()
            .await;
    }

    // 测试连接
    let response = client
        .head(&test_url)
        .header("Authorization", &auth_header)
        .header("User-Agent", "EcoPaste-CloudSync/1.0")
        .send()
        .await;

    let latency = start_time.elapsed().as_millis() as u64;

    match response {
        Ok(resp) => {
            let status_code = resp.status().as_u16();
            let server_info = resp
                .headers()
                .get("Server")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let success = resp.status().is_success() || status_code == 405 || status_code == 207;

            Ok(ConnectionTestResult {
                success,
                latency_ms: latency,
                status_code: Some(status_code),
                error_message: if !success {
                    Some(format!("HTTP {}", status_code))
                } else {
                    None
                },
                server_info,
            })
        }
        Err(e) => Ok(ConnectionTestResult {
            success: false,
            latency_ms: latency,
            status_code: None,
            error_message: Some(format!("连接失败: {}", e)),
            server_info: None,
        }),
    }
}

/// 获取同步进度
#[tauri::command]
pub fn get_sync_progress(state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<Option<SyncProgress>, String> {
    let engine = state.blocking_lock();
    Ok(engine.get_progress().cloned())
}

/// 更新同步配置
#[tauri::command]
pub async fn update_sync_config(
    config: SyncConfig,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.init(config, &db_state).await
}

/// 获取当前同步配置
#[tauri::command]
pub fn get_sync_config(_state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<Option<SyncConfig>, String> {
    // 从本地文件读取配置
    read_config_from_file()
}

/// 上传单个文件
#[tauri::command]
pub async fn upload_file(
    task: FileUploadTask,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<FileOperationResult, String> {
    let engine = state.lock().await;
    engine.upload_file(task).await
}

/// 下载单个文件
#[tauri::command]
pub async fn download_file(
    task: FileDownloadTask,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<FileOperationResult, String> {
    let engine = state.lock().await;
    engine.download_file(task).await
}

/// 删除单个文件
#[tauri::command]
pub async fn delete_file(
    file_id: String,
    remote_path: String,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<FileOperationResult, String> {
    let engine = state.lock().await;
    engine.delete_file(file_id, remote_path).await
}

/// 批量文件同步
#[tauri::command]
pub async fn sync_file_batch(
    batch: FileSyncBatch,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<FileOperationResult, String> {
    let mut engine = state.lock().await;
    engine.sync_file_batch(batch).await
}

/// 批量删除文件
#[tauri::command]
pub async fn delete_files(
    file_ids: Vec<String>,
    remote_paths: Vec<String>,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<FileOperationResult, String> {
    let engine = state.lock().await;
    engine.delete_files(file_ids, remote_paths).await
}

/// 获取文件同步配置
#[tauri::command]
pub fn get_file_sync_config(state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<FileSyncConfig, String> {
    let engine = state.blocking_lock();
    Ok(engine.get_file_sync_config())
}

/// 更新文件同步配置
#[tauri::command]
pub async fn update_file_sync_config(
    config: FileSyncConfig,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.update_file_sync_config(config).await;
    Ok(SyncResult {
        success: true,
        message: "文件同步配置已更新".to_string(),
    })
}

/// 上传本地配置到云端
#[tauri::command]
pub async fn upload_local_config(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let engine = state.lock().await;
    engine.upload_local_config().await
}

/// 应用云端配置
#[tauri::command]
pub async fn apply_remote_config(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let engine = state.lock().await;
    engine.apply_remote_config().await
}

/// 执行书签同步
#[tauri::command]
pub async fn sync_bookmarks(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let engine = state.lock().await;
    engine.sync_bookmarks().await
}

/// 下载书签数据
#[tauri::command]
pub async fn download_bookmarks(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let engine = state.lock().await;
    engine.download_bookmarks().await
}

/// 设置书签同步数据
#[tauri::command]
pub async fn set_bookmark_sync_data(
    bookmark_data: crate::bookmark_sync_manager::BookmarkSyncData,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.set_bookmark_sync_data(bookmark_data).await;
    Ok(SyncResult {
        success: true,
        message: "✅ 书签数据已设置".to_string(),
    })
}

/// 从本地文件重新加载配置
#[tauri::command]
pub async fn reload_config_from_file(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;

    // 从本地文件读取配置
    match read_config_from_file() {
        Ok(Some(config)) => {
            // 重新初始化引擎
            match engine.init(config, &db_state).await {
                Ok(result) => {
                    log::info!("✅ 从本地文件重新加载配置成功");
                    Ok(result)
                }
                Err(e) => {
                    log::error!("❌ 初始化引擎失败: {}", e);
                    Err(format!("初始化引擎失败: {}", e))
                }
            }
        }
        Ok(None) => {
            log::warn!("⚠️ 本地配置文件不存在或格式错误");
            Err("本地配置文件不存在".to_string())
        }
        Err(e) => {
            log::error!("❌ 读取本地配置文件失败: {}", e);
            Err(format!("读取配置文件失败: {}", e))
        }
    }
}

/// 从本地文件读取配置
fn read_config_from_file() -> Result<Option<SyncConfig>, String> {
    use std::fs;

    // 获取应用数据目录
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    let bundle_id = "com.Rains.EcoPaste-Sync";
    let _app_name = "EcoPaste-Sync";

    // 构建配置文件路径
    let config_path = data_dir.join(bundle_id);
    let config_file = if cfg!(debug_assertions) {
        config_path.join(".store.dev.json")
    } else {
        config_path.join(".store.json")
    };

    log::info!("🔍 读取配置文件: {:?}", config_file);

    // 检查文件是否存在
    if !config_path.exists() {
        log::warn!("⚠️ 配置文件目录不存在: {:?}", config_path);
        return Ok(None);
    }

    if !config_file.exists() {
        log::warn!("⚠️ 配置文件不存在: {:?}", config_file);
        return Ok(None);
    }

    // 读取并解析文件
    match fs::read_to_string(&config_file) {
        Ok(content) => {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json_value) => {
                    // 从 JSON 中提取 cloudSync.serverConfig
                    if let Some(cloud_sync) = json_value.get("globalStore").and_then(|v| v.get("cloudSync")) {
                        if let Some(server_config) = cloud_sync.get("serverConfig") {
                            let config = SyncConfig {
                                server_url: server_config.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                username: server_config.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                password: server_config.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                path: server_config.get("path").and_then(|v| v.as_str()).unwrap_or("/EcoPaste-Sync").to_string(),
                                auto_sync: false,
                                auto_sync_interval_minutes: 60,
                                only_favorites: false,
                                include_files: false,
                                timeout: server_config.get("timeout").and_then(|v| v.as_u64()).unwrap_or(60000),
                            };

                            // 尝试读取自动同步设置
                            if let Some(auto_sync) = cloud_sync.get("autoSyncSettings") {
                                if let (Some(enabled), Some(interval)) = (
                                    auto_sync.get("enabled").and_then(|v| v.as_bool()),
                                    auto_sync.get("intervalHours").and_then(|v| v.as_f64())
                                ) {
                                    return Ok(Some(SyncConfig {
                                        auto_sync: enabled,
                                        auto_sync_interval_minutes: (interval * 60.0) as u64,
                                        only_favorites: auto_sync.get("syncModeConfig")
                                            .and_then(|v| v.get("settings"))
                                            .and_then(|v| v.get("onlyFavorites"))
                                            .and_then(|v| v.as_bool())
                                            .unwrap_or(false),
                                        include_files: auto_sync.get("syncModeConfig")
                                            .and_then(|v| v.get("settings"))
                                            .and_then(|v| v.get("includeFiles"))
                                            .and_then(|v| v.as_bool())
                                            .unwrap_or(false) || auto_sync.get("syncModeConfig")
                                            .and_then(|v| v.get("settings"))
                                            .and_then(|v| v.get("includeImages"))
                                            .and_then(|v| v.as_bool())
                                            .unwrap_or(false),
                                        ..config
                                    }));
                                }
                            }

                            return Ok(Some(config));
                        }
                    }

                    log::warn!("⚠️ 配置文件中没有找到有效的 serverConfig");
                    Ok(None)
                }
                Err(e) => {
                    log::error!("❌ 解析配置文件失败: {}", e);
                    Err(format!("解析配置文件失败: {}", e))
                }
            }
        }
        Err(e) => {
            log::error!("❌ 读取配置文件失败: {}", e);
            Err(format!("读取配置文件失败: {}", e))
        }
    }
}

/// 保存连接测试结果到配置文件
#[tauri::command]
pub async fn save_connection_test_result(
    success: bool,
    latency_ms: u64,
) -> Result<(), String> {
    use std::fs;

    // 获取应用数据目录
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    let bundle_id = "com.Rains.EcoPaste-Sync";
    let config_path = if cfg!(debug_assertions) {
        data_dir.join(bundle_id).join(".store.dev.json")
    } else {
        data_dir.join(bundle_id).join(".store.json")
    };

    // 读取现有配置或创建新配置
    let mut config: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("读取配置文件失败: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("解析配置文件失败: {}", e))?
    } else {
        serde_json::json!({
            "globalStore": {
                "cloudSync": {
                    "serverConfig": {},
                    "autoSyncSettings": {
                        "enabled": false,
                        "intervalHours": 1.0,
                        "syncModeConfig": {
                            "settings": {
                                "onlyFavorites": false,
                                "includeImages": false,
                                "includeFiles": false
                            }
                        }
                    },
                    "syncModeConfig": {
                        "settings": {
                            "onlyFavorites": false,
                            "includeImages": false,
                            "includeFiles": false
                        }
                    },
                    "connectionTest": {
                        "tested": false,
                        "success": false,
                        "latencyMs": 0,
                        "timestamp": 0
                    }
                }
            }
        })
    };

    // 更新连接测试结果
    if let Some(cloud_sync) = config.get_mut("globalStore").and_then(|v| v.get_mut("cloudSync")) {
        cloud_sync["connectionTest"] = serde_json::json!({
            "tested": true,
            "success": success,
            "latencyMs": latency_ms,
            "timestamp": chrono::Utc::now().timestamp()
        });
    }

    // 写入配置文件
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置文件失败: {}", e))?;

    fs::write(&config_path, content)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    if success {
        log::info!("[Sync] ✅ 连接测试成功已保存到配置文件 (延迟: {}ms)", latency_ms);
    } else {
        log::info!("[Sync] ❌ 连接测试失败已保存到配置文件");
    }

    Ok(())
}
