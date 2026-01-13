use tauri::{AppHandle, Manager, Runtime};
use std::path::PathBuf;

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

/// 获取配置文件路径
///
/// 优先使用 APPDATA 环境变量（Windows 上始终可用）
/// 最终兜底：Tauri app_data_dir()
pub fn get_config_path<R: Runtime>(app_handle: &AppHandle<R>) -> Option<PathBuf> {
    let config_filename = get_config_filename();

    if let Some(app_data_dir) = std::env::var_os("APPDATA") {
        return Some(PathBuf::from(app_data_dir).join(BUNDLE_ID).join(config_filename));
    }

    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join(config_filename))
}
