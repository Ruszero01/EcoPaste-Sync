//! 调试专用模块
//! 包含调试和开发时使用的命令，与生产环境隔离

use crate::{DatabaseManager, DatabaseState};
use tauri::State;

/// 数据库信息结构
#[derive(Debug, serde::Serialize)]
pub struct DatabaseInfo {
    pub total_count: usize,
    pub active_count: usize,
    pub deleted_count: usize,
    pub favorite_count: usize,
    pub type_counts: std::collections::HashMap<String, usize>,
    pub sync_status_counts: std::collections::HashMap<String, usize>,
    pub recent_records_count: usize,
}

/// 获取数据库统计信息（调试用）
#[tauri::command]
pub async fn get_database_info(state: State<'_, DatabaseState>) -> Result<DatabaseInfo, String> {
    let db = state.lock().await;

    // 获取基本统计信息
    let total_count = db.get_statistics()?.total_items;
    let active_count = db.get_statistics()?.active_items;
    let favorite_count = db.get_statistics()?.favorite_items;

    // 计算已删除数量
    let deleted_count = total_count - active_count;

    // 获取类型统计
    let type_counts = get_type_counts(&db)?;

    // 获取同步状态统计
    let sync_status_counts = get_sync_status_counts(&db)?;

    // 获取最近记录数量（最多10条）
    let recent_records = db.query_history(crate::QueryOptions {
        where_clause: None,
        order_by: Some("time DESC".to_string()),
        limit: Some(10),
        offset: None,
        only_favorites: false,
        exclude_deleted: false,
        params: None,
    })?;

    Ok(DatabaseInfo {
        total_count,
        active_count,
        deleted_count,
        favorite_count,
        type_counts,
        sync_status_counts,
        recent_records_count: recent_records.len(),
    })
}

/// 重置数据库（调试用）
#[tauri::command]
pub async fn reset_database(state: State<'_, DatabaseState>) -> Result<bool, String> {
    let db = state.lock().await;

    log::warn!("🔄 开始重置数据库（调试操作）");

    // 清空所有数据
    let conn = db.get_connection()?;
    conn.execute_batch("DELETE FROM history;")
        .map_err(|e| format!("清空数据失败: {}", e))?;

    // 压缩数据库文件
    conn.execute_batch("VACUUM;")
        .map_err(|e| format!("压缩数据库失败: {}", e))?;

    log::info!("✅ 数据库重置成功");

    Ok(true)
}

/// 获取各类型记录数统计
fn get_type_counts(
    db: &DatabaseManager,
) -> Result<std::collections::HashMap<String, usize>, String> {
    let conn = db.get_connection()?;

    let mut stmt = conn
        .prepare("SELECT type, COUNT(*) as count FROM history WHERE deleted = 0 GROUP BY type")
        .map_err(|e| format!("查询类型统计失败: {}", e))?;

    let mut type_counts = std::collections::HashMap::new();
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
        })
        .map_err(|e| format!("解析类型统计失败: {}", e))?;

    for row in rows {
        let (item_type, count) = row.map_err(|e| format!("读取类型统计失败: {}", e))?;
        type_counts.insert(item_type, count);
    }

    Ok(type_counts)
}

/// 获取同步状态统计
fn get_sync_status_counts(
    db: &DatabaseManager,
) -> Result<std::collections::HashMap<String, usize>, String> {
    let conn = db.get_connection()?;

    let mut stmt = conn.prepare(
        "SELECT syncStatus, COUNT(*) as count FROM history WHERE deleted = 0 GROUP BY syncStatus"
    ).map_err(|e| format!("查询同步状态统计失败: {}", e))?;

    let mut sync_status_counts = std::collections::HashMap::new();
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)
                    .unwrap_or_else(|_| "none".to_string()),
                row.get::<_, i64>(1)? as usize,
            ))
        })
        .map_err(|e| format!("解析同步状态统计失败: {}", e))?;

    for row in rows {
        let (sync_status, count) = row.map_err(|e| format!("读取同步状态统计失败: {}", e))?;
        sync_status_counts.insert(sync_status, count);
    }

    Ok(sync_status_counts)
}
