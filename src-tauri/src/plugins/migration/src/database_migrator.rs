//! 数据库迁移模块
//! 执行数据库结构迁移和数据转换
//!
//! 迁移内容：
//! 1. createTime (字符串时间) → time (Unix 时间戳)
//! 2. 同步状态映射：none→not_synced, syncing→changed, error→not_synced
//! 3. 添加缺失的列：sourceAppName, sourceAppIcon, position
//! 4. 确保必要索引存在

use crate::models::MigrationProgress;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

/// 执行数据库迁移
pub fn migrate_database(
    db_path: &PathBuf,
    progress_callback: impl Fn(MigrationProgress) + Send + 'static,
) -> Result<(usize, u64), String> {
    let start_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {}", e))?;

    // 1. 检测旧版本数据库特征
    let has_create_time = conn
        .prepare("SELECT createTime FROM history LIMIT 1")
        .is_ok();

    // 2. 如果存在 createTime 列，进行时间戳转换
    if has_create_time {
        progress_callback(MigrationProgress {
            current_phase: "转换时间戳格式".to_string(),
            processed_items: 0,
            total_items: 0,
            percentage: 0.0,
            current_operation: "将 createTime 转换为 Unix 时间戳".to_string(),
            completed: false,
            error: None,
        });

        // 统计需要转换的行数
        let time_to_convert: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM history WHERE time IS NULL OR time = 0",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if time_to_convert > 0 {
            // 执行时间转换
            // 尝试解析 ISO 8601 时间格式并转换为 Unix 时间戳
            // 如果解析失败，使用当前时间
            conn.execute(
                r#"
                UPDATE history SET time = COALESCE(
                    CAST(
                        CASE
                            WHEN length(createTime) = 13 AND createTime GLOB '[0-9]*'
                            THEN createTime
                            WHEN createTime LIKE '%-%-%'
                            THEN CAST(
                                COALESCE(
                                    (julianday(substr(createTime, 1, 19)) - 2440587.5) * 86400000,
                                    (strftime('%s', substr(createTime, 1, 19)) * 1000)
                                ) AS INTEGER
                            )
                            ELSE NULL
                        END
                    AS INTEGER),
                    (strftime('%s', 'now') * 1000)
                )
                WHERE createTime IS NOT NULL AND (time IS NULL OR time = 0)
                "#,
                [],
            )
            .map_err(|e| format!("转换时间戳失败: {}", e))?;

            log::info!("[Migration] 已转换 {} 条时间戳记录", time_to_convert);
        }
    }

    // 3. 检查是否需要添加新列
    let needs_source_app_name = conn
        .prepare("SELECT sourceAppName FROM history LIMIT 1")
        .is_err();

    let needs_source_app_icon = conn
        .prepare("SELECT sourceAppIcon FROM history LIMIT 1")
        .is_err();

    let needs_position = conn
        .prepare("SELECT position FROM history LIMIT 1")
        .is_err();

    // 4. 添加缺失的列
    if needs_source_app_name {
        progress_callback(MigrationProgress {
            current_phase: "添加 sourceAppName 列".to_string(),
            processed_items: 0,
            total_items: 0,
            percentage: 0.0,
            current_operation: "执行 ALTER TABLE".to_string(),
            completed: false,
            error: None,
        });

        conn.execute("ALTER TABLE history ADD COLUMN sourceAppName TEXT", [])
            .map_err(|e| format!("添加 sourceAppName 列失败: {}", e))?;
    }

    if needs_source_app_icon {
        conn.execute("ALTER TABLE history ADD COLUMN sourceAppIcon TEXT", [])
            .map_err(|e| format!("添加 sourceAppIcon 列失败: {}", e))?;
    }

    if needs_position {
        conn.execute(
            "ALTER TABLE history ADD COLUMN position INTEGER DEFAULT 0",
            [],
        )
        .map_err(|e| format!("添加 position 列失败: {}", e))?;
    }

    // 5. 确保索引存在
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_deleted ON history(deleted)",
        [],
    )
    .map_err(|e| format!("创建 idx_history_deleted 索引失败: {}", e))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_favorite ON history(favorite)",
        [],
    )
    .map_err(|e| format!("创建 idx_history_favorite 索引失败: {}", e))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_syncStatus ON history(syncStatus)",
        [],
    )
    .map_err(|e| format!("创建 idx_history_syncStatus 索引失败: {}", e))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_time ON history(time)",
        [],
    )
    .map_err(|e| format!("创建 idx_history_time 索引失败: {}", e))?;

    // 6. 初始化 position 字段（如果没有）
    conn.execute(
        "UPDATE history SET position = rowid WHERE (position = 0 OR position IS NULL) AND position IS NOT 1",
        [],
    )
    .ok();

    // 7. 统计迁移的项目数
    let total_items: i32 = conn
        .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
        .map_err(|e| format!("统计项目数失败: {}", e))?;

    // 8. 更新同步状态（如果需要）
    // 旧版：none, synced, syncing, error
    // 新版：not_synced, synced, changed
    let needs_sync_status_update = conn
        .prepare("SELECT COUNT(*) FROM history WHERE syncStatus IN ('none', 'syncing', 'error')")
        .map(|mut stmt| stmt.query_row([], |row| row.get::<_, i32>(0)))
        .and_then(|r| r)
        .unwrap_or(0);

    if needs_sync_status_update > 0 {
        progress_callback(MigrationProgress {
            current_phase: "更新同步状态".to_string(),
            processed_items: 0,
            total_items: needs_sync_status_update as usize,
            percentage: 0.0,
            current_operation: "映射旧版 syncStatus 到新版".to_string(),
            completed: false,
            error: None,
        });

        // none → not_synced
        conn.execute(
            "UPDATE history SET syncStatus = 'not_synced' WHERE syncStatus = 'none'",
            [],
        )
        .ok();

        // syncing → changed (表示需要重新同步)
        conn.execute(
            "UPDATE history SET syncStatus = 'changed' WHERE syncStatus = 'syncing'",
            [],
        )
        .ok();

        // error → not_synced
        conn.execute(
            "UPDATE history SET syncStatus = 'not_synced' WHERE syncStatus = 'error'",
            [],
        )
        .ok();

        log::info!(
            "[Migration] 已更新 {} 条同步状态记录",
            needs_sync_status_update
        );
    }

    // 9. 初始化未设置的同步状态
    let uninitialized_sync_status: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM history WHERE syncStatus IS NULL OR syncStatus = ''",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if uninitialized_sync_status > 0 {
        conn.execute(
            "UPDATE history SET syncStatus = 'not_synced' WHERE syncStatus IS NULL OR syncStatus = ''",
            [],
        )
        .map_err(|e| format!("初始化同步状态失败: {}", e))?;
    }

    // 10. 更新 deleted 字段（如果需要）
    let uninitialized_deleted: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM history WHERE deleted IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if uninitialized_deleted > 0 {
        conn.execute("UPDATE history SET deleted = 0 WHERE deleted IS NULL", [])
            .map_err(|e| format!("初始化 deleted 字段失败: {}", e))?;
    }

    // 11. 确保 time 字段有值
    let uninitialized_time: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM history WHERE time IS NULL OR time = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if uninitialized_time > 0 {
        let now = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()) as i64;
        conn.execute(
            &format!(
                "UPDATE history SET time = {} WHERE time IS NULL OR time = 0",
                now
            ),
            [],
        )
        .ok();
    }

    let end_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let duration_ms = (end_time - start_time) as u64;

    progress_callback(MigrationProgress {
        current_phase: "数据库迁移完成".to_string(),
        processed_items: total_items as usize,
        total_items: total_items as usize,
        percentage: 100.0,
        current_operation: format!("迁移了 {} 个项目", total_items),
        completed: true,
        error: None,
    });

    Ok((total_items as usize, duration_ms))
}

/// 迁移旧版配置到新版格式
pub fn migrate_config(store_path: &PathBuf) -> Result<(), String> {
    if !store_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(store_path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    let mut json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    // 检查是否需要升级配置格式
    let cloud_sync = json
        .get_mut("globalStore")
        .and_then(|v| v.get_mut("cloudSync"))
        .ok_or_else(|| "找不到 cloudSync 配置".to_string())?;

    // 如果没有 syncModeConfig，添加它
    if cloud_sync.get("syncModeConfig").is_none() {
        // 从旧格式提取同步设置
        let include_images = cloud_sync
            .get("syncModeConfig")
            .and_then(|v| v.get("settings"))
            .and_then(|v| v.get("includeImages"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let include_files = cloud_sync
            .get("syncModeConfig")
            .and_then(|v| v.get("settings"))
            .and_then(|v| v.get("includeFiles"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let only_favorites = cloud_sync
            .get("syncModeConfig")
            .and_then(|v| v.get("settings"))
            .and_then(|v| v.get("onlyFavorites"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // 构建新的 syncModeConfig 结构
        let sync_mode_config = serde_json::json!({
            "autoSync": false,
            "autoSyncIntervalMinutes": 5,
            "onlyFavorites": only_favorites,
            "includeImages": include_images,
            "includeFiles": include_files,
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
    }

    // 写入更新后的配置
    let updated_content =
        serde_json::to_string_pretty(&json).map_err(|e| format!("序列化配置文件失败: {}", e))?;

    fs::write(store_path, updated_content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(())
}
