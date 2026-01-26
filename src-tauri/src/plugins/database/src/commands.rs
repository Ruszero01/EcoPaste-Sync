//! 数据库命令实现
//! 提供前端调用的完整 API

use crate::{DatabaseState, HistoryItem, InsertItem, InsertResult, QueryOptions, SyncDataItem};
use tauri::State;

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
        order_by: Some("time DESC".to_string()),
        where_clause: None,
        params: None,
    };
    db.query_history(options)
}

use serde::Deserialize;

/// 查询历史记录（带自定义筛选条件）
#[tauri::command]
pub fn query_history_with_filter(
    args: QueryFilterArgs,
    state: State<'_, DatabaseState>,
) -> Result<Vec<HistoryItem>, String> {
    let db = state.blocking_lock();
    let options = QueryOptions {
        only_favorites: false,
        exclude_deleted: true,
        limit: None,
        offset: None,
        order_by: None,
        where_clause: args.where_clause,
        params: args.params,
    };
    db.query_history(options)
}

#[derive(Deserialize, Debug)]
pub struct QueryFilterArgs {
    where_clause: Option<String>,
    params: Option<Vec<String>>,
}

/// 插入数据（带去重功能）
#[tauri::command]
pub fn insert_with_deduplication<R: tauri::Runtime>(
    item: InsertItem,
    state: State<'_, DatabaseState>,
    app_handle: tauri::AppHandle<R>,
) -> Result<InsertResult, String> {
    let db = state.blocking_lock();
    db.insert_with_deduplication(&item, &app_handle)
}

/// 统一删除命令
///
/// 根据同步状态决定删除方式：
/// - 已同步 (sync_status == "synced")：软删除，标记 deleted=1，等待云端同步时删除
/// - 未同步 (sync_status != "synced")：硬删除，直接从数据库删除
///
/// # Arguments
/// * `ids` - 要删除的项目ID列表（单个或批量）
/// * `hard_delete` - 可选，是否强制硬删除（true=全部硬删除，false=全部软删除，None=根据sync_status自动判断）
#[tauri::command]
pub fn delete_items(
    ids: Vec<String>,
    state: State<'_, DatabaseState>,
    hard_delete: Option<bool>,
) -> Result<crate::delete::DeleteResult, String> {
    let mut db = state.blocking_lock();
    crate::delete::DeleteManager::delete_items(
        &mut db,
        &ids,
        crate::delete::DeleteStrategy::from_option(hard_delete),
    )
}

/// 统一字段更新命令
/// 通过 field 和 value 参数决定更新哪个字段
#[tauri::command]
pub fn update_field(
    id: String,
    field: String,
    value: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let db = state.blocking_lock();
    let current_time = chrono::Utc::now().timestamp_millis();

    // 验证字段名并更新
    match field.as_str() {
        "favorite" => {
            let bool_value = value == "1" || value.to_lowercase() == "true";
            db.update_field(&id, "favorite", if bool_value { "1" } else { "0" })?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker()
                .mark_item_changed(&conn, &id, "favorite", false)?;
        }
        "note" => {
            db.update_field(&id, "note", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker()
                .mark_item_changed(&conn, &id, "note", false)?;
        }
        "content" => {
            db.update_field(&id, "value", &value)?;
            db.update_field(&id, "count", &value.len().to_string())?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker()
                .mark_item_changed(&conn, &id, "content", false)?;
        }
        "search" => {
            db.update_field(&id, "search", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker()
                .mark_item_changed(&conn, &id, "search", false)?;
        }
        "type" => {
            db.update_field(&id, "type", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker()
                .mark_item_changed(&conn, &id, "type", false)?;
        }
        "subtype" => {
            db.update_field(&id, "subtype", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker()
                .mark_item_changed(&conn, &id, "subtype", false)?;
        }
        "time" => {
            db.update_field(&id, "time", &value)?;
            // 时间戳更新不标记为待同步（无实质内容变更）
            let conn = db.get_connection()?;
            db.get_change_tracker()
                .mark_item_changed(&conn, &id, "time", true)?;
        }
        "syncStatus" => {
            db.update_field(&id, "syncStatus", &value)?;
            // 同步状态变更本身不需要再次触发变更跟踪
        }
        _ => return Err(format!("不支持的字段名: {}", field)),
    }

    Ok(())
}

/// 根据同步模式筛选数据（供同步引擎使用）
/// 直接委托给 database.rs 中的 query_for_sync，确保筛选逻辑统一
#[tauri::command]
pub fn query_for_sync(
    only_favorites: bool,
    include_images: bool,
    include_files: bool,
    content_types: crate::ContentTypeFilter,
    sync_status_filter: Option<crate::SyncStatusFilter>,
    state: State<'_, DatabaseState>,
) -> Result<Vec<SyncDataItem>, String> {
    let db = state.blocking_lock();
    db.query_for_sync(
        only_favorites,
        include_images,
        include_files,
        content_types,
        sync_status_filter,
    )
}
