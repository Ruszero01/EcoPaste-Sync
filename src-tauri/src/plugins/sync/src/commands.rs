//! 命令实现
//! 提供前端调用的完整 API

use crate::sync_engine::CloudSyncEngine;
use crate::types::*;
use crate::webdav::{ConnectionTestResult, WebDAVClientState};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_eco_database::DatabaseState;
use tokio::sync::Mutex;

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
            log::info!(
                "🔍 引擎配置状态: config.is_some={}",
                engine.config.is_some()
            );
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

/// 获取同步状态
#[tauri::command]
pub fn get_sync_status(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncStatus, String> {
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

    log::info!(
        "🔍 [TRIGGER] 引擎配置状态检查: config.is_some={}",
        engine.config.is_some()
    );
    if let Some(ref engine_config) = engine.config {
        log::info!(
            "🔍 [TRIGGER] 当前引擎配置: server_url={}",
            engine_config.server_url
        );
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
    let config = engine
        .config
        .as_ref()
        .ok_or_else(|| "同步引擎未初始化，请先保存服务器配置".to_string())?;
    let only_favorites = config.only_favorites;
    let include_files = config.include_files;
    log::info!("🔄 [TRIGGER] 触发同步: only_favorites={}", only_favorites);

    // 直接从数据库查询并执行同步
    let result = engine
        .sync_with_database(&db, only_favorites, include_files)
        .await;

    match result {
        Ok(process_result) => {
            log::info!(
                "✅ 同步成功: {} 项上传, {} 项下载, {} 项删除",
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
pub async fn stop_auto_sync(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.stop_auto_sync().await
}

/// 获取自动同步状态
#[tauri::command]
pub fn get_auto_sync_status(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<AutoSyncStatus, String> {
    let engine = state.blocking_lock();
    Ok(engine.get_auto_sync_status().clone())
}

/// 更新自动同步间隔
#[tauri::command]
pub async fn update_auto_sync_interval(
    interval_minutes: u64,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    engine.update_auto_sync_interval(interval_minutes).await
}

/// 测试 WebDAV 连接（从配置文件读取配置）
#[tauri::command]
pub async fn test_webdav_connection(
    webdav_client: State<'_, WebDAVClientState>,
) -> Result<ConnectionTestResult, String> {
    let client = webdav_client.lock().await;

    if !client.is_initialized() {
        return Err("WebDAV 客户端未初始化".to_string());
    }

    client.test_connection().await
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
    match crate::read_sync_config_from_file() {
        Some(config) => {
            // 重新初始化引擎
            match engine.init(config, &db_state).await {
                Ok(result) => {
                    log::info!("从本地文件重新加载配置成功");
                    Ok(result)
                }
                Err(e) => {
                    log::error!("初始化引擎失败: {}", e);
                    Err(format!("初始化引擎失败: {}", e))
                }
            }
        }
        None => {
            log::warn!("本地配置文件不存在或格式错误");
            Err("本地配置文件不存在".to_string())
        }
    }
}
