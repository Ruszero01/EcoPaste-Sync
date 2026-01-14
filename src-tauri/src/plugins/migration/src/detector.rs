//! 迁移检测模块
//! 检测是否需要数据迁移以及迁移的范围

use crate::models::{MigrationCheckResult, MigrationStatus, MigrationType};
use std::fs;
use std::path::PathBuf;

/// 检测迁移状态
pub fn check_migration_status(
    data_dir: &PathBuf,
    is_dev: bool,
) -> Result<MigrationCheckResult, String> {
    let marker_path = get_migration_marker_path(data_dir, is_dev);
    let old_db_path = get_old_database_path(data_dir, is_dev);
    let new_db_path = get_new_database_path(data_dir, is_dev);
    let store_path = get_store_path(data_dir, is_dev);

    // 1. 检查是否已经完成迁移
    if marker_path.exists() {
        let content =
            fs::read_to_string(&marker_path).map_err(|e| format!("读取迁移标记文件失败: {}", e))?;

        let marker: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("解析迁移标记文件失败: {}", e))?;

        let success = marker
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if success {
            return Ok(MigrationCheckResult {
                status: MigrationStatus::UpToDate,
                old_version: marker
                    .get("from_version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                required_migrations: vec![],
                local_items_to_migrate: 0,
                cloud_items_to_migrate: 0,
                estimated_duration_seconds: 0,
                warnings: vec![],
            });
        }
    }

    // 2. 检测数据库结构版本
    let (db_version, db_needs_migration, local_items) = detect_database_version(&old_db_path)?;

    // 3. 检测配置格式版本
    let (config_version, config_needs_migration) = detect_config_version(&store_path)?;

    // 4. 综合判断迁移需求
    let mut required_migrations = Vec::new();
    let mut warnings = Vec::new();
    let mut old_version = None;

    if db_needs_migration {
        required_migrations.push(MigrationType::DatabaseSchema);
        old_version = Some(db_version);
    }

    if config_needs_migration {
        required_migrations.push(MigrationType::ConfigFormat);
        if old_version.is_none() {
            old_version = Some(config_version);
        }
    }

    // 如果有旧版本数据但没有迁移标记，建议完整迁移
    if old_version.is_some() && required_migrations.is_empty() {
        required_migrations.push(MigrationType::Full);
    }

    // 5. 风险评估
    if local_items > 10000 {
        warnings.push("数据量较大（>10000条），建议在空闲时段进行迁移".to_string());
    }

    if !old_db_path.exists() && !new_db_path.exists() {
        warnings.push("未检测到现有数据库，将创建新数据库".to_string());
    }

    // 6. 估计迁移时间（每1000条约1秒）
    let estimated_duration = ((local_items as f64 / 1000.0).ceil() as u64).max(1);

    let status = if required_migrations.is_empty() {
        MigrationStatus::UpToDate
    } else {
        MigrationStatus::NeedMigration
    };

    Ok(MigrationCheckResult {
        status,
        old_version,
        required_migrations,
        local_items_to_migrate: local_items,
        cloud_items_to_migrate: 0, // 云端迁移暂未实现
        estimated_duration_seconds: estimated_duration,
        warnings,
    })
}

/// 检测数据库版本
fn detect_database_version(db_path: &PathBuf) -> Result<(String, bool, usize), String> {
    // 优先检查新版数据库
    if db_path.exists() {
        let conn =
            rusqlite::Connection::open(db_path).map_err(|e| format!("打开数据库失败: {}", e))?;

        // 检查是否存在 createTime 列（旧版特征）
        let has_create_time = conn
            .prepare("SELECT createTime FROM history LIMIT 1")
            .is_ok();

        if has_create_time {
            // 旧版本数据库，需要完整迁移
            let count: i32 = conn
                .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
                .unwrap_or(0);

            return Ok(("v0.6.x (createTime)".to_string(), true, count as usize));
        }

        // 检查是否存在新版必需字段 type
        let has_type = conn.prepare("SELECT type FROM history LIMIT 1").is_ok();
        if has_type {
            // 新版数据库格式
            return Ok(("v0.7.0+".to_string(), false, 0));
        }

        // 未知格式，统计数量
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
            .unwrap_or(0);

        return Ok(("unknown".to_string(), true, count as usize));
    }

    Ok(("new".to_string(), false, 0))
}

/// 检测配置版本
fn detect_config_version(store_path: &PathBuf) -> Result<(String, bool), String> {
    if !store_path.exists() {
        return Ok(("new".to_string(), false));
    }

    let content = fs::read_to_string(store_path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    // 检查是否有新的 syncModeConfig 结构
    let has_sync_mode_config = json
        .get("globalStore")
        .and_then(|v| v.get("cloudSync"))
        .and_then(|v| v.get("syncModeConfig"))
        .is_some();

    if has_sync_mode_config {
        return Ok(("v0.7.0+".to_string(), false));
    }

    // 检查是否有旧的配置结构
    let has_old_config = json
        .get("globalStore")
        .and_then(|v| v.get("cloudSync"))
        .and_then(|v| v.get("serverConfig"))
        .is_some();

    if has_old_config {
        return Ok(("v0.6.x".to_string(), true));
    }

    Ok(("new".to_string(), false))
}

/// 获取迁移标记文件路径
fn get_migration_marker_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".migration{}", suffix))
}

/// 获取旧版数据库文件路径
pub fn get_old_database_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!("EcoPaste-Sync{}.db", suffix))
}

/// 获取新版数据库文件路径
pub fn get_new_database_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!("EcoPaste-Sync{}.db", suffix))
}

/// 获取配置文件路径
pub fn get_store_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".store{}.json", suffix))
}
