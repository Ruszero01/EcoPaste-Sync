use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::paths::get_server_config_path;

/// 服务器配置缓存
static SERVER_CONFIG_CACHE: Lazy<Mutex<Option<ServerConfigData>>> = Lazy::new(|| Mutex::new(None));

/// 服务器配置数据
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigData {
    pub url: String,
    pub username: String,
    pub password: String,
    pub path: String,
    pub timeout: u64,
    /// 上次同步时间（Unix 时间戳，秒）
    pub last_sync_time: Option<u64>,
}

/// 读取并解析服务器配置文件
pub fn read_server_config() -> Result<ServerConfigData, String> {
    let config_path = match get_server_config_path() {
        Some(path) => path,
        None => return Err("无法获取数据目录".to_string()),
    };

    if !config_path.exists() {
        return Ok(ServerConfigData::default());
    }

    let content =
        std::fs::read_to_string(&config_path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))
}

/// 获取缓存的服务器配置（如果缓存为空则先读取）
pub fn get_cached_server_config() -> Result<ServerConfigData, String> {
    // 先检查缓存
    {
        let cache = SERVER_CONFIG_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(ref cached) = *cache {
            return Ok(cached.clone());
        }
    }

    // 缓存为空，读取配置
    let config = read_server_config()?;

    // 更新缓存
    {
        let mut cache = SERVER_CONFIG_CACHE.lock().map_err(|e| e.to_string())?;
        *cache = Some(config.clone());
    }

    Ok(config)
}

/// 刷新服务器配置缓存
pub fn refresh_server_config_cache() {
    let result = read_server_config();
    let mut cache = SERVER_CONFIG_CACHE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *cache = result.ok();
}

/// 获取上次同步时间（从缓存读取）
pub fn get_last_sync_time() -> Option<u64> {
    get_cached_server_config()
        .ok()
        .and_then(|c| c.last_sync_time)
}

/// 更新上次同步时间并保存
pub fn update_last_sync_time(timestamp: u64) {
    let mut config = get_cached_server_config().unwrap_or_default();
    config.last_sync_time = Some(timestamp);
    let _ = save_server_config(config);
}

/// 保存服务器配置并更新缓存（接受所有权）
pub fn save_server_config(config: ServerConfigData) -> Result<(), String> {
    let config_path = match get_server_config_path() {
        Some(path) => path,
        None => return Err("无法获取数据目录".to_string()),
    };

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化失败: {}", e))?;

    std::fs::write(&config_path, json).map_err(|e| format!("写入失败: {}", e))?;

    // 更新缓存
    {
        let mut cache = SERVER_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *cache = Some(config);
    }

    Ok(())
}
