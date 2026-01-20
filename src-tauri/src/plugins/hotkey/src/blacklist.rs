//! 黑名单管理模块
//! 提供快捷键黑名单的增删改查功能

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use tauri_plugin_eco_common::config::{get_cached_config, get_nested, refresh_config_cache};

// ==================== 类型定义 ====================

/// 黑名单项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlacklistItem {
    pub process_name: String,
    pub added_time: i64,
    pub enabled: bool,
}

/// 进程名称标准化
fn normalize_name(name: &str) -> String {
    let normalized = name.to_lowercase();

    #[cfg(target_os = "macos")]
    {
        if let Some(last) = normalized.rsplitn(2, '.').next() {
            return last.to_string();
        }
    }

    normalized
}

// ==================== 缓存管理 ====================

static BLACKLIST_CACHE: Lazy<Mutex<Vec<BlacklistItem>>> = Lazy::new(|| Mutex::new(Vec::new()));

// ==================== 配置文件读写 ====================

/// 从配置加载黑名单
fn load_from_config<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<Vec<BlacklistItem>, String> {
    let config = get_cached_config(app_handle)?;

    match get_nested(&config, &["clipboardStore", "shortcutBlacklist"]) {
        Some(serde_json::Value::Array(arr)) => {
            let items: Result<Vec<BlacklistItem>, _> =
                serde_json::from_value(serde_json::Value::Array(arr.clone()));
            match items {
                Ok(items) => Ok(items),
                Err(_) => {
                    let names: Result<Vec<String>, _> =
                        serde_json::from_value(serde_json::Value::Array(arr.clone()));
                    match names {
                        Ok(names) => Ok(names
                            .into_iter()
                            .map(|name| BlacklistItem {
                                process_name: normalize_name(&name),
                                added_time: chrono::Utc::now().timestamp_millis(),
                                enabled: true,
                            })
                            .collect()),
                        Err(e) => Err(e.to_string()),
                    }
                }
            }
        }
        _ => Ok(Vec::new()),
    }
}

/// 保存黑名单到配置
fn save_to_config<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    items: &[BlacklistItem],
) -> Result<(), String> {
    let mut config = get_cached_config(app_handle)?;

    let names: Vec<String> = items
        .iter()
        .filter(|item| item.enabled)
        .map(|item| item.process_name.clone())
        .collect();

    if names.is_empty() {
        if let Some(store) = config.get_mut("clipboardStore") {
            store
                .as_object_mut()
                .and_then(|obj| obj.remove("shortcutBlacklist"));
        }
    } else {
        if let Some(store) = config
            .get_mut("clipboardStore")
            .and_then(|v| v.as_object_mut())
        {
            store.insert("shortcutBlacklist".to_string(), serde_json::json!(names));
        } else {
            let mut store = serde_json::Map::new();
            store.insert("shortcutBlacklist".to_string(), serde_json::json!(names));
            config["clipboardStore"] = serde_json::Value::Object(store);
        }
    }

    // 写入配置文件
    let config_path = tauri_plugin_eco_common::paths::get_config_path(app_handle)
        .ok_or("无法获取配置路径".to_string())?;

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let content =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置文件失败: {}", e))?;

    std::fs::write(&config_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    refresh_config_cache(app_handle);

    Ok(())
}

// ==================== 公开 API ====================

pub fn get_blacklist() -> Vec<BlacklistItem> {
    BLACKLIST_CACHE.lock().unwrap().clone()
}

pub fn add_to_blacklist<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    process_name: String,
) -> Result<(), String> {
    let normalized = normalize_name(&process_name);

    {
        let blacklist = BLACKLIST_CACHE.lock().unwrap();
        if blacklist.iter().any(|item| item.process_name == normalized) {
            return Err(format!("{} 已在黑名单中", process_name));
        }
    }

    let new_item = BlacklistItem {
        process_name: normalized,
        added_time: chrono::Utc::now().timestamp_millis(),
        enabled: true,
    };

    {
        let mut blacklist = BLACKLIST_CACHE.lock().unwrap();
        blacklist.push(new_item.clone());
    }

    save_to_config(&app_handle, &get_blacklist())?;

    log::info!("[Blacklist] 已添加 {} 到黑名单", process_name);
    Ok(())
}

pub fn remove_from_blacklist<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    process_name: &str,
) -> Result<(), String> {
    let normalized = normalize_name(process_name);

    let mut blacklist = get_blacklist();
    let original_len = blacklist.len();
    blacklist.retain(|item| item.process_name != normalized);

    if blacklist.len() == original_len {
        return Err(format!("{} 不在黑名单中", process_name));
    }

    save_to_config(&app_handle, &blacklist)?;

    refresh_blacklist_cache(app_handle);

    log::info!("[Blacklist] 已从黑名单移除 {}", process_name);
    Ok(())
}

pub fn is_process_in_blacklist(process_name: &str) -> bool {
    let normalized = normalize_name(process_name);
    let blacklist = BLACKLIST_CACHE.lock().unwrap();
    blacklist
        .iter()
        .any(|item| item.enabled && item.process_name == normalized)
}

pub fn refresh_blacklist_cache<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) {
    match load_from_config(&app_handle) {
        Ok(items) => {
            let mut cache = BLACKLIST_CACHE.lock().unwrap();
            *cache = items;
            log::info!("[Blacklist] 缓存已刷新，共 {} 项", cache.len());
        }
        Err(e) => {
            log::error!("[Blacklist] 刷新缓存失败: {}", e);
        }
    }
}

pub fn clear_blacklist<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) -> Result<(), String> {
    {
        let mut blacklist = BLACKLIST_CACHE.lock().unwrap();
        blacklist.clear();
    }

    save_to_config(&app_handle, &Vec::new())?;

    log::info!("[Blacklist] 已清空黑名单");
    Ok(())
}

pub fn init_blacklist<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) {
    refresh_blacklist_cache(app_handle);
    log::info!("[Blacklist] 黑名单模块已初始化");
}
