//! 数据库命令实现
//! 提供前端调用的完整 API

use crate::{DatabaseState, HistoryItem, SyncDataItem, QueryOptions, DatabaseStatistics};
use tauri::State;

/// 设置数据库路径并初始化 - 从后端环境自动获取路径
#[tauri::command]
pub fn set_database_path(
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut db = state.blocking_lock();

    // 使用标准路径（与前端 appDataDir 对应）
    // 优先使用用户配置目录，然后回退到数据目录
    let save_data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    // 获取应用标识符作为名称（与前端保持一致）
    let bundle_id = "com.Rains.EcoPaste-Sync";
    let app_name = "EcoPaste-Sync".to_string();

    // 检查是否为开发模式
    let is_dev = cfg!(debug_assertions);

    // 构建数据目录：{saveDataDir}/{bundleId}
    let data_dir = save_data_dir.join(bundle_id);

    // set_database_path 会自动构建文件名：{dataDir}/{appName}.{ext}
    db.set_database_path(
        data_dir.to_string_lossy().to_string(),
        app_name,
        is_dev,
    )
}

/// 查询历史记录
#[tauri::command]
pub fn query_history(
    only_favorites: bool,
    exclude_deleted: bool,
    limit: Option<i32>,
    offset: Option<i32>,
    state: State<'_, DatabaseState>,
) -> Result<Vec<HistoryItem>, String> {
    let db = state.blocking_lock();
    let options = QueryOptions {
        only_favorites,
        exclude_deleted,
        limit,
        offset,
        order_by: Some("createTime DESC".to_string()),
        where_clause: None,
    };
    db.query_history(options)
}

/// 查询同步数据
#[tauri::command]
pub fn query_sync_data(
    only_favorites: bool,
    limit: Option<i32>,
    state: State<'_, DatabaseState>,
) -> Result<Vec<SyncDataItem>, String> {
    let db = state.blocking_lock();
    db.query_sync_data(only_favorites, limit)
}

/// 更新同步状态
#[tauri::command]
pub fn update_sync_status(
    id: String,
    status: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let db = state.blocking_lock();
    db.update_sync_status(&id, &status)
}

/// 批量更新同步状态
#[tauri::command]
pub fn batch_update_sync_status(
    ids: Vec<String>,
    status: String,
    state: State<'_, DatabaseState>,
) -> Result<usize, String> {
    let db = state.blocking_lock();
    db.batch_update_sync_status(&ids, &status)
}

/// 从云端插入或更新数据
#[tauri::command]
pub fn upsert_from_cloud(
    item: SyncDataItem,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let db = state.blocking_lock();
    db.upsert_from_cloud(&item)
}

/// 标记删除
#[tauri::command]
pub fn mark_deleted(
    id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let db = state.blocking_lock();
    db.mark_deleted(&id)
}

/// 获取统计信息
#[tauri::command]
pub fn get_statistics(
    state: State<'_, DatabaseState>,
) -> Result<DatabaseStatistics, String> {
    let db = state.blocking_lock();
    db.get_statistics()
}
