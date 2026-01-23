//! 数据库迁移模块
//!
//! 迁移策略（模拟 clipboard 插件的数据流程）：
//! 1. 读取旧数据库的 id、value、type、sourceAppName、sourceAppIcon、width、height、count
//! 2. 根据旧 type 判断数据类型（image/files/text等）
//! 3. 构建 InsertItem（和 clipboard 插件一样）
//! 4. 调用 database 插件插入

use crate::models::MigrationProgress;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

/// 迁移项结构（包含来源应用信息和元数据）
pub struct MigrationItem {
    pub id: String,
    pub value: String,
    /// 原始类型（来自旧数据库的 type 字段）
    pub item_type: String,
    /// 图片宽度（仅图片类型）
    pub width: Option<i32>,
    /// 图片高度（仅图片类型）
    pub height: Option<i32>,
    /// 文件大小/字符数（图片为文件大小，文件为第一个文件大小，文本为字符数）
    pub count: Option<i32>,
    pub source_app_name: Option<String>,
    pub source_app_icon: Option<String>,
}

/// 从备份数据库读取所有必要字段
pub async fn read_backup_db(
    backup_db_path: &PathBuf,
    progress_callback: impl Fn(MigrationProgress) + Send + 'static,
) -> Result<Vec<MigrationItem>, String> {
    // 1. 打开备份数据库
    progress_callback(MigrationProgress {
        current_phase: "读取备份数据".to_string(),
        processed_items: 0,
        total_items: 0,
        percentage: 0.0,
        current_operation: "正在打开备份数据库...".to_string(),
        completed: false,
        error: None,
    });

    let old_conn = Connection::open(backup_db_path)
        .map_err(|e| format!("打开备份数据库失败: {}", e))?;

    // 2. 统计总记录数
    let total: i32 = old_conn
        .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
        .map_err(|e| format!("统计记录数失败: {}", e))?;

    progress_callback(MigrationProgress {
        current_phase: "读取备份数据".to_string(),
        processed_items: 0,
        total_items: total as usize,
        percentage: 0.0,
        current_operation: format!("共 {} 条记录需要迁移", total),
        completed: false,
        error: None,
    });

    // 3. 读取所有必要字段
    // 注意：旧版本可能没有 type、width、height、count、sourceAppName、sourceAppIcon 字段
    let mut stmt = old_conn.prepare("SELECT id, value, type, COALESCE(width, 0), COALESCE(height, 0), COALESCE(count, 1), sourceAppName, sourceAppIcon FROM history")
        .map_err(|e| format!("准备查询失败: {}", e))?;

    let mut items = Vec::new();
    let mut processed = 0;

    let item_iter = stmt.query_map([], |row| {
        Ok(MigrationItem {
            id: row.get(0)?,
            value: row.get(1)?,
            item_type: row.get(2).ok().flatten().unwrap_or_else(|| "text".to_string()),
            width: row.get(3).map(|w| if w > 0 { Some(w) } else { None }).ok().flatten(),
            height: row.get(4).map(|h| if h > 0 { Some(h) } else { None }).ok().flatten(),
            count: row.get(5).map(|c| if c > 0 { Some(c) } else { None }).ok().flatten(),
            source_app_name: row.get(6).ok().flatten(),
            source_app_icon: row.get(7).ok().flatten(),
        })
    }).map_err(|e| format!("执行查询失败: {}", e))?;

    for item in item_iter {
        items.push(item.map_err(|e| format!("读取记录失败: {}", e))?);
        processed += 1;

        if processed % 100 == 0 || processed == total as usize {
            let percentage = (processed as f64 / total as f64) * 100.0;
            progress_callback(MigrationProgress {
                current_phase: "读取备份数据".to_string(),
                processed_items: processed as usize,
                total_items: total as usize,
                percentage,
                current_operation: format!("已读取 {}/{} 条", processed, total),
                completed: processed == total as usize,
                error: None,
            });
        }
    }

    drop(stmt);
    drop(old_conn);

    log::info!("[Migration] 从备份数据库读取了 {} 条记录", items.len());

    Ok(items)
}

/// 删除备份数据库文件
pub fn delete_backup_db(backup_db_path: &PathBuf) -> Result<(), String> {
    if backup_db_path.exists() {
        fs::remove_file(backup_db_path)
            .map_err(|e| format!("删除备份数据库失败: {}", e))?;
        log::info!("[Migration] 已删除备份数据库: {}", backup_db_path.display());
    }
    Ok(())
}
