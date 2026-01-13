use serde_json::Value;

use tauri::{AppHandle, Runtime};

use crate::paths::get_config_path;

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
