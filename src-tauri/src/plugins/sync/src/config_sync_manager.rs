//! 配置同步管理器
//! 负责应用配置的云端同步

use crate::webdav::WebDAVClientState;
use serde::{Deserialize, Serialize};

/// 应用配置结构
/// 与前端的Store结构对应，但只包含需要同步的部分
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 全局配置
    pub global_store: Option<GlobalStoreConfig>,
    /// 剪贴板配置
    pub clipboard_store: Option<ClipboardStoreConfig>,
}

/// 全局存储配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalStoreConfig {
    /// 环境配置
    pub env: Option<serde_json::Value>,
    /// 云同步配置
    pub cloud_sync: Option<CloudSyncConfig>,
    /// 应用配置
    pub app: Option<AppSettingsConfig>,
}

/// 云同步配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSyncConfig {
    /// 上次同步时间
    pub last_sync_time: Option<u64>,
    /// 是否正在同步
    pub is_syncing: Option<bool>,
    /// 自动同步设置
    pub auto_sync_settings: Option<AutoSyncSettingsConfig>,
}

/// 自动同步设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoSyncSettingsConfig {
    /// 是否启用
    pub enabled: bool,
    /// 同步间隔（小时）
    pub interval_hours: u64,
}

/// 应用设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettingsConfig {
    /// 自动启动
    pub auto_start: Option<bool>,
    /// 显示任务栏图标
    pub show_taskbar_icon: Option<bool>,
    /// 静默启动
    pub silent_start: Option<bool>,
}

/// 剪贴板存储配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardStoreConfig {
    /// 内部复制状态
    pub internal_copy: Option<InternalCopyConfig>,
}

/// 内部复制配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalCopyConfig {
    /// 是否正在复制
    pub is_copying: bool,
    /// 项目ID
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
/// 负责管理应用配置的云端同步
pub struct ConfigSyncManager {
    /// WebDAV客户端
    webdav_client: WebDAVClientState,
}

impl ConfigSyncManager {
    /// 创建新的配置同步管理器
    pub fn new(webdav_client: WebDAVClientState) -> Self {
        Self { webdav_client }
    }

    /// 上传本地配置到云端
    pub async fn upload_local_config(&self) -> Result<ConfigSyncResult, String> {
        log::info!("[Config] 开始上传本地配置到云端...");

        // 获取应用数据目录（使用dirs crate，与数据库插件保持一致）
        let save_data_dir = dirs::data_dir()
            .or_else(|| dirs::config_dir())
            .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
            .ok_or_else(|| "无法获取数据目录".to_string())?;

        let bundle_id = "com.Rains.EcoPaste-Sync";
        let app_data_dir = save_data_dir.join(bundle_id);
        let config_path = app_data_dir.join("store.json");

        // 读取本地配置文件
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

        // 解析配置并过滤
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

        // 上传到云端
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

        // 下载云端配置
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
            // 解析云端配置
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

            // 获取应用数据目录（使用dirs crate，与数据库插件保持一致）
            let save_data_dir = dirs::data_dir()
                .or_else(|| dirs::config_dir())
                .or_else(|| dirs::home_dir().map(|p| p.join(".local/share")))
                .ok_or_else(|| "无法获取数据目录".to_string())?;

            let bundle_id = "com.Rains.EcoPaste-Sync";
            let app_data_dir = save_data_dir.join(bundle_id);
            let config_path = app_data_dir.join("store.json");

            // 确保目录存在
            if let Some(parent) = config_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
            }

            // 写入配置文件
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
        // 1. 移除环境相关的配置
        if let Some(global_store) = &mut config.global_store {
            if let Some(env) = &mut global_store.env {
                *env = serde_json::Value::Object(serde_json::Map::new());
            }

            // 2. 移除运行时状态
            if let Some(cloud_sync) = &mut global_store.cloud_sync {
                cloud_sync.last_sync_time = Some(0);
                cloud_sync.is_syncing = Some(false);
            }

            // 3. 移除设备特定的配置项
            if let Some(app) = &mut global_store.app {
                // 保留基本设置，移除平台相关的配置
                let auto_start = app.auto_start;
                let show_taskbar_icon = app.show_taskbar_icon;
                let silent_start = app.silent_start;

                *app = AppSettingsConfig {
                    auto_start,
                    show_taskbar_icon,
                    silent_start,
                };
            }
        }

        // 4. 移除剪贴板存储中的临时状态
        if let Some(clipboard_store) = &mut config.clipboard_store {
            if let Some(internal_copy) = &mut clipboard_store.internal_copy {
                internal_copy.is_copying = false;
                internal_copy.item_id = None;
            }
        }

        config
    }
}
