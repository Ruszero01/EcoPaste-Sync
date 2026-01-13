use once_cell::sync::Lazy;
use serde_json::Value;
use std::sync::Mutex;

use tauri::{AppHandle, Runtime};

use crate::paths::get_config_path;

/// 配置缓存（使用 Lazy 静态初始化，Mutex 保证线程安全）
static CONFIG_CACHE: Lazy<Mutex<Option<Value>>> = Lazy::new(|| Mutex::new(None));

/// 读取并解析配置文件
pub fn read_config<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Value, String> {
    let config_path = get_config_path(app_handle).ok_or("无法获取配置路径".to_string())?;

    if !config_path.exists() {
        return Err("配置文件不存在".to_string());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))
}

/// 获取缓存的配置（如果缓存为空则先读取）
pub fn get_cached_config<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Value, String> {
    // 先检查缓存
    {
        let cache: std::sync::MutexGuard<'_, Option<Value>> =
            CONFIG_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(ref cached) = *cache {
            return Ok(cached.clone());
        }
    }

    // 缓存为空，读取配置
    let config = read_config(app_handle)?;

    // 更新缓存
    {
        let mut cache: std::sync::MutexGuard<'_, Option<Value>> =
            CONFIG_CACHE.lock().map_err(|e| e.to_string())?;
        *cache = Some(config.clone());
    }

    Ok(config)
}

/// 刷新配置缓存（前端配置变更后调用）
pub fn refresh_config_cache<R: Runtime>(app_handle: &AppHandle<R>) {
    let result = read_config(app_handle);
    let mut cache = CONFIG_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    *cache = result.ok();
}

/// 从配置中获取嵌套值
///
/// # 示例
/// ```
/// let config = json!({ "clipboardStore": { "window": { "position": "follow" } } });
/// let value = get_nested(&config, &["clipboardStore", "window", "position"]);
/// // returns Some(&"follow")
/// ```
pub fn get_nested<'a>(config: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let mut current = config;
    for &key in keys {
        current = current.get(key)?;
    }
    Some(current)
}
