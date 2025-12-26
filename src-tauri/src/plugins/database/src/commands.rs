//! 数据库命令实现
//! 提供前端调用的完整 API

use crate::{DatabaseState, HistoryItem, SyncDataItem, QueryOptions, DatabaseStatistics, DataFilter, Pagination, SortInfo, FilterResult, InsertItem, InsertResult};
use tauri::State;

/// 设置数据库路径并初始化 - 仅用于插件内部，不供前端调用
#[tauri::command]
pub fn set_database_path(
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut db = state.blocking_lock();

    // 如果已经初始化，直接返回
    if db.is_initialized() {
        return Ok(());
    }

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
        order_by: Some("time DESC".to_string()),
        where_clause: None,
    };
    db.query_history(options)
}

/// 查询历史记录（带自定义筛选条件）
#[tauri::command]
pub fn query_history_with_filter(
    where_clause: Option<String>,
    order_by: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
    state: State<'_, DatabaseState>,
) -> Result<Vec<HistoryItem>, String> {
    let db = state.blocking_lock();
    let options = QueryOptions {
        only_favorites: false,
        exclude_deleted: true,
        limit,
        offset,
        order_by,
        where_clause,
    };
    db.query_history(options)
}

/// 插入数据（带去重功能）
#[tauri::command]
pub async fn insert_with_deduplication(
    item: InsertItem,
    state: State<'_, DatabaseState>,
) -> Result<InsertResult, String> {
    let db = state.lock().await;
    db.insert_with_deduplication(&item).await
}

/// 标记删除（软删除）
#[tauri::command]
pub fn mark_deleted(
    id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut db = state.blocking_lock();
    let current_time = chrono::Utc::now().timestamp_millis();

    db.update_field(&id, "deleted", "1")?;
    db.update_field(&id, "time", &current_time.to_string())?;

    // 使用新的统一变更跟踪器
    let conn = db.get_connection()?;
    db.get_change_tracker().mark_item_changed(&conn, &id, "delete")?;

    Ok(())
}

/// 硬删除
#[tauri::command]
pub fn hard_delete(
    id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let db = state.blocking_lock();
    db.hard_delete(&id)
}

/// 批量硬删除
#[tauri::command]
pub fn batch_hard_delete(
    ids: Vec<String>,
    state: State<'_, DatabaseState>,
) -> Result<usize, String> {
    let db = state.blocking_lock();
    db.batch_hard_delete(&ids)
}

/// 获取统计信息
#[tauri::command]
pub fn get_statistics(
    state: State<'_, DatabaseState>,
) -> Result<DatabaseStatistics, String> {
    let db = state.blocking_lock();
    db.get_statistics()
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
    let mut db = state.blocking_lock();
    let current_time = chrono::Utc::now().timestamp_millis();

    // 验证字段名并更新
    match field.as_str() {
        "favorite" => {
            let bool_value = value == "1" || value.to_lowercase() == "true";
            db.update_field(&id, "favorite", if bool_value { "1" } else { "0" })?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "favorite")?;
        }
        "note" => {
            db.update_field(&id, "note", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "note")?;
        }
        "content" => {
            db.update_field(&id, "value", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "content")?;
        }
        "type" => {
            db.update_field(&id, "type", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "type")?;
        }
        "subtype" => {
            db.update_field(&id, "subtype", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "subtype")?;
        }
        "time" => {
            db.update_field(&id, "time", &value)?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "time")?;
        }
        "syncStatus" => {
            db.update_field(&id, "syncStatus", &value)?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "sync_status")?;
        }
        "isCode" => {
            let bool_value = value == "1" || value.to_lowercase() == "true";
            db.update_field(&id, "isCode", if bool_value { "1" } else { "0" })?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "isCode")?;
        }
        "codeLanguage" => {
            db.update_field(&id, "codeLanguage", &value)?;
            db.update_field(&id, "time", &current_time.to_string())?;
            let conn = db.get_connection()?;
            db.get_change_tracker().mark_item_changed(&conn, &id, "codeLanguage")?;
        }
        _ => return Err(format!("不支持的字段名: {}", field)),
    }

    Ok(())
}

/// 标记为已变更状态
#[tauri::command]
pub fn mark_changed(
    id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut db = state.blocking_lock();
    let current_time = chrono::Utc::now().timestamp_millis();

    db.update_field(&id, "syncStatus", "changed")?;
    db.update_field(&id, "time", &current_time.to_string())?;

    // 使用新的统一变更跟踪器
    let conn = db.get_connection()?;
    db.get_change_tracker().mark_item_changed(&conn, &id, "manual")?;

    Ok(())
}

/// 批量标记为已变更状态
#[tauri::command]
pub fn batch_mark_changed(
    ids: Vec<String>,
    state: State<'_, DatabaseState>,
) -> Result<usize, String> {
    let mut db = state.blocking_lock();
    let current_time = chrono::Utc::now().timestamp_millis();
    let mut count = 0;

    for id in &ids {
        if db.update_field(id, "syncStatus", "changed").is_ok() {
            // 同时更新时间
            if db.update_field(id, "time", &current_time.to_string()).is_ok() {
                // 使用新的统一变更跟踪器
                let conn = db.get_connection()?;
                if let Err(e) = db.get_change_tracker().mark_item_changed(&conn, id, "manual") {
                    log::warn!("标记变更失败: {}", e);
                } else {
                    count += 1;
                }
            }
        }
    }

    Ok(count)
}

/// 批量标记删除（软删除）
#[tauri::command]
pub fn batch_mark_deleted(
    ids: Vec<String>,
    state: State<'_, DatabaseState>,
) -> Result<usize, String> {
    let mut db = state.blocking_lock();
    let current_time = chrono::Utc::now().timestamp_millis();
    let mut count = 0;

    for id in &ids {
        if db.update_field(id, "deleted", "1").is_ok() {
            // 同时更新时间
            if db.update_field(id, "time", &current_time.to_string()).is_ok() {
                // 使用新的统一变更跟踪器
                let conn = db.get_connection()?;
                if let Err(e) = db.get_change_tracker().mark_item_changed(&conn, id, "delete") {
                    log::warn!("标记删除失败: {}", e);
                } else {
                    count += 1;
                }
            }
        }
    }

    Ok(count)
}

/// 获取已变更项目数量
#[tauri::command]
pub fn get_changed_items_count(
    state: State<'_, DatabaseState>,
) -> usize {
    let mut db = state.blocking_lock();
    db.get_change_tracker().count()
}

/// 获取所有已变更的项目ID
#[tauri::command]
pub fn get_changed_items_list(
    state: State<'_, DatabaseState>,
) -> Vec<String> {
    let mut db = state.blocking_lock();
    db.get_change_tracker().get_changed_items()
}

/// 使用筛选器查询数据
#[tauri::command]
pub fn query_with_filter(
    filter: DataFilter,
    pagination: Option<Pagination>,
    sort: Option<SortInfo>,
    state: State<'_, DatabaseState>,
) -> Result<FilterResult<HistoryItem>, String> {
    let db = state.blocking_lock();

    // 先获取总数（用于分页）
    let total_options = QueryOptions {
        where_clause: None,
        order_by: None,
        limit: None,
        offset: None,
        only_favorites: filter.base_filter.only_favorites,
        exclude_deleted: filter.base_filter.exclude_deleted,
    };

    let all_items = db.query_history(total_options)?;
    let total = all_items.len();

    // 获取分页数据
    let pagination_clone = pagination.clone();
    let options = filter.to_query_options(pagination, sort);
    let items = db.query_history(options)?;

    // 计算是否有更多数据
    let has_more = if let Some(ref pagination) = pagination_clone {
        if let (Some(_limit), Some(offset)) = (pagination.limit, pagination.offset) {
            let current_count = items.len();
            let next_offset = offset + current_count as i32;
            next_offset < total as i32
        } else {
            false
        }
    } else {
        false
    };

    Ok(FilterResult {
        data: items,
        total,
        has_more,
    })
}

/// 根据同步模式筛选数据（供同步引擎使用）
#[tauri::command]
pub fn query_for_sync(
    only_favorites: bool,
    include_images: bool,
    include_files: bool,
    content_types: crate::ContentTypeFilter,
    state: State<'_, DatabaseState>,
) -> Result<Vec<SyncDataItem>, String> {
    let db = state.blocking_lock();

    // 构建筛选器
    let filter = DataFilter {
        base_filter: crate::BaseFilter {
            only_favorites,
            exclude_deleted: false, // 同步需要包含已删除的项目
            content_types: content_types.clone(),
        },
        group_filter: None,
        search_filter: None,
        sync_filter: Some(crate::SyncModeFilter {
            only_favorites,
            include_images,
            include_files,
            content_types,
        }),
    };

    let options = filter.to_query_options(None, None);
    let history_items = db.query_history(options)?;

    log::info!("🔍 同步模式筛选查询: only_favorites={}, include_images={}, include_files={}, 结果数量={}",
        only_favorites, include_images, include_files, history_items.len());

    Ok(history_items.into_iter().map(SyncDataItem::from).collect())
}

/// 搜索数据
#[tauri::command]
pub fn search_data(
    keyword: String,
    only_favorites: Option<bool>,
    exclude_deleted: Option<bool>,
    pagination: Option<Pagination>,
    state: State<'_, DatabaseState>,
) -> Result<FilterResult<HistoryItem>, String> {
    let db = state.blocking_lock();

    let filter = DataFilter {
        base_filter: crate::BaseFilter {
            only_favorites: only_favorites.unwrap_or(false),
            exclude_deleted: exclude_deleted.unwrap_or(true),
            content_types: crate::ContentTypeFilter::default(),
        },
        group_filter: None,
        search_filter: Some(crate::SearchFilter {
            keyword,
            search_fields: vec![crate::SearchField::All],
        }),
        sync_filter: None,
    };

    let options = filter.to_query_options(pagination, None);
    let where_clause = options.where_clause.clone();
    let items = db.query_history(options)?;

    // 计算总数
    let total_options = QueryOptions {
        where_clause,
        order_by: None,
        limit: None,
        offset: None,
        only_favorites: filter.base_filter.only_favorites,
        exclude_deleted: filter.base_filter.exclude_deleted,
    };

    let total = db.query_history(total_options)?.len();

    Ok(FilterResult {
        data: items,
        total,
        has_more: false,
    })
}

/// 按分组查询数据
#[tauri::command]
pub fn query_by_group(
    group_name: Option<String>,
    only_favorites: Option<bool>,
    exclude_deleted: Option<bool>,
    pagination: Option<Pagination>,
    state: State<'_, DatabaseState>,
) -> Result<FilterResult<HistoryItem>, String> {
    let db = state.blocking_lock();

    let filter = DataFilter {
        base_filter: crate::BaseFilter {
            only_favorites: only_favorites.unwrap_or(false),
            exclude_deleted: exclude_deleted.unwrap_or(true),
            content_types: crate::ContentTypeFilter::default(),
        },
        group_filter: Some(crate::GroupFilter { group_name }),
        search_filter: None,
        sync_filter: None,
    };

    let options = filter.to_query_options(pagination, None);
    let where_clause = options.where_clause.clone();
    let items = db.query_history(options)?;

    // 计算总数
    let total_options = QueryOptions {
        where_clause,
        order_by: None,
        limit: None,
        offset: None,
        only_favorites: filter.base_filter.only_favorites,
        exclude_deleted: filter.base_filter.exclude_deleted,
    };

    let total = db.query_history(total_options)?.len();

    Ok(FilterResult {
        data: items,
        total,
        has_more: false,
    })
}

/// 获取所有分组列表
#[tauri::command]
pub fn get_all_groups(
    state: State<'_, DatabaseState>,
) -> Result<Vec<String>, String> {
    let db = state.blocking_lock();

    let options = QueryOptions {
        where_clause: None,
        order_by: Some("[group] ASC".to_string()),
        limit: None,
        offset: None,
        only_favorites: false,
        exclude_deleted: true,
    };

    let items = db.query_history(options)?;

    // 提取分组名称并去重
    let mut groups = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for item in items {
        if let Some(group) = item.group {
            if !seen.contains(&group) {
                seen.insert(group.clone());
                groups.push(group);
            }
        }
    }

    Ok(groups)
}

/// 获取筛选后的统计信息
#[tauri::command]
pub fn get_filtered_statistics(
    filter: DataFilter,
    state: State<'_, DatabaseState>,
) -> Result<DatabaseStatistics, String> {
    let db = state.blocking_lock();

    let options = QueryOptions {
        where_clause: None,
        order_by: None,
        limit: None,
        offset: None,
        only_favorites: filter.base_filter.only_favorites,
        exclude_deleted: filter.base_filter.exclude_deleted,
    };

    let items = db.query_history(options)?;

    let total = items.len();
    let active = items.iter().filter(|item| item.deleted.unwrap_or(0) == 0).count();
    let favorites = items.iter().filter(|item| item.favorite != 0).count();

    let synced = items
        .iter()
        .filter(|item| item.sync_status.as_ref().map_or(false, |s| s == "synced"))
        .count();

    Ok(DatabaseStatistics {
        total_items: total,
        active_items: active,
        synced_items: synced,
        favorite_items: favorites,
    })
}
