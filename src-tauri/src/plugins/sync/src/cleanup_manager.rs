//! 云端数据清理管理器
//! 定期清理云端数据中的 deleted=true 项目，防止数据膨胀

use crate::webdav::WebDAVClientState;
use serde::{Deserialize, Serialize};
use tokio::time::{Duration, Instant};

/// 清理配置
#[derive(Debug, Clone)]
pub struct CleanupConfig {
    /// 是否启用定期清理
    pub enabled: bool,
    /// 清理间隔（天）
    pub interval_days: u64,
    /// 上次清理时间戳
    pub last_cleanup_time: Option<i64>,
}

/// 清理管理器
/// 负责定期清理云端数据中的垃圾数据
pub struct CleanupManager {
    /// WebDAV客户端
    webdav_client: WebDAVClientState,
    /// 清理配置
    config: CleanupConfig,
    /// 清理定时器
    cleanup_timer: Option<tokio::time::Interval>,
    /// 清理任务是否运行中
    is_running: bool,
}

impl CleanupManager {
    /// 创建新的清理管理器
    pub fn new(webdav_client: WebDAVClientState) -> Self {
        Self {
            webdav_client,
            config: CleanupConfig {
                enabled: false, // 默认关闭
                interval_days: 7, // 默认7天
                last_cleanup_time: None,
            },
            cleanup_timer: None,
            is_running: false,
        }
    }

    /// 启动定期清理
    /// 只有在自动同步关闭时才启动
    pub async fn start(&mut self) -> Result<(), String> {
        if !self.config.enabled {
            log::info!("ℹ️ 定期清理已禁用，跳过启动");
            return Ok(());
        }

        if self.is_running {
            log::info!("ℹ️ 清理管理器已在运行");
            return Ok(());
        }

        log::info!("🔄 启动云端数据定期清理，间隔: {} 天", self.config.interval_days);

        // 检查是否需要立即清理
        if let Some(last_time) = self.config.last_cleanup_time {
            let days_since_last = (chrono::Utc::now().timestamp_millis() - last_time)
                / (24 * 60 * 60 * 1000);

            if days_since_last >= self.config.interval_days as i64 {
                log::info!("⏰ 距离上次清理已过去 {} 天，执行清理", days_since_last);
                if let Err(e) = self.perform_cleanup().await {
                    log::error!("❌ 立即清理失败: {}", e);
                }
            }
        }

        // 启动定期清理定时器
        let interval = Duration::from_secs(self.config.interval_days * 24 * 60 * 60);
        self.cleanup_timer = Some(tokio::time::interval(interval));
        self.is_running = true;

        // 在后台运行清理任务
        let webdav_client = self.webdav_client.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            if let Some(mut timer) = Self::create_cleanup_timer(interval) {
                loop {
                    timer.tick().await;
                    log::info!("⏰ 执行定期云端数据清理...");

                    if let Err(e) = Self::cleanup_cloud_data(webdav_client.clone(), &config).await {
                        log::error!("❌ 定期清理失败: {}", e);
                    } else {
                        log::info!("✅ 定期清理完成");
                    }
                }
            }
        });

        Ok(())
    }

    /// 停止定期清理
    pub fn stop(&mut self) {
        if !self.is_running {
            return;
        }

        self.cleanup_timer = None;
        self.is_running = false;
        log::info!("⏹️ 云端数据定期清理已停止");
    }

    /// 执行一次清理
    pub async fn perform_cleanup(&mut self) -> Result<(), String> {
        log::info!("🧹 开始执行云端数据清理...");

        let result = Self::cleanup_cloud_data(self.webdav_client.clone(), &self.config).await;

        if result.is_ok() {
            // 更新上次清理时间
            self.config.last_cleanup_time = Some(chrono::Utc::now().timestamp_millis());
        }

        result
    }

    /// 清理云端数据中的垃圾数据
    async fn cleanup_cloud_data(
        webdav_client: WebDAVClientState,
        config: &CleanupConfig,
    ) -> Result<(), String> {
        let client = webdav_client.lock().await;

        // 下载当前云端数据
        let result = client.download_sync_data("sync-data.json").await
            .map_err(|e| format!("下载云端数据失败: {}", e))?;

        if let Some(data) = result.data {
            // 反序列化数据
            let items: Vec<serde_json::Value> = serde_json::from_str(&data)
                .map_err(|e| format!("反序列化云端数据失败: {}", e))?;

            let original_count = items.len();

            // 过滤掉 deleted=true 的项目
            let cleaned_items: Vec<_> = items.into_iter()
                .filter(|item| {
                    // 检查 deleted 字段
                    item.get("deleted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false) == false
                })
                .collect();

            let removed_count = original_count - cleaned_items.len();
            if removed_count > 0 {
                log::info!("🧹 发现 {} 项已删除数据，将被清理", removed_count);

                // 序列化清理后的数据
                let cleaned_json = serde_json::to_string(&cleaned_items)
                    .map_err(|e| format!("序列化清理数据失败: {}", e))?;

                // 上传清理后的数据
                client.upload_sync_data("sync-data.json", &cleaned_json).await
                    .map_err(|e| format!("上传清理数据失败: {}", e))?;

                log::info!("✅ 云端数据清理完成: {} -> {} 项",
                    original_count, cleaned_items.len());
            } else {
                log::info!("✅ 云端数据无需清理");
            }
        } else {
            log::info!("ℹ️ 云端暂无数据，跳过清理");
        }

        Ok(())
    }

    /// 创建清理定时器
    fn create_cleanup_timer(interval: Duration) -> Option<tokio::time::Interval> {
        Some(tokio::time::interval_at(
            Instant::now() + interval,
            interval,
        ))
    }

    /// 更新清理配置
    pub fn update_config(&mut self, config: CleanupConfig) {
        let was_running = self.is_running;
        let was_enabled = self.config.enabled;

        self.config = config.clone();

        // 如果启用状态发生变化，重新启动或停止
        if was_enabled != self.config.enabled {
            if self.config.enabled {
                // 启用：从新启动
                if was_running {
                    self.stop();
                }
                // 异步启动，不阻塞
                let webdav_client = self.webdav_client.clone();
                let config_clone = config.clone();
                tokio::spawn(async move {
                    let mut manager = Self::new(webdav_client);
                    manager.config = config_clone;
                    let _ = manager.start().await;
                });
            } else {
                // 禁用：停止
                self.stop();
            }
        }
    }

    /// 获取清理状态
    pub fn get_status(&self) -> CleanupStatus {
        CleanupStatus {
            enabled: self.config.enabled,
            interval_days: self.config.interval_days,
            last_cleanup_time: self.config.last_cleanup_time,
            is_running: self.is_running,
        }
    }

    /// 获取清理配置
    pub fn get_config(&self) -> &CleanupConfig {
        &self.config
    }
}

/// 清理状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupStatus {
    /// 是否启用
    pub enabled: bool,
    /// 清理间隔（天）
    pub interval_days: u64,
    /// 上次清理时间戳
    pub last_cleanup_time: Option<i64>,
    /// 是否正在运行
    pub is_running: bool,
}
