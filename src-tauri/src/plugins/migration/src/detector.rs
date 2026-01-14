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
    let db_path = get_database_path(data_dir, is_dev);
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
                items_to_migrate: 0,
                estimated_duration_seconds: 0,
                warnings: vec![],
            });
        }
    }

    // 2. 检测数据库结构版本
    let (db_version, db_needs_migration) = detect_database_version(&db_path)?;

    // 3. 检测配置格式版本
    let (config_version, config_needs_migration) = detect_config_version(&store_path)?;

    // 4. 综合判断迁移需求
    let mut required_migrations = Vec::new();
    let mut items_to_migrate = 0;
    let mut warnings = Vec::new();
    let mut old_version = None;

    if db_needs_migration {
        required_migrations.push(MigrationType::DatabaseSchema);
        items_to_migrate += estimate_db_items(&db_path);
        old_version = db_version.clone();
    }

    if config_needs_migration {
        required_migrations.push(MigrationType::ConfigFormat);
        old_version = config_version.or(old_version);
    }

    // 如果有旧版本数据但没有迁移标记，建议完整迁移
    if old_version.is_some() && required_migrations.is_empty() {
        // 可能是 v0.7.0 之前的版本需要完整迁移
        required_migrations.push(MigrationType::Full);
    }

    // 5. 风险评估
    if items_to_migrate > 10000 {
        warnings.push("数据量较大（>10000条），建议在空闲时段进行迁移".to_string());
    }
    if !db_path.exists() {
        warnings.push("未检测到现有数据库，将创建新数据库".to_string());
    }

    // 6. 估计迁移时间（每1000条约1秒）
    let estimated_duration = ((items_to_migrate as f64 / 1000.0).ceil() as u64).max(1);

    let status = if required_migrations.is_empty() {
        MigrationStatus::UpToDate
    } else {
        MigrationStatus::NeedMigration
    };

    Ok(MigrationCheckResult {
        status,
        old_version,
        required_migrations,
        items_to_migrate,
        estimated_duration_seconds: estimated_duration,
        warnings,
    })
}

/// 检测数据库版本
fn detect_database_version(db_path: &PathBuf) -> Result<(Option<String>, bool), String> {
    if !db_path.exists() {
        return Ok((None, false));
    }

    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("打开数据库失败: {}", e))?;

    // 检查是否存在旧版本特征字段
    // 旧版本：存在 createTime 列（字符串时间）
    // 新版本：存在 time 列（Unix 时间戳），不存在 createTime 列
    let has_create_time = conn
        .prepare("SELECT createTime FROM history LIMIT 1")
        .is_ok();

    let has_time = conn.prepare("SELECT time FROM history LIMIT 1").is_ok();

    // 如果存在 createTime 且没有正确的 time 值，说明是旧版本
    if has_create_time && !has_time {
        return Ok((Some("v0.6.x (createTime)".to_string()), true));
    }

    // 如果存在 sourceAppName，说明是新版本
    let has_new_fields = conn
        .prepare("SELECT sourceAppName FROM history LIMIT 1")
        .is_ok();

    if has_new_fields {
        return Ok((Some("v0.7.0+".to_string()), false));
    }

    // 检查是否存在 history 表
    let has_history = conn.prepare("SELECT COUNT(*) FROM history").is_ok();

    if has_history {
        // 旧版本数据库，需要迁移
        return Ok((Some("v0.6.x".to_string()), true));
    }

    Ok((None, false))
}

/// 检测配置版本
fn detect_config_version(store_path: &PathBuf) -> Result<(Option<String>, bool), String> {
    if !store_path.exists() {
        return Ok((None, false));
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
        return Ok((Some("v0.7.0+".to_string()), false));
    }

    // 检查是否有旧的配置结构
    let has_old_config = json
        .get("globalStore")
        .and_then(|v| v.get("cloudSync"))
        .and_then(|v| v.get("serverConfig"))
        .is_some();

    if has_old_config {
        return Ok((Some("v0.6.x".to_string()), true));
    }

    Ok((None, false))
}

/// 估算数据库中的项目数量
fn estimate_db_items(db_path: &PathBuf) -> usize {
    if !db_path.exists() {
        return 0;
    }

    match rusqlite::Connection::open(db_path) {
        Ok(conn) => {
            if let Ok(count) = conn.query_row("SELECT COUNT(*) FROM history", [], |row| {
                row.get::<_, i64>(0)
            }) {
                count as usize
            } else {
                0
            }
        }
        Err(_) => 0,
    }
}

/// 获取迁移标记文件路径
fn get_migration_marker_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".migration{}", suffix))
}

/// 获取数据库文件路径
fn get_database_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let extension = if is_dev { "dev.db" } else { "db" };
    data_dir.join(format!("EcoPaste-Sync.{}", extension))
}

/// 获取配置文件路径
fn get_store_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".store{}.json", suffix))
}
