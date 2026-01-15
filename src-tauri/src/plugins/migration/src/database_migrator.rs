//! 数据库迁移模块
//!
//! 迁移策略：
//! 1. 迁移插件最先运行（比 database 插件早）
//! 2. 检测旧版本数据库（通过 createTime 列识别）
//! 3. 读取旧数据并转换为新版格式
//! 4. 删除旧数据库
//! 5. 直接创建新版数据库并写入数据
//! 6. database 插件启动时直接使用已创建的新版数据库

use crate::models::MigrationProgress;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

/// 完整迁移流程：导出 → 删除 → 创建新版 → 写入
pub fn migrate_database(
    old_db_path: &PathBuf,
    new_db_path: &PathBuf,
    progress_callback: impl Fn(MigrationProgress) + Send + 'static,
) -> Result<(usize, u64), String> {
    let start_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // 1. 从旧数据库读取数据
    progress_callback(MigrationProgress {
        current_phase: "导出旧数据".to_string(),
        processed_items: 0,
        total_items: 0,
        percentage: 0.0,
        current_operation: "正在读取旧版数据库...".to_string(),
        completed: false,
        error: None,
    });

    let old_conn = Connection::open(old_db_path).map_err(|e| format!("打开旧数据库失败: {}", e))?;

    let total: i32 = old_conn
        .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
        .map_err(|e| format!("统计记录数失败: {}", e))?;

    let mut stmt = old_conn
        .prepare(
            r#"
            SELECT id, type, "group", value, search, count, width, height,
                   favorite, createTime, note, subtype, deleted, syncStatus,
                   lastModified, sourceAppName, sourceAppIcon, position
            FROM history
            "#,
        )
        .map_err(|e| format!("准备查询失败: {}", e))?;

    let mut legacy_items = Vec::new();
    let mut processed = 0;

    let item_iter = stmt
        .query_map([], |row| {
            let sync_status: String = row.get(13)?;
            // syncing 也映射为 not_synced，changed 用默认值
            let new_sync_status = match sync_status.as_str() {
                "synced" => "synced".to_string(),
                _ => "not_synced".to_string(),
            };

            let create_time: i64 = row.get(9)?;
            let last_modified: i64 = row.get(17)?;
            // 取两个时间戳中较大的那个
            let time = if create_time > last_modified {
                create_time
            } else {
                last_modified
            };

            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                time,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, i32>(12)?,
                new_sync_status,
                row.get::<_, String>(14)?,
                row.get::<_, String>(15)?,
                row.get::<_, i32>(16)?,
            ))
        })
        .map_err(|e| format!("执行查询失败: {}", e))?;

    for item in item_iter {
        legacy_items.push(item.map_err(|e| format!("读取记录失败: {}", e))?);
        processed += 1;
        if processed % 100 == 0 {
            let percentage = (processed as f64 / total as f64) * 100.0;
            progress_callback(MigrationProgress {
                current_phase: "导出旧数据".to_string(),
                processed_items: processed as usize,
                total_items: total as usize,
                percentage,
                current_operation: format!("已读取 {}/{} 条", processed, total),
                completed: false,
                error: None,
            });
        }
    }

    progress_callback(MigrationProgress {
        current_phase: "导出旧数据".to_string(),
        processed_items: processed as usize,
        total_items: total as usize,
        percentage: 100.0,
        current_operation: format!("导出完成，共 {} 条", processed),
        completed: true,
        error: None,
    });

    // 释放查询语句和连接
    drop(stmt);
    drop(old_conn);

    // 2. 删除旧数据库
    progress_callback(MigrationProgress {
        current_phase: "删除旧数据库".to_string(),
        processed_items: 0,
        total_items: 0,
        percentage: 0.0,
        current_operation: "正在删除旧版数据库...".to_string(),
        completed: false,
        error: None,
    });

    fs::remove_file(old_db_path).map_err(|e| format!("删除旧数据库失败: {}", e))?;
    log::info!("[Migration] 已删除旧数据库");

    // 3. 创建新版数据库
    progress_callback(MigrationProgress {
        current_phase: "创建新数据库".to_string(),
        processed_items: 0,
        total_items: 0,
        percentage: 0.0,
        current_operation: "正在创建新版数据库...".to_string(),
        completed: false,
        error: None,
    });

    let new_conn = Connection::open(new_db_path).map_err(|e| format!("创建新数据库失败: {}", e))?;

    // 创建表
    new_conn
        .execute(
            r#"
        CREATE TABLE history (
            id TEXT PRIMARY KEY,
            type TEXT,
            "group" TEXT,
            value TEXT,
            search TEXT,
            count INTEGER,
            width INTEGER,
            height INTEGER,
            favorite INTEGER NOT NULL DEFAULT 0,
            time INTEGER NOT NULL DEFAULT 0,
            note TEXT,
            subtype TEXT,
            deleted INTEGER NOT NULL DEFAULT 0,
            syncStatus TEXT,
            sourceAppName TEXT,
            sourceAppIcon TEXT,
            position INTEGER NOT NULL DEFAULT 0
        )
        "#,
            [],
        )
        .map_err(|e| format!("创建表失败: {}", e))?;

    // 创建索引
    new_conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_history_deleted ON history(deleted)",
            [],
        )
        .ok();
    new_conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_history_favorite ON history(favorite)",
            [],
        )
        .ok();
    new_conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_history_syncStatus ON history(syncStatus)",
            [],
        )
        .ok();
    new_conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_history_time ON history(time DESC)",
            [],
        )
        .ok();
    new_conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_history_type ON history(type)",
            [],
        )
        .ok();

    log::info!("[Migration] 已创建新版数据库");

    // 4. 写入转换后的数据
    progress_callback(MigrationProgress {
        current_phase: "写入新数据".to_string(),
        processed_items: 0,
        total_items: legacy_items.len(),
        percentage: 0.0,
        current_operation: "正在写入新版数据库...".to_string(),
        completed: false,
        error: None,
    });

    new_conn
        .execute("BEGIN TRANSACTION", [])
        .map_err(|e| format!("开始事务失败: {}", e))?;

    let mut inserted = 0;
    for item in &legacy_items {
        // 使用占位符绑定参数
        new_conn
            .execute(
                "INSERT INTO history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    &item.0,
                    &item.1,
                    &item.2,
                    &item.3,
                    &item.4,
                    &item.5,
                    &item.6,
                    &item.7,
                    &item.8,
                    &item.9.to_string(),
                    &item.10,
                    &item.11,
                    &item.12.to_string(),
                    &item.13,
                    &item.14,
                    &item.15,
                    &item.16.to_string(),
                ],
            )
            .map_err(|e| format!("插入失败 ({}): {}", item.0, e))?;

        inserted += 1;
        if inserted % 100 == 0 {
            let percentage = (inserted as f64 / legacy_items.len() as f64) * 100.0;
            progress_callback(MigrationProgress {
                current_phase: "写入新数据".to_string(),
                processed_items: inserted,
                total_items: legacy_items.len(),
                percentage,
                current_operation: format!("已写入 {}/{} 条", inserted, legacy_items.len()),
                completed: false,
                error: None,
            });
        }
    }

    new_conn
        .execute("COMMIT", [])
        .map_err(|e| format!("提交事务失败: {}", e))?;

    let end_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let duration_ms = (end_time - start_time) as u64;

    progress_callback(MigrationProgress {
        current_phase: "迁移完成".to_string(),
        processed_items: inserted,
        total_items: inserted,
        percentage: 100.0,
        current_operation: format!("成功迁移 {} 条，耗时 {}ms", inserted, duration_ms),
        completed: true,
        error: None,
    });

    Ok((inserted, duration_ms))
}

/// 迁移旧版配置到新版格式
pub fn migrate_config(store_path: &PathBuf) -> Result<(), String> {
    if !store_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(store_path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    let mut json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    let cloud_sync = json
        .get_mut("globalStore")
        .and_then(|v| v.get_mut("cloudSync"))
        .ok_or_else(|| "找不到 cloudSync 配置".to_string())?;

    if cloud_sync.get("syncModeConfig").is_none() {
        let sync_mode_config = serde_json::json!({
            "autoSync": false,
            "autoSyncIntervalMinutes": 5,
            "onlyFavorites": false,
            "includeImages": false,
            "includeFiles": false,
            "contentTypes": {
                "includeText": true,
                "includeHtml": true,
                "includeRtf": true,
                "includeMarkdown": true
            },
            "conflictResolution": "local",
            "deviceId": ""
        });

        cloud_sync["syncModeConfig"] = sync_mode_config;

        let updated_content = serde_json::to_string_pretty(&json)
            .map_err(|e| format!("序列化配置文件失败: {}", e))?;

        fs::write(store_path, updated_content).map_err(|e| format!("写入配置文件失败: {}", e))?;

        log::info!("[Migration] 已更新配置文件格式");
    }

    Ok(())
}
