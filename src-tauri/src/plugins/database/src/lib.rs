//! 数据库插件核心模块
//! 提供统一的 SQLite 数据库访问接口

mod database;
mod models;
mod commands;
mod change_tracker;
mod filter;

pub use database::*;
pub use models::*;
pub use commands::*;
pub use change_tracker::*;
pub use filter::*;

use std::sync::Arc;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};
use tokio::sync::Mutex;

/// 数据库状态类型
pub type DatabaseState = Arc<Mutex<DatabaseManager>>;

/// 创建共享的数据库管理器
pub fn create_shared_database() -> DatabaseState {
    Arc::new(Mutex::new(DatabaseManager::new()))
}

/// 初始化插件
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-database")
        .invoke_handler(tauri::generate_handler![
            commands::set_database_path,
            commands::query_history,
            commands::query_history_with_filter,
            commands::query_sync_data,
            commands::update_sync_status,
            commands::batch_update_sync_status,
            commands::upsert_from_cloud,
            commands::insert_with_deduplication,
            commands::mark_deleted,
            commands::batch_mark_deleted,
            commands::hard_delete,
            commands::batch_hard_delete,
            commands::get_statistics,
            commands::update_favorite,
            commands::batch_update_favorite,
            commands::update_note,
            commands::update_content,
            commands::update_type,
            commands::mark_changed,
            commands::batch_mark_changed,
            commands::update_time,
            commands::get_changed_items_count,
            commands::get_changed_items_list,
            commands::query_with_filter,
            commands::query_for_sync,
            commands::search_data,
            commands::query_by_group,
            commands::get_all_groups,
            commands::get_filtered_statistics
        ])
        .setup(|app_handle, _webview_manager| {
            // 在插件初始化时自动设置数据库路径并注册状态
            let database_state = create_shared_database();

            // 将数据库状态注册到应用中，供命令使用
            app_handle.manage(database_state.clone());

            // 初始化数据库
            let mut db = database_state.blocking_lock();

            // 使用标准路径（与前端 appDataDir 对应）
            let save_data_dir = dirs::data_dir()
                .or_else(|| dirs::config_dir())
                .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
                .unwrap_or_else(|| std::path::PathBuf::from("."));

            // 获取应用标识符作为名称（与前端保持一致）
            let bundle_id = "com.Rains.EcoPaste-Sync";
            let app_name = "EcoPaste-Sync".to_string();

            // 检查是否为开发模式
            let is_dev = cfg!(debug_assertions);

            // 构建数据目录：{saveDataDir}/{bundleId}
            let data_dir = save_data_dir.join(bundle_id);

            // 设置数据库路径并初始化
            match db.set_database_path(
                data_dir.to_string_lossy().to_string(),
                app_name,
                is_dev,
            ) {
                Ok(_) => log::info!("✅ 数据库插件自动初始化成功"),
                Err(e) => log::error!("❌ 数据库插件自动初始化失败: {}", e),
            }

            Ok(())
        })
        .build()
}
