//! 迁移执行模块
//! 协调整个迁移流程

use crate::{
    database_migrator::{migrate_config, migrate_database},
    detector::check_migration_status,
    models::{MigrationMarker, MigrationProgress, MigrationResult, MigrationStatus, MigrationType},
};
use std::fs;
use std::path::PathBuf;
use tokio::sync::broadcast;

/// 执行完整迁移
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
    let db_path = get_database_path(&data_dir, is_dev);
    let store_path = get_store_path(&data_dir, is_dev);

    // 1. 检查迁移状态
    let check_result = match check_migration_status(&data_dir, is_dev) {
        Ok(result) => result,
        Err(e) => {
            return MigrationResult {
                success: false,
                migrated_items: 0,
                duration_ms: 0,
                errors: vec![format!("检查迁移状态失败: {}", e)],
                new_version: env!("CARGO_PKG_VERSION").to_string(),
            };
        }
    };

    if check_result.status == MigrationStatus::UpToDate {
        return MigrationResult {
            success: true,
            migrated_items: 0,
            duration_ms: 0,
            errors: vec![],
            new_version: env!("CARGO_PKG_VERSION").to_string(),
        };
    }

    // 2. 写入迁移开始标记
    let mut marker = MigrationMarker::default();
    marker.from_version = check_result
        .old_version
        .unwrap_or_else(|| "unknown".to_string());
    marker.timestamp = start_time;

    write_migration_marker(&marker_path, &marker);

    // 3. 执行数据库迁移
    let mut total_migrated = 0;
    let mut errors = Vec::new();

    // 创建进度回调
    let progress_sender_clone = progress_sender.clone();
    let progress_callback = move |progress: MigrationProgress| {
        let _ = progress_sender_clone.send(progress.clone());
    };

    // 执行数据库迁移
    if check_result
        .required_migrations
        .contains(&MigrationType::DatabaseSchema)
        || check_result
            .required_migrations
            .contains(&MigrationType::Full)
    {
        progress_sender
            .send(MigrationProgress {
                current_phase: "迁移数据库结构".to_string(),
                processed_items: 0,
                total_items: check_result.items_to_migrate,
                percentage: 0.0,
                current_operation: "开始迁移数据库".to_string(),
                completed: false,
                error: None,
            })
            .ok();

        match migrate_database(&db_path, progress_callback) {
            Ok((count, _)) => {
                total_migrated += count;
                log::info!("[Migration] 数据库迁移完成，迁移了 {} 个项目", count);
            }
            Err(e) => {
                let error_msg = format!("数据库迁移失败: {}", e);
                log::error!("[Migration] {}", error_msg);
                errors.push(error_msg);

                // 更新标记文件为失败状态
                marker.success = false;
                marker.error = Some(errors.join("; "));
                write_migration_marker(&marker_path, &marker);

                return MigrationResult {
                    success: false,
                    migrated_items: total_migrated,
                    duration_ms: 0,
                    errors,
                    new_version: env!("CARGO_PKG_VERSION").to_string(),
                };
            }
        }
    }

    // 4. 执行配置迁移
    if check_result
        .required_migrations
        .contains(&MigrationType::ConfigFormat)
        || check_result
            .required_migrations
            .contains(&MigrationType::Full)
    {
        progress_sender
            .send(MigrationProgress {
                current_phase: "迁移配置格式".to_string(),
                processed_items: 0,
                total_items: 1,
                percentage: 0.0,
                current_operation: "更新配置文件格式".to_string(),
                completed: false,
                error: None,
            })
            .ok();

        match migrate_config(&store_path) {
            Ok(_) => {
                log::info!("[Migration] 配置迁移完成");
            }
            Err(e) => {
                let error_msg = format!("配置迁移失败: {}", e);
                log::warn!("[Migration] {}", error_msg);
                errors.push(error_msg);
            }
        }
    }

    // 5. 写入迁移完成标记
    let end_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    marker.success = errors.is_empty();
    marker.migrated_items = total_migrated;
    marker.timestamp = end_time;
    marker.error = if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    };

    write_migration_marker(&marker_path, &marker);

    // 6. 发送完成进度
    progress_sender
        .send(MigrationProgress {
            current_phase: "迁移完成".to_string(),
            processed_items: total_migrated,
            total_items: total_migrated,
            percentage: 100.0,
            current_operation: format!("迁移完成，共 {} 项", total_migrated),
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
        migrated_items: total_migrated,
        duration_ms: (end_time - start_time) as u64,
        errors,
        new_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// 回滚迁移（供调试或重试使用）
#[allow(dead_code)]
pub fn rollback_migration(data_dir: PathBuf, is_dev: bool) -> Result<(), String> {
    let marker_path = get_migration_marker_path(&data_dir, is_dev);

    if marker_path.exists() {
        fs::remove_file(&marker_path).map_err(|e| format!("删除迁移标记文件失败: {}", e))?;
        log::info!("[Migration] 迁移标记已清除");
    }

    Ok(())
}

/// 清除迁移标记（供调试使用）
#[allow(dead_code)]
pub fn clear_migration_flag(data_dir: PathBuf, is_dev: bool) -> Result<(), String> {
    rollback_migration(data_dir, is_dev)
}

/// 获取迁移进度（供前端使用）
#[allow(dead_code)]
pub fn get_migration_progress(migrated_items: usize, total_items: usize) -> MigrationProgress {
    let percentage = if total_items > 0 {
        (migrated_items as f64 / total_items as f64) * 100.0
    } else {
        100.0
    };

    MigrationProgress {
        current_phase: "迁移中".to_string(),
        processed_items: migrated_items,
        total_items,
        percentage,
        current_operation: format!("已处理 {}/{} 项", migrated_items, total_items),
        completed: migrated_items >= total_items,
        error: None,
    }
}

/// 辅助函数
fn get_migration_marker_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".migration{}", suffix))
}

fn get_database_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let extension = if is_dev { "dev.db" } else { "db" };
    data_dir.join(format!("EcoPaste-Sync.{}", extension))
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
