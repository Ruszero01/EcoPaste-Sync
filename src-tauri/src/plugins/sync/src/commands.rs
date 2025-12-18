//! 命令实现
//! 提供前端调用的完整 API

use crate::sync_engine::CloudSyncEngine;
use crate::types::*;
use crate::webdav::{WebDAVClientState, ConnectionTestResult, WebDAVConfig};
use crate::file_sync_manager::{FileUploadTask, FileDownloadTask, FileSyncBatch, FileSyncConfig, FileOperationResult};
use base64::Engine;
use std::sync::Arc;
use std::time::Instant;
use tauri::State;
use tokio::sync::Mutex;
use tauri_plugin_eco_database::DatabaseState;

/// 初始化同步
#[tauri::command]
pub async fn init_sync(
    config: SyncConfig,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.init(config).await
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
#[tauri::command]
pub async fn trigger_sync(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    // 从数据库读取数据
    let db = db_state.lock().await;

    let local_data = if db.is_initialized() {
        // 获取同步模式配置
        let engine = state.lock().await;
        let only_favorites = engine.get_sync_mode_only_favorites();
        drop(engine);

        // 查询需要同步的数据
        let sync_items = db.query_sync_data(only_favorites, Some(500))?;
        drop(db);

        // 转换为内部数据格式
        sync_items
            .into_iter()
            .map(|item| crate::sync_core::SyncDataItem {
                id: item.id,
                item_type: item.item_type,
                checksum: item.checksum,
                value: item.value,
                favorite: item.favorite,
                note: item.note,
                create_time: item.create_time,
                last_modified: item.last_modified,
                device_id: item.device_id,
                sync_status: crate::sync_core::SyncDataStatus::None,
                deleted: item.deleted,
            })
            .collect()
    } else {
        drop(db);
        log::warn!("数据库未初始化，使用空数据同步");
        Vec::new()
    };

    log::info!("从数据库加载了 {} 条记录准备同步", local_data.len());

    // 执行同步
    let mut engine = state.lock().await;
    engine.trigger_with_data(Some(local_data)).await
}

/// 启动自动同步
#[tauri::command]
pub async fn start_auto_sync(interval_minutes: u64, state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.start_auto_sync(interval_minutes).await
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
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.init(config).await
}

/// 获取当前同步配置
#[tauri::command]
pub fn get_sync_config(_state: State<'_, Arc<Mutex<CloudSyncEngine>>>) -> Result<(), String> {
    // 简化实现，返回空结果
    // 实际实现需要 UnifiedConfig 实现 Serialize trait
    Ok(())
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
