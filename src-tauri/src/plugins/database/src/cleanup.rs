//! 历史记录自动清理模块
//! 根据前端配置的历史记录保留规则进行后台清理
//! 清理逻辑：
//! 1. 清理超过保留天数的记录（不影响收藏）
//! 2. 如果总数超过保留条数，清理最早的记录（不影响收藏）

use crate::DatabaseState;
use tauri::State;

/// 清理规则配置
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRule {
    /// 保留天数，0 表示不限制
    pub retain_days: i32,
    /// 保留条数，0 表示不限制
    pub retain_count: i32,
}

/// 执行历史记录自动清理
#[tauri::command]
pub fn cleanup_history(
    rule: CleanupRule,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut db = state.blocking_lock();
    let mut deleted_count = 0usize;

    // 1. 清理超过保留天数的记录（不影响收藏）
    if rule.retain_days > 0 {
        let cutoff_time = chrono::Utc::now()
            - chrono::Duration::days(rule.retain_days as i64);

        deleted_count += delete_items_by_time_condition(&mut db, cutoff_time.timestamp_millis())?;
    }

    // 2. 如果总数超过保留条数，清理最早的记录（不影响收藏）
    if rule.retain_count > 0 {
        let current_count = get_active_count(&db)?;
        let excess_count = current_count.saturating_sub(rule.retain_count as usize);

        if excess_count > 0 {
            deleted_count += delete_oldest_non_favorites(&mut db, excess_count)?;
        }
    }

    log::info!(
        "历史记录自动清理完成: 删除 {} 条记录 (保留天数={}, 保留条数={})",
        deleted_count,
        rule.retain_days,
        rule.retain_count
    );

    Ok(())
}

/// 删除指定时间之前的非收藏项目
fn delete_items_by_time_condition(
    db: &mut crate::DatabaseManager,
    cutoff_time: i64,
) -> Result<usize, String> {
    let conn = db.get_connection()?;

    // 标记删除超过 cutoff_time 的非收藏记录
    let sql = r#"
        UPDATE history SET deleted = 1, time = ?
        WHERE (deleted IS NULL OR deleted = 0)
          AND favorite = 0
          AND time < ?
    "#;

    let current_time = chrono::Utc::now().timestamp_millis();
    let count = conn
        .execute(sql, [current_time, cutoff_time])
        .map_err(|e| format!("删除失败: {}", e))?;

    Ok(count)
}

/// 删除最早的非收藏项目
fn delete_oldest_non_favorites(
    db: &mut crate::DatabaseManager,
    limit: usize,
) -> Result<usize, String> {
    let conn = db.get_connection()?;

    // 先查询出要删除的ID列表
    let sql = r#"
        SELECT id FROM history
        WHERE (deleted IS NULL OR deleted = 0)
          AND favorite = 0
        ORDER BY time ASC
        LIMIT ?
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map([limit as i32], |row| row.get::<_, String>(0))
        .map_err(|e| format!("查询失败: {}", e))?;

    let mut ids: Vec<String> = Vec::new();
    for row in rows {
        match row {
            Ok(id) => ids.push(id),
            Err(e) => log::warn!("解析ID失败: {}", e),
        }
    }

    if ids.is_empty() {
        return Ok(0);
    }

    // 批量标记删除
    let current_time = chrono::Utc::now().timestamp_millis();
    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let update_sql = format!(
        "UPDATE history SET deleted = 1, time = ? WHERE id IN ({})",
        placeholders.join(", ")
    );

    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&current_time];
    for id in &ids {
        params.push(id);
    }

    let count = conn
        .execute(&update_sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| format!("删除失败: {}", e))?;

    Ok(count)
}

/// 获取活跃记录总数（未删除）
fn get_active_count(db: &crate::DatabaseManager) -> Result<usize, String> {
    let conn = db.get_connection()?;

    let count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM history WHERE deleted IS NULL OR deleted = 0",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("查询失败: {}", e))?;

    Ok(count as usize)
}
