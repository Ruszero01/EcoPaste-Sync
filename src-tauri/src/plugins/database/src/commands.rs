//! 数据库命令实现
//! 提供前端调用的完整 API

use crate::{DatabaseManager, DatabaseState, HistoryItem, SyncDataItem, QueryOptions, DatabaseStatistics};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// 设置数据库路径并初始化
#[tauri::command]
pub fn set_database_path(
    save_data_dir: String,
    app_name: String,
    is_dev: bool,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut db = state.blocking_lock();
    db.set_database_path(save_data_dir, app_name, is_dev)
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
