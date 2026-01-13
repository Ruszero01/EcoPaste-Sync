//! 配置同步管理器
//! 负责应用配置的云端同步

use crate::webdav::WebDAVClientState;
use serde::{Deserialize, Serialize};

/// 应用配置结构（与前端 globalStore 对应）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// 全局配置
    #[serde(default)]
    pub global_store: Option<GlobalStoreConfig>,
    /// 剪贴板配置
    #[serde(default)]
    pub clipboard_store: Option<ClipboardStoreConfig>,
}

/// 全局存储配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalStoreConfig {
    /// 应用设置
    #[serde(default)]
    pub app: Option<AppConfigInner>,
    /// 外观设置
    #[serde(default)]
    pub appearance: Option<AppearanceConfig>,
    /// 更新设置
    #[serde(default)]
    pub update: Option<UpdateConfig>,
    /// 快捷键设置
    #[serde(default)]
    pub shortcut: Option<ShortcutConfig>,
    /// 环境配置（不同步，清空）
    #[serde(default)]
    pub env: Option<serde_json::Value>,
    /// 云同步配置
    #[serde(default)]
    pub cloud_sync: Option<CloudSyncConfig>,
}

/// 应用设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigInner {
    /// 自动启动
    #[serde(default)]
    pub auto_start: Option<bool>,
    /// 显示菜单栏图标
    #[serde(default)]
    pub show_menubar_icon: Option<bool>,
    /// 显示任务栏图标
    #[serde(default)]
    pub show_taskbar_icon: Option<bool>,
    /// 窗口行为
    #[serde(default)]
    pub window_behavior: Option<WindowBehaviorConfig>,
}

/// 窗口行为配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBehaviorConfig {
    /// 模式
    #[serde(default)]
    pub mode: Option<String>,
    /// 回收延迟（秒）
    #[serde(default)]
    pub recycle_delay_seconds: Option<i64>,
}

/// 外观配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    /// 主题
    #[serde(default)]
    pub theme: Option<String>,
    /// 是否深色
    #[serde(default)]
    pub is_dark: Option<bool>,
    /// 行高
    #[serde(default)]
    pub row_height: Option<i64>,
    /// 语言
    #[serde(default)]
    pub language: Option<String>,
}

/// 更新配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfig {
    /// 自动更新
    #[serde(default)]
    pub auto: Option<bool>,
    /// Beta 版
    #[serde(default)]
    pub beta: Option<bool>,
}

/// 快捷键配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutConfig {
    /// 剪贴板快捷键
    #[serde(default)]
    pub clipboard: Option<String>,
    /// 设置快捷键
    #[serde(default)]
    pub preference: Option<String>,
    /// 快速粘贴快捷键
    #[serde(default)]
    pub quick_paste: Option<QuickPasteConfig>,
    /// 纯文本粘贴快捷键
    #[serde(default)]
    pub paste_plain: Option<String>,
}

/// 快速粘贴配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPasteConfig {
    /// 是否启用
    #[serde(default)]
    pub enable: Option<bool>,
    /// 快捷键值
    #[serde(default)]
    pub value: Option<String>,
}

/// 云同步配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncConfig {
    /// 上次同步时间（不同步，清零）
    #[serde(default)]
    pub last_sync_time: Option<u64>,
    /// 是否正在同步（不同步，清零）
    #[serde(default)]
    pub is_syncing: Option<bool>,
    /// 自动同步设置
    #[serde(default)]
    pub auto_sync_settings: Option<AutoSyncSettingsConfig>,
    /// 同步模式配置
    #[serde(default)]
    pub sync_mode_config: Option<SyncModeConfig>,
}

/// 自动同步设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSyncSettingsConfig {
    /// 是否启用
    #[serde(default)]
    pub enabled: Option<bool>,
    /// 同步间隔（小时）
    #[serde(default)]
    pub interval_hours: Option<i64>,
}

/// 同步模式配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncModeConfig {
    /// 同步模式设置
    #[serde(default)]
    pub settings: Option<SyncModeSettings>,
}

/// 同步模式设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncModeSettings {
    /// 包含文本
    #[serde(default)]
    pub include_text: Option<bool>,
    /// 包含 HTML
    #[serde(default)]
    pub include_html: Option<bool>,
    /// 包含 RTF
    #[serde(default)]
    pub include_rtf: Option<bool>,
    /// 包含 Markdown
    #[serde(default)]
    pub include_markdown: Option<bool>,
    /// 包含图片
    #[serde(default)]
    pub include_images: Option<bool>,
    /// 包含文件
    #[serde(default)]
    pub include_files: Option<bool>,
    /// 仅收藏
    #[serde(default)]
    pub only_favorites: Option<bool>,
}

/// 剪贴板存储配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardStoreConfig {
    /// 窗口设置
    #[serde(default)]
    pub window: Option<WindowConfig>,
    /// 音效设置
    #[serde(default)]
    pub audio: Option<AudioConfig>,
    /// 搜索设置
    #[serde(default)]
    pub search: Option<SearchConfig>,
    /// 内容设置
    #[serde(default)]
    pub content: Option<ContentConfig>,
    /// 历史记录设置
    #[serde(default)]
    pub history: Option<HistoryConfig>,
    /// 内部复制状态（不同步，清空）
    #[serde(default)]
    pub internal_copy: Option<InternalCopyConfig>,
}

/// 窗口配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    /// 样式
    #[serde(default)]
    pub style: Option<String>,
    /// 位置
    #[serde(default)]
    pub position: Option<String>,
    /// 激活时回到顶部
    #[serde(default)]
    pub back_top: Option<bool>,
    /// 激活时显示全部分组
    #[serde(default)]
    pub show_all: Option<bool>,
}

/// 音效配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    /// 复制音效
    #[serde(default)]
    pub copy: Option<bool>,
}

/// 搜索配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConfig {
    /// 位置
    #[serde(default)]
    pub position: Option<String>,
    /// 默认聚焦
    #[serde(default)]
    pub default_focus: Option<bool>,
    /// 自动清除
    #[serde(default)]
    pub auto_clear: Option<bool>,
}

/// 内容配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentConfig {
    /// 自动粘贴
    #[serde(default)]
    pub auto_paste: Option<String>,
    /// OCR
    #[serde(default)]
    pub ocr: Option<bool>,
    /// 复制纯文本
    #[serde(default)]
    pub copy_plain: Option<bool>,
    /// 粘贴纯文本
    #[serde(default)]
    pub paste_plain: Option<bool>,
    /// 操作按钮
    #[serde(default)]
    pub operation_buttons: Option<Vec<String>>,
    /// 自动收藏
    #[serde(default)]
    pub auto_favorite: Option<bool>,
    /// 删除确认
    #[serde(default)]
    pub delete_confirm: Option<bool>,
    /// 自动排序
    #[serde(default)]
    pub auto_sort: Option<bool>,
    /// 显示原文
    #[serde(default)]
    pub show_original_content: Option<bool>,
    /// 代码检测
    #[serde(default)]
    pub code_detection: Option<bool>,
    /// 显示来源应用
    #[serde(default)]
    pub show_source_app: Option<bool>,
    /// 颜色检测
    #[serde(default)]
    pub color_detection: Option<bool>,
}

/// 历史记录配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryConfig {
    /// 时长
    #[serde(default)]
    pub duration: Option<i64>,
    /// 单位
    #[serde(default)]
    pub unit: Option<i64>,
    /// 最大数量
    #[serde(default)]
    pub max_count: Option<i64>,
}

/// 内部复制配置（临时状态，不同步）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalCopyConfig {
    /// 是否正在复制
    #[serde(default)]
    pub is_copying: Option<bool>,
    /// 项目 ID
    #[serde(default)]
    pub item_id: Option<String>,
}

/// 配置同步结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSyncResult {
    /// 是否成功
    pub success: bool,
    /// 消息
    pub message: String,
}

/// 配置同步管理器
pub struct ConfigSyncManager {
    webdav_client: WebDAVClientState,
}

impl ConfigSyncManager {
    pub fn new(webdav_client: WebDAVClientState) -> Self {
        Self { webdav_client }
    }

    /// 上传本地配置到云端
    pub async fn upload_local_config(&self) -> Result<ConfigSyncResult, String> {
        log::info!("[Config] 开始上传本地配置到云端...");

        let config_path = get_config_path()?;
        log::info!("[Config] 配置文件路径: {:?}", config_path);

        let config_content = match std::fs::read_to_string(&config_path) {
            Ok(content) => content,
            Err(e) => {
                log::error!("[Config] 读取本地配置文件失败: {}", e);
                return Ok(ConfigSyncResult {
                    success: false,
                    message: format!("读取配置文件失败: {}", e),
                });
            }
        };

        let config_data: AppConfig = match serde_json::from_str(&config_content) {
            Ok(data) => data,
            Err(e) => {
                log::error!("[Config] 解析本地配置文件失败: {}", e);
                return Ok(ConfigSyncResult {
                    success: false,
                    message: format!("解析配置文件失败: {}", e),
                });
            }
        };

        let filtered_config = self.filter_config_for_sync(config_data);
        let filtered_json = serde_json::to_string_pretty(&filtered_config)
            .map_err(|e| format!("序列化配置失败: {}", e))?;

        log::info!(
            "[Config] 上传配置: globalStore={}, clipboardStore={}",
            filtered_config.global_store.is_some(),
            filtered_config.clipboard_store.is_some()
        );

        let client = self.webdav_client.lock().await;
        let remote_path = "store-config.json";

        match client.upload_sync_data(remote_path, &filtered_json).await {
            Ok(_) => {
                log::info!("[Config] 上传成功");
                Ok(ConfigSyncResult {
                    success: true,
                    message: "配置已上传到云端".to_string(),
                })
            }
            Err(e) => {
                log::error!("[Config] 上传失败: {}", e);
                Ok(ConfigSyncResult {
                    success: false,
                    message: format!("上传失败: {}", e),
                })
            }
        }
    }

    /// 应用云端配置
    pub async fn apply_remote_config(&self) -> Result<ConfigSyncResult, String> {
        log::info!("[Config] 开始应用云端配置...");

        let client = self.webdav_client.lock().await;
        let remote_path = "store-config.json";

        let download_result = match client.download_sync_data(remote_path).await {
            Ok(result) => result,
            Err(e) => {
                log::error!("[Config] 下载失败: {}", e);
                return Ok(ConfigSyncResult {
                    success: false,
                    message: format!("下载配置失败: {}", e),
                });
            }
        };

        if !download_result.success {
            return Ok(ConfigSyncResult {
                success: false,
                message: download_result
                    .error_message
                    .unwrap_or_else(|| "下载配置失败".to_string()),
            });
        }

        if let Some(data) = download_result.data {
            let remote_config: AppConfig = match serde_json::from_str(&data) {
                Ok(config) => config,
                Err(e) => {
                    log::error!("[Config] 解析云端配置失败: {}", e);
                    return Ok(ConfigSyncResult {
                        success: false,
                        message: "云端配置格式错误".to_string(),
                    });
                }
            };

            let config_path = get_config_path()?;
            log::info!("[Config] 写入配置文件路径: {:?}", config_path);

            if let Some(parent) = config_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
            }

            let config_json = serde_json::to_string_pretty(&remote_config)
                .map_err(|e| format!("序列化配置失败: {}", e))?;

            std::fs::write(&config_path, config_json)
                .map_err(|e| format!("写入配置文件失败: {}", e))?;

            log::info!("[Config] 云端配置已应用");
            Ok(ConfigSyncResult {
                success: true,
                message: "云端配置已应用".to_string(),
            })
        } else {
            Ok(ConfigSyncResult {
                success: false,
                message: "云端配置数据为空".to_string(),
            })
        }
    }

    /// 过滤配置，移除环境相关和不需要同步的字段
    fn filter_config_for_sync(&self, mut config: AppConfig) -> AppConfig {
        // 1. 清空环境相关的配置
        if let Some(global_store) = &mut config.global_store {
            global_store.env = Some(serde_json::Value::Object(serde_json::Map::new()));
        }

        // 2. 清除云同步的运行时状态（保留其他设置）
        if let Some(global_store) = &mut config.global_store {
            if let Some(cloud_sync) = &mut global_store.cloud_sync {
                cloud_sync.last_sync_time = Some(0);
                cloud_sync.is_syncing = Some(false);
            }
        }

        // 3. 清除剪贴板存储的临时状态
        if let Some(clipboard_store) = &mut config.clipboard_store {
            clipboard_store.internal_copy = Some(InternalCopyConfig {
                is_copying: Some(false),
                item_id: None,
            });
        }

        config
    }
}

/// 获取配置文件路径
fn get_config_path() -> Result<std::path::PathBuf, String> {
    let bundle_id = "com.Rains.EcoPaste-Sync";
    let is_dev = cfg!(debug_assertions);

    let config_filename = if is_dev {
        ".store.dev.json"
    } else {
        "store.json"
    };

    if let Some(app_data_dir) = std::env::var_os("APPDATA") {
        let config_path = std::path::PathBuf::from(app_data_dir)
            .join(bundle_id)
            .join(config_filename);

        return Ok(config_path);
    }

    let save_data_dir = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
        .ok_or_else(|| "无法获取数据目录".to_string())?;

    let config_path = save_data_dir.join(bundle_id).join(config_filename);

    Ok(config_path)
}
