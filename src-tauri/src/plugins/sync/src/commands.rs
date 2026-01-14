//! 命令实现
//! 提供前端调用的完整 API

use crate::bookmark_sync_manager::BookmarkGroup;
use crate::sync_engine::CloudSyncEngine;
use crate::types::*;
use crate::webdav::{ConnectionTestResult, WebDAVClientState};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_eco_database::DatabaseState;
use tokio::sync::Mutex;

/// 获取当前时间戳（毫秒）
fn current_timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 初始化同步
#[tauri::command]
pub async fn init_sync(
    config: SyncConfig,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;

    log::info!("[Sync] 开始初始化同步引擎...");
    log::info!(
        "[Sync] 服务器: {}, 路径: {}",
        config.server_url,
        config.path
    );

    match engine.init(config, &db_state).await {
        Ok(result) => {
            log::info!("[Sync] 同步引擎初始化成功: {}", result.message);
            Ok(result)
        }
        Err(e) => {
            log::error!("[Sync] 同步引擎初始化失败: {}", e);
            Err(e)
        }
    }
}

/// 获取同步状态（返回包含 last_sync_time 的完整状态）
#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<AutoSyncStatus, String> {
    let engine = state.lock().await;
    Ok(engine.get_auto_sync_status().await)
}

/// 手动触发同步（后端直接从数据库读取数据）
#[tauri::command]
pub async fn trigger_sync<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;
    let db = db_state;

    // 检查引擎是否已初始化
    let config = engine.get_config().await;
    if config.is_none() {
        log::warn!("[Sync] 同步引擎未初始化，请先保存服务器配置");
        return Err("同步引擎未初始化，请先保存服务器配置".to_string());
    }

    let config = config.unwrap();
    let only_favorites = config.only_favorites;
    let include_files = config.include_files;
    log::info!("[Sync] 触发同步: only_favorites={}", only_favorites);

    // 直接从数据库查询并执行同步
    let result = engine
        .sync_with_database(&db, only_favorites, include_files)
        .await;

    match result {
        Ok(process_result) => {
            log::info!(
                "[Sync] 同步成功: {} 上传, {} 下载, {} 删除",
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
                        "同步完成".to_string()
                    } else {
                        format!(
                            "同步: 上传{} 下{} 删{}",
                            process_result.uploaded_items.len(),
                            process_result.downloaded_items.len(),
                            process_result.deleted_items.len()
                        )
                    }
                } else {
                    "同步失败".to_string()
                },
            })
        }
        Err(e) => {
            log::error!("[Sync] 同步失败: {}", e);
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
pub async fn get_auto_sync_status(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
) -> Result<AutoSyncStatus, String> {
    let engine = state.lock().await;
    Ok(engine.get_auto_sync_status().await)
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

/// 测试 WebDAV 连接
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
        message: "书签数据已设置".to_string(),
    })
}

/// 从本地文件重新加载配置
#[tauri::command]
pub async fn reload_config_from_file(
    state: State<'_, Arc<Mutex<CloudSyncEngine>>>,
    db_state: State<'_, DatabaseState>,
) -> Result<SyncResult, String> {
    let mut engine = state.lock().await;

    match crate::read_sync_config_from_file() {
        Some(config) => match engine.init(config, &db_state).await {
            Ok(result) => {
                log::info!("[Sync] 从本地文件重新加载配置成功");
                Ok(result)
            }
            Err(e) => {
                log::error!("[Sync] 初始化引擎失败: {}", e);
                Err(format!("初始化引擎失败: {}", e))
            }
        },
        None => {
            log::warn!("[Sync] 本地配置文件不存在或格式错误");
            Err("本地配置文件不存在".to_string())
        }
    }
}

// ================================
// 书签本地管理命令
// ================================

/// 加载本地书签数据
#[tauri::command]
pub async fn load_bookmark_data() -> Result<BookmarkGroupData, String> {
    log::info!("[Bookmark] 加载本地书签数据");

    // 获取应用数据目录
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .map(|p| p.join("com.Rains.EcoPaste-Sync"))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    let bookmark_path = data_dir.join("bookmark-data.json");

    if !bookmark_path.exists() {
        log::info!("[Bookmark] 书签文件不存在，返回空数据");
        return Ok(BookmarkGroupData {
            last_modified: 0,
            groups: vec![],
        });
    }

    match std::fs::read_to_string(&bookmark_path) {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|e| format!("解析书签数据失败: {}", e))
        }
        Err(e) => {
            log::error!("[Bookmark] 读取书签文件失败: {}", e);
            Err(format!("读取书签文件失败: {}", e))
        }
    }
}

/// 保存本地书签数据
#[tauri::command]
pub async fn save_bookmark_data(data: BookmarkGroupData) -> Result<bool, String> {
    log::info!("[Bookmark] 保存本地书签数据: {} 分组", data.groups.len());

    // 获取应用数据目录
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .map(|p| p.join("com.Rains.EcoPaste-Sync"))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    // 确保目录存在
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {}", e))?;

    let bookmark_path = data_dir.join("bookmark-data.json");

    let json =
        serde_json::to_string_pretty(&data).map_err(|e| format!("序列化书签数据失败: {}", e))?;

    std::fs::write(&bookmark_path, json).map_err(|e| format!("写入书签文件失败: {}", e))?;

    log::info!("[Bookmark] 书签数据保存成功");
    Ok(true)
}

/// 加载最后修改时间
#[tauri::command]
pub async fn load_bookmark_last_modified() -> Result<i64, String> {
    let data = load_bookmark_data().await?;
    Ok(data.last_modified)
}

/// 添加书签分组
#[tauri::command]
pub async fn add_bookmark_group(name: String, color: String) -> Result<BookmarkGroup, String> {
    log::info!("[Bookmark] 添加书签分组: {}", name);

    let mut data = load_bookmark_data().await?;

    // 检查是否已存在同名分组
    if data.groups.iter().any(|g| g.name == name.trim()) {
        return Err("已存在同名分组".to_string());
    }

    let new_group = BookmarkGroup {
        id: format!("custom_{}", current_timestamp_millis()),
        name: name.trim().to_string(),
        color,
        create_time: current_timestamp_millis(),
        update_time: current_timestamp_millis(),
    };

    data.groups.push(new_group.clone());
    data.last_modified = current_timestamp_millis();

    save_bookmark_data(data).await?;

    Ok(new_group)
}

/// 更新书签分组
#[tauri::command]
pub async fn update_bookmark_group(
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<BookmarkGroup, String> {
    log::info!("[Bookmark] 更新书签分组: {}", id);

    let mut data = load_bookmark_data().await?;
    let now = current_timestamp_millis();

    // 先克隆要返回的分组
    let updated_group = match data.groups.iter().find(|g| g.id == id) {
        Some(g) => g.clone(),
        None => return Err("分组不存在".to_string()),
    };

    // 先检查名称冲突（如果需要更新名称）
    if let Some(ref name) = name {
        if data
            .groups
            .iter()
            .any(|g| g.id != id && g.name == name.trim())
        {
            return Err("已存在同名分组".to_string());
        }
    }

    // 再查找并更新分组
    let group = data
        .groups
        .iter_mut()
        .find(|g| g.id == id)
        .ok_or_else(|| "分组不存在".to_string())?;

    if let Some(name) = name {
        group.name = name.trim().to_string();
    }

    if let Some(color) = color {
        group.color = color;
    }

    group.update_time = now;
    data.last_modified = now;

    save_bookmark_data(data).await?;

    Ok(updated_group)
}

/// 删除书签分组
#[tauri::command]
pub async fn delete_bookmark_group(id: String) -> Result<bool, String> {
    log::info!("[Bookmark] 删除书签分组: {}", id);

    let mut data = load_bookmark_data().await?;
    let initial_len = data.groups.len();

    data.groups.retain(|g| g.id != id);

    if data.groups.len() == initial_len {
        return Err("分组不存在".to_string());
    }

    data.last_modified = current_timestamp_millis();
    save_bookmark_data(data).await?;

    Ok(true)
}

/// 重新排序书签分组
#[tauri::command]
pub async fn reorder_bookmark_groups(groups: Vec<BookmarkGroup>) -> Result<bool, String> {
    log::info!("[Bookmark] 重新排序书签分组: {} 个", groups.len());

    let mut data = load_bookmark_data().await?;

    // 验证所有分组ID都存在
    let existing_ids: std::collections::HashSet<String> =
        data.groups.iter().map(|g| g.id.clone()).collect();

    for group in &groups {
        if !existing_ids.contains(&group.id) {
            return Err(format!("分组不存在: {}", group.id));
        }
    }

    data.groups = groups;
    data.last_modified = current_timestamp_millis();
    save_bookmark_data(data).await?;

    Ok(true)
}

/// 书签分组数据
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BookmarkGroupData {
    pub last_modified: i64,
    pub groups: Vec<BookmarkGroup>,
}

// ================================
// 服务器配置本地管理命令（不参与云同步）
// ================================

/// 服务器配置数据结构
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigData {
    pub url: String,
    pub username: String,
    pub password: String,
    pub path: String,
    pub timeout: u64,
}

impl Default for ServerConfigData {
    fn default() -> Self {
        Self {
            url: String::new(),
            username: String::new(),
            password: String::new(),
            path: "/EcoPaste-Sync".to_string(),
            timeout: 60000,
        }
    }
}

/// 获取服务器配置文件路径
fn get_server_config_path() -> Result<std::path::PathBuf, String> {
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .map(|p| p.join("com.Rains.EcoPaste-Sync"))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    let filename = if cfg!(debug_assertions) {
        "server-config.dev.json"
    } else {
        "server-config.json"
    };

    Ok(data_dir.join(filename))
}

/// 服务器配置保存结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "data")]
pub enum SaveServerConfigResult {
    Success,
    Error(String),
}

/// 保存服务器配置到单独文件
#[tauri::command]
pub async fn save_server_config(config: ServerConfigData) -> SaveServerConfigResult {
    log::info!("[Sync] 保存服务器配置");

    let config_path = match get_server_config_path() {
        Ok(path) => path,
        Err(e) => return SaveServerConfigResult::Error(e),
    };

    if let Some(parent) = config_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return SaveServerConfigResult::Error(format!("创建配置目录失败: {}", e));
        }
    }

    let json = match serde_json::to_string_pretty(&config) {
        Ok(j) => j,
        Err(e) => return SaveServerConfigResult::Error(format!("序列化配置失败: {}", e)),
    };

    if let Err(e) = std::fs::write(&config_path, json) {
        return SaveServerConfigResult::Error(format!("写入配置文件失败: {}", e));
    }

    log::info!("[Sync] 服务器配置已保存到: {:?}", config_path);
    SaveServerConfigResult::Success
}

/// 从单独文件加载服务器配置
#[tauri::command]
pub async fn load_server_config() -> Result<ServerConfigData, String> {
    log::info!("[Sync] 加载服务器配置");

    let config_path = get_server_config_path()?;

    if !config_path.exists() {
        log::info!("[Sync] 服务器配置文件不存在");
        return Ok(ServerConfigData::default());
    }

    match std::fs::read_to_string(&config_path) {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))
        }
        Err(e) => {
            log::error!("[Sync] 读取配置文件失败: {}", e);
            Err(format!("读取配置文件失败: {}", e))
        }
    }
}
