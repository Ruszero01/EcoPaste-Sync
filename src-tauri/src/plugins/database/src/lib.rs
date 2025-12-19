//! 数据库插件核心模块
//! 提供统一的 SQLite 数据库访问接口

mod database;
mod models;
mod commands;

pub use database::*;
pub use models::*;
pub use commands::*;

use std::sync::Arc;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
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
            commands::query_sync_data,
            commands::update_sync_status,
            commands::batch_update_sync_status,
            commands::upsert_from_cloud,
            commands::mark_deleted,
            commands::get_statistics
        ])
        .build()
}
