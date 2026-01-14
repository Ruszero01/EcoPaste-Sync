//! 数据迁移插件
//! 提供数据迁移功能，支持从旧版本迁移到新版本
//! 注意：此插件为纯后端运行，自动执行迁移，无需前端调用

mod database_migrator;
mod detector;
mod executor;
mod models;

use crate::detector::check_migration_status;
use crate::executor::perform_migration;
use crate::models::{MigrationCheckResult, MigrationProgress, MigrationStatus};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};
use tokio::sync::broadcast;

/// 迁移状态
#[derive(Debug, Clone, Default)]
pub struct MigrationStatusInner {
    pub is_migrating: bool,
    pub progress: Option<MigrationProgress>,
    pub last_error: Option<String>,
}

/// 创建迁移插件
/// 此插件在初始化时会自动检查并执行迁移
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-migration")
        .setup(|app_handle, _webview_manager| {
            // 创建迁移状态
            let migration_state = Arc::new(Mutex::new(MigrationStatusInner::default()));
            app_handle.manage(migration_state);

            log::info!("[Migration] 迁移插件初始化完成");

            // 自动执行迁移检查
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = auto_migrate(&app_handle_clone).await {
                    log::error!("[Migration] 自动迁移失败: {}", e);
                }
            });

            Ok(())
        })
        .build()
}

/// 自动迁移检查（应用启动时调用）
/// 检查是否需要迁移，如需要则自动执行迁移
pub async fn auto_migrate<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let is_dev = cfg!(debug_assertions);

    log::info!("[Migration] 检查是否需要数据迁移...");

    let check_result = check_migration_status(&data_dir, is_dev)
        .map_err(|e| format!("检查迁移状态失败: {}", e))?;

    match check_result.status {
        MigrationStatus::UpToDate => {
            log::info!("[Migration] 已是最新版本，无需迁移");
            Ok(())
        }
        MigrationStatus::NeedMigration => {
            log::info!(
                "[Migration] 检测到需要迁移，版本: {:?}, 需要迁移 {} 项",
                check_result.old_version,
                check_result.items_to_migrate
            );

            // 显示警告信息
            for warning in &check_result.warnings {
                log::warn!("[Migration] {}", warning);
            }

            // 创建进度广播通道
            let (sender, mut receiver) = broadcast::channel(100);

            // 在后台执行迁移
            let _app_clone = app.clone();
            let data_dir_clone = data_dir.clone();

            tauri::async_runtime::spawn(async move {
                let result = perform_migration(data_dir_clone, is_dev, sender).await;

                if result.success {
                    log::info!(
                        "[Migration] 迁移成功完成，迁移了 {} 项，耗时 {}ms",
                        result.migrated_items,
                        result.duration_ms
                    );
                } else {
                    log::error!("[Migration] 迁移失败: {}", result.errors.join("; "));
                }
            });

            // 监听进度并记录日志
            while let Ok(progress) = receiver.recv().await {
                log::info!(
                    "[Migration] 进度: {}% - {}",
                    progress.percentage as u32,
                    progress.current_operation
                );

                if let Some(ref error) = progress.error {
                    log::error!("[Migration] 错误: {}", error);
                }

                if progress.completed {
                    break;
                }
            }

            Ok(())
        }
        MigrationStatus::InProgress => {
            log::warn!("[Migration] 检测到迁移正在进行中");
            Ok(())
        }
        MigrationStatus::Failed => {
            log::error!("[Migration] 检测到之前的迁移失败");
            Err("之前的迁移失败，请手动清理迁移标记后重试".to_string())
        }
        MigrationStatus::Unknown => {
            log::warn!("[Migration] 无法确定迁移状态");
            Ok(())
        }
        MigrationStatus::Completed => {
            log::info!("[Migration] 迁移已完成");
            Ok(())
        }
    }
}

/// 获取数据目录
fn get_data_dir<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    let bundle_id = "com.Rains.EcoPaste-Sync";
    Ok(data_dir.join(bundle_id))
}

/// 检查是否需要迁移（供其他插件调用）
pub fn check_needs_migration(
    data_dir: &PathBuf,
    is_dev: bool,
) -> Result<MigrationCheckResult, String> {
    check_migration_status(data_dir, is_dev)
}

/// 获取迁移标记文件路径
pub fn get_migration_marker_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".migration{}", suffix))
}

/// 清除迁移标记（供其他插件调用）
pub fn clear_migration_flag(data_dir: &PathBuf, is_dev: bool) -> Result<(), String> {
    let marker_path = get_migration_marker_path(data_dir, is_dev);

    if marker_path.exists() {
        fs::remove_file(&marker_path).map_err(|e| format!("删除迁移标记文件失败: {}", e))?;
        log::info!("[Migration] 迁移标记已清除");
    }

    Ok(())
}
