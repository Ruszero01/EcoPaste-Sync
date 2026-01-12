//! 调试专用模块
//! 包含调试和开发时使用的命令，与生产环境隔离

use crate::DatabaseState;
use serde::Serialize;
use tauri::State;

/// 数据库信息（调试用）
#[derive(Debug, Default, Serialize)]
pub struct DatabaseInfo {
    pub total_count: i64,
    pub active_count: i64,
    pub deleted_count: i64,
    pub favorite_count: i64,
    #[serde(default)]
    pub type_counts: Vec<(String, i64)>,
    #[serde(default)]
    pub sync_status_counts: Vec<(String, i64)>,
    pub recent_records_count: i64,
}

/// 获取数据库统计信息（调试用）
#[tauri::command]
pub fn get_database_info(state: State<'_, DatabaseState>) -> Result<DatabaseInfo, String> {
    let db = state.blocking_lock();
    let conn = db.get_connection().map_err(|e| e.to_string())?;

    // 基本统计
    let total_count: i64 = conn.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
        .map_err(|e| format!("查询总数失败: {}", e))?;

    let active_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM history WHERE deleted = 0",
        [],
        |r| r.get(0),
    ).map_err(|e| format!("查询活跃数失败: {}", e))?;

    let deleted_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM history WHERE deleted = 1",
        [],
        |r| r.get(0),
    ).map_err(|e| format!("查询已删除数失败: {}", e))?;

    let favorite_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM history WHERE favorite = 1",
        [],
        |r| r.get(0),
    ).map_err(|e| format!("查询收藏数失败: {}", e))?;

    // 类型分布
    let mut type_stmt = conn.prepare("SELECT type, COUNT(*) FROM history GROUP BY type")
        .map_err(|e| format!("准备类型查询失败: {}", e))?;
    let type_counts: Vec<(String, i64)> = type_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get(1)?,
            ))
        })
        .map_err(|e| format!("查询类型分布失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // 同步状态分布
    let mut status_stmt = conn.prepare("SELECT syncStatus, COUNT(*) FROM history GROUP BY syncStatus")
        .map_err(|e| format!("准备状态查询失败: {}", e))?;
    let sync_status_counts: Vec<(String, i64)> = status_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get(1)?,
            ))
        })
        .map_err(|e| format!("查询状态分布失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // 最近记录数（7天内）
    let recent_records_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM history WHERE time > strftime('%s', 'now') - 7 * 24 * 60 * 60",
        [],
        |r| r.get(0),
    ).map_err(|e| format!("查询最近记录数失败: {}", e))?;

    Ok(DatabaseInfo {
        total_count,
        active_count,
        deleted_count,
        favorite_count,
        type_counts,
        sync_status_counts,
        recent_records_count,
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
