use dirs::home_dir;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

pub const BUNDLE_ID: &str = "com.Rains.EcoPaste-Sync";

#[inline]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

#[inline]
pub fn get_config_filename() -> &'static str {
    if is_dev_mode() {
        ".store.dev.json"
    } else {
        ".store.json"
    }
}

#[inline]
pub fn get_server_config_filename() -> &'static str {
    if is_dev_mode() {
        "server-config.dev.json"
    } else {
        "server-config.json"
    }
}

/// 获取配置文件路径（主配置 .store.json）
pub fn get_config_path<R: Runtime>(app_handle: &AppHandle<R>) -> Option<PathBuf> {
    let config_filename = get_config_filename();

    if let Some(app_data_dir) = std::env::var_os("APPDATA") {
        return Some(
            PathBuf::from(app_data_dir)
                .join(BUNDLE_ID)
                .join(config_filename),
        );
    }

    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join(config_filename))
}

/// 获取数据目录（用于存放非敏感配置如 server-config.json）
pub fn get_data_path() -> Option<PathBuf> {
    dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| home_dir().map(|p| p.join(".local/share")))
        .map(|p| p.join(BUNDLE_ID))
}

/// 获取服务器配置文件路径
pub fn get_server_config_path() -> Option<PathBuf> {
    get_data_path().map(|p| p.join(get_server_config_filename()))
}

/// 获取数据库文件名
#[inline]
pub fn get_database_filename() -> &'static str {
    if is_dev_mode() {
        "EcoPaste-Sync.dev.db"
    } else {
        "EcoPaste-Sync.db"
    }
}

/// 获取数据库文件路径（使用 get_data_path）
pub fn get_database_path() -> Option<PathBuf> {
    get_data_path().map(|p| p.join(get_database_filename()))
}
