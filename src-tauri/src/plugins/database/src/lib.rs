//! 数据库插件核心模块
//! 提供统一的 SQLite 数据库访问接口

mod change_tracker;
mod cleanup;
mod commands;
pub mod config;
mod database;
mod debug;
mod delete;
mod filter;
mod models;
pub mod source_app;

pub use change_tracker::*;
pub use cleanup::*;
pub use commands::*;
pub use config::*;
pub use database::*;
pub use debug::*;
pub use delete::*;
pub use filter::*;
pub use models::*;
pub use source_app::*;

use std::sync::Arc;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};
use tauri_plugin_eco_common::paths::get_database_path;
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
            commands::query_history_with_filter,
            commands::delete_items,
            commands::update_field,
            cleanup::cleanup_history,
            debug::get_database_info,
            debug::reset_database
        ])
        .setup(|app_handle, _webview_manager| {
            // 在插件初始化时自动设置数据库路径并注册状态
            let database_state = create_shared_database();

            // 将数据库状态注册到应用中，供命令使用
            app_handle.manage(database_state.clone());

            // 初始化数据库
            let mut db = database_state.blocking_lock();

            // 使用标准路径（与前端 appDataDir 对应）
            let db_path = get_database_path().ok_or_else(|| "无法获取数据库路径".to_string())?;

            // 确保数据目录存在
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败: {}", e))?;
            }

            // 初始化数据库 - 如果失败则应用启动失败
            db.init(db_path)
                .map_err(|e| {
                    log::error!("❌ 数据库初始化失败: {}", e);
                    e
                })?;

            Ok(())
        })
        .build()
}
