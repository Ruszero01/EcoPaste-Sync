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
mod source_app;

pub use change_tracker::*;
pub use cleanup::*;
pub use commands::*;
pub use config::*;
pub use database::*;
pub use debug::*;
pub use delete::*;
pub use filter::*;
pub use models::*;

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
            commands::query_history,
            commands::query_history_with_filter,
            commands::insert_with_deduplication,
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
            let save_data_dir = dirs::data_dir()
                .or_else(|| dirs::config_dir())
                .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
                .ok_or_else(|| "无法获取数据目录".to_string())?;

            // 获取应用标识符作为名称（与前端保持一致）
            let bundle_id = "com.Rains.EcoPaste-Sync";
            let app_name = "EcoPaste-Sync".to_string();

            // 检查是否为开发模式
            let is_dev = cfg!(debug_assertions);

            // 构建数据目录：{saveDataDir}/{bundleId}
            let data_dir = save_data_dir.join(bundle_id);

            // 确保数据目录存在
            std::fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {}", e))?;

            // 设置数据库路径并初始化 - 如果失败则应用启动失败
            db.set_database_path(data_dir.to_string_lossy().to_string(), app_name, is_dev)
                .map_err(|e| {
                    log::error!("❌ 数据库插件初始化失败: {}", e);
                    e
                })?;

            log::info!("✅ 数据库插件自动初始化成功");

            Ok(())
        })
        .build()
}
