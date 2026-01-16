//! 自动同步管理器
//! 负责自动同步的定时器管理，不涉及具体的同步逻辑

use crate::types::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

/// 自动同步管理器状态
pub type AutoSyncManagerState = Arc<Mutex<AutoSyncManager>>;

/// 自动同步管理器
/// 专门负责自动同步的定时器管理，包括：
/// - 定时器的启动、停止、更新
/// - 同步间隔的管理
/// - 触发同步回调的执行
pub struct AutoSyncManager {
    /// 是否启用自动同步
    enabled: bool,
    /// 同步间隔（分钟）
    interval_minutes: u64,
    /// 上次同步时间（Unix 时间戳）
    last_sync_time: Option<u64>,
    /// 下次同步时间（Unix 时间戳）
    next_sync_time: Option<u64>,
    /// 同步回调函数
    sync_callback: Option<Box<dyn FnMut() + Send + Sync>>,
    /// 内部定时器句柄（用于取消定时器）
    _timer_handle: Option<tokio::task::JoinHandle<()>>,
    /// 当前是否正在同步
    syncing: AtomicBool,
}

impl AutoSyncManager {
    /// 创建新的自动同步管理器实例
    pub fn new() -> Self {
        Self {
            enabled: false,
            interval_minutes: 60,
            last_sync_time: None,
            next_sync_time: None,
            sync_callback: None,
            _timer_handle: None,
            syncing: AtomicBool::new(false),
        }
    }

    /// 设置同步回调函数
    /// # Arguments
    /// * `callback` - 同步回调函数，会在定时器触发时被调用
    pub fn set_sync_callback(&mut self, callback: Box<dyn FnMut() + Send + Sync>) {
        self.sync_callback = Some(callback);
    }

    /// 启动自动同步
    /// # Arguments
    /// * `interval_minutes` - 同步间隔（分钟）
    pub async fn start(&mut self, interval_minutes: u64) -> Result<(), String> {
        if interval_minutes == 0 {
            return Err("同步间隔必须大于0".to_string());
        }

        // 如果已经在运行，先停止
        if self.enabled {
            self.stop().await?;
        }

        self.enabled = true;
        self.interval_minutes = interval_minutes;

        // 注意：不在启动时设置 last_sync_time
        // last_sync_time 只在同步真正完成时由 update_sync_time() 更新

        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.next_sync_time = Some(current_time + (interval_minutes * 60));

        // 启动异步定时器任务
        let interval_secs = interval_minutes * 60;
        let callback = self.sync_callback.take();

        // 存储定时器句柄
        self._timer_handle = Some(tokio::spawn(async move {
            // 如果没有回调函数，直接返回
            let Some(mut callback) = callback else {
                return;
            };

            // 等待初始间隔
            sleep(Duration::from_secs(interval_secs)).await;

            // 定时循环
            loop {
                // 调用同步回调
                callback();

                // 等待下次同步
                sleep(Duration::from_secs(interval_secs)).await;
            }
        }));

        Ok(())
    }

    /// 停止自动同步
    pub async fn stop(&mut self) -> Result<(), String> {
        self.enabled = false;
        self.next_sync_time = None;

        // 停止并清理定时器任务
        if let Some(handle) = self._timer_handle.take() {
            handle.abort();
            // 等待任务被中止（可选，避免资源泄露）
            let _ = handle.await;
        }

        Ok(())
    }

    /// 更新自动同步间隔
    /// # Arguments
    /// * `interval_minutes` - 新的同步间隔（分钟）
    pub async fn update_interval(&mut self, interval_minutes: u64) -> Result<(), String> {
        if interval_minutes == 0 {
            return Err("同步间隔必须大于0".to_string());
        }

        let was_enabled = self.enabled;

        // 如果正在启用，先停止当前定时器
        if was_enabled {
            self.stop().await?;
        }

        self.interval_minutes = interval_minutes;

        // 重新启动定时器（如果之前是启用的）
        if was_enabled {
            self.start(interval_minutes).await?;
        }

        Ok(())
    }

    /// 获取自动同步状态
    pub fn get_status(&self) -> AutoSyncStatus {
        AutoSyncStatus {
            enabled: self.enabled,
            interval_minutes: self.interval_minutes,
            last_sync_time: self.last_sync_time,
            next_sync_time: self.next_sync_time,
            is_syncing: self.syncing.load(Ordering::Relaxed),
        }
    }

    /// 检查自动同步是否启用
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// 手动触发一次同步（不更新 last_sync_time）
    /// 这里的回调只负责通知，实际的同步逻辑在 CloudSyncEngine 中
    pub fn trigger_sync(&mut self) {
        if let Some(callback) = &mut self.sync_callback {
            callback();
        }
    }

    /// 更新同步时间戳
    /// 在同步完成后调用，更新最后同步时间
    pub fn update_sync_time(&mut self) {
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.last_sync_time = Some(current_time);

        if self.enabled {
            self.next_sync_time = Some(current_time + (self.interval_minutes * 60));
        }
    }

    /// 获取上次同步时间
    pub fn get_last_sync_time(&self) -> Option<u64> {
        self.last_sync_time
    }

    /// 设置上次同步时间（从配置文件加载）
    pub fn set_last_sync_time(&mut self, timestamp: Option<u64>) {
        self.last_sync_time = timestamp;
    }

    /// 计算到下次同步的剩余时间（秒）
    /// # Returns
    /// 返回剩余秒数，如果未启用自动同步则返回 None
    pub fn time_until_next_sync(&self) -> Option<u64> {
        if !self.enabled || self.next_sync_time.is_none() {
            return None;
        }

        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let remaining = self.next_sync_time.unwrap().saturating_sub(current_time);
        if remaining == 0 {
            Some(1) // 如果已经过期，至少返回1秒
        } else {
            Some(remaining)
        }
    }

    /// 重置自动同步管理器
    /// 清除所有状态和回调
    pub fn reset(&mut self) {
        // 停止定时器
        self.enabled = false;

        // 清理定时器任务
        if let Some(handle) = self._timer_handle.take() {
            handle.abort();
        }

        // 重置状态
        self.interval_minutes = 60;
        self.last_sync_time = None;
        self.next_sync_time = None;
        self.sync_callback = None;
    }
}

/// 创建共享的自动同步管理器实例
pub fn create_shared_manager() -> AutoSyncManagerState {
    Arc::new(Mutex::new(AutoSyncManager::new()))
}
