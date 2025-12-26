//! 通用配置读取模块
//! 提供从 store.json 读取配置的通用方法

use serde::Deserialize;

/// 应用配置结构
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub global_store: Option<GlobalStore>,
    pub clipboard_store: Option<ClipboardStore>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalStore {
    pub appearance: Option<AppearanceConfig>,
    pub env: Option<EnvConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    pub language: Option<String>,
    pub is_dark: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConfig {
    pub platform: Option<String>,
    pub app_name: Option<String>,
    pub app_version: Option<String>,
    pub save_data_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardStore {
    pub window: Option<WindowConfig>,
    pub audio: Option<AudioConfig>,
    pub search: Option<SearchConfig>,
    pub content: Option<ContentConfig>,
    pub history: Option<HistoryConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    pub style: Option<String>,
    pub position: Option<String>,
    pub back_top: Option<bool>,
    pub show_all: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    pub copy: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConfig {
    pub position: Option<String>,
    pub default_focus: Option<bool>,
    pub auto_clear: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentConfig {
    pub auto_paste: Option<String>,
    pub ocr: Option<bool>,
    pub copy_plain: Option<bool>,
    pub paste_plain: Option<bool>,
    pub operation_buttons: Option<Vec<String>>,
    pub auto_favorite: Option<bool>,
    pub delete_confirm: Option<bool>,
    pub auto_sort: Option<bool>,
    pub show_original_content: Option<bool>,
    pub code_detection: Option<bool>,
    pub show_source_app: Option<bool>,
    pub color_detection: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryConfig {
    pub duration: Option<i32>,
    pub unit: Option<i32>,
    pub max_count: Option<i32>,
}

/// 获取配置文件路径
fn get_config_path() -> Result<std::path::PathBuf, String> {
    let save_data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    let bundle_id = "com.Rains.EcoPaste-Sync";
    let config_path = save_data_dir.join(bundle_id).join("store.json");

    Ok(config_path)
}

/// 读取完整配置
pub fn read_config() -> Result<AppConfig, String> {
    let config_path = get_config_path()?;

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(config)
}

/// 检查是否应该获取来源应用信息
pub fn should_fetch_source_app() -> bool {
    read_config()
        .ok()
        .and_then(|c| c.clipboard_store)
        .and_then(|c| c.content)
        .and_then(|c| c.show_source_app)
        .unwrap_or(true) // 默认为 true
}

/// 获取历史记录保留天数
pub fn get_history_duration() -> i32 {
    read_config()
        .ok()
        .and_then(|c| c.clipboard_store)
        .and_then(|c| c.history)
        .and_then(|c| c.duration)
        .unwrap_or(0)
}

/// 获取历史记录最大保留条数
pub fn get_history_max_count() -> i32 {
    read_config()
        .ok()
        .and_then(|c| c.clipboard_store)
        .and_then(|c| c.history)
        .and_then(|c| c.max_count)
        .unwrap_or(0)
}
