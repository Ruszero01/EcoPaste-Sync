//! 迁移执行模块

use crate::{
    database_migrator::{migrate_config, migrate_database},
    detector::check_migration_status,
    models::{MigrationMarker, MigrationProgress, MigrationResult, MigrationStatus, MigrationType},
};
use std::fs;
use std::path::PathBuf;
use tokio::sync::broadcast;

pub async fn perform_migration(
    data_dir: PathBuf,
    is_dev: bool,
    progress_sender: broadcast::Sender<MigrationProgress>,
) -> MigrationResult {
    let start_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let marker_path = get_migration_marker_path(&data_dir, is_dev);
    let old_db_path = get_old_database_path(&data_dir, is_dev);
    let new_db_path = get_new_database_path(&data_dir, is_dev);
    let store_path = get_store_path(&data_dir, is_dev);

    let check_result = match check_migration_status(&data_dir, is_dev) {
        Ok(result) => result,
        Err(e) => {
            return MigrationResult {
                success: false,
                migrated_local_items: 0,
                migrated_cloud_items: 0,
                duration_ms: 0,
                errors: vec![format!("检查迁移状态失败: {}", e)],
                new_version: env!("CARGO_PKG_VERSION").to_string(),
            };
        }
    };

    if check_result.status == MigrationStatus::UpToDate {
        return MigrationResult {
            success: true,
            migrated_local_items: 0,
            migrated_cloud_items: 0,
            duration_ms: 0,
            errors: vec![],
            new_version: env!("CARGO_PKG_VERSION").to_string(),
        };
    }

    let mut marker = MigrationMarker::default();
    marker.from_version = check_result
        .old_version
        .unwrap_or_else(|| "unknown".to_string());
    marker.timestamp = start_time;

    write_migration_marker(&marker_path, &marker);

    let mut errors = Vec::new();
    let mut local_items_migrated = 0;

    let progress_sender_clone = progress_sender.clone();
    let progress_callback = move |progress: MigrationProgress| {
        let _ = progress_sender_clone.send(progress.clone());
    };

    if check_result
        .required_migrations
        .contains(&MigrationType::DatabaseSchema)
        || check_result
            .required_migrations
            .contains(&MigrationType::Full)
    {
        match migrate_database(&old_db_path, &new_db_path, progress_callback) {
            Ok((count, _)) => {
                local_items_migrated = count;
                marker.migrated_local_items = count;
                log::info!("[Migration] 数据库迁移完成，迁移了 {} 个项目", count);
            }
            Err(e) => {
                let error_msg = format!("数据库迁移失败: {}", e);
                log::error!("[Migration] {}", error_msg);
                errors.push(error_msg);
                marker.success = false;
                marker.error = Some(errors.join("; "));
                write_migration_marker(&marker_path, &marker);
                return MigrationResult {
                    success: false,
                    migrated_local_items: local_items_migrated,
                    migrated_cloud_items: 0,
                    duration_ms: 0,
                    errors,
                    new_version: env!("CARGO_PKG_VERSION").to_string(),
                };
            }
        }
    }

    if check_result
        .required_migrations
        .contains(&MigrationType::ConfigFormat)
        || check_result
            .required_migrations
            .contains(&MigrationType::Full)
    {
        if let Err(e) = migrate_config(&store_path) {
            log::warn!("[Migration] 配置迁移失败: {}", e);
            errors.push(format!("配置迁移失败: {}", e));
        }
    }

    let end_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    marker.success = errors.is_empty();
    marker.migrated_local_items = local_items_migrated;
    marker.timestamp = end_time;
    marker.error = if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    };

    write_migration_marker(&marker_path, &marker);

    progress_sender
        .send(MigrationProgress {
            current_phase: "迁移完成".to_string(),
            processed_items: local_items_migrated,
            total_items: local_items_migrated,
            percentage: 100.0,
            current_operation: format!("迁移完成，共 {} 项", local_items_migrated),
            completed: true,
            error: if errors.is_empty() {
                None
            } else {
                Some(errors.join("; "))
            },
        })
        .ok();

    MigrationResult {
        success: errors.is_empty(),
        migrated_local_items: local_items_migrated,
        migrated_cloud_items: 0,
        duration_ms: (end_time - start_time) as u64,
        errors,
        new_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

fn get_migration_marker_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".migration{}", suffix))
}

fn get_old_database_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!("EcoPaste-Sync{}.db", suffix))
}

fn get_new_database_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!("EcoPaste-Sync{}.db", suffix))
}

fn get_store_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".store{}.json", suffix))
}

fn write_migration_marker(path: &PathBuf, marker: &MigrationMarker) {
    if let Ok(content) = serde_json::to_string_pretty(marker) {
        let _ = fs::write(path, content);
    }
}
