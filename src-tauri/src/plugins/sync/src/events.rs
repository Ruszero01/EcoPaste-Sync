//! 事件系统模块
//! 用于在前端和后端之间传递进度更新、状态变化和错误信息

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// 事件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncEvent {
    /// 同步开始
    SyncStarted {
        timestamp: i64,
    },
    /// 同步进度更新
    SyncProgress {
        percentage: f64,
        message: String,
        current_step: String,
    },
    /// 同步完成
    SyncCompleted {
        success: bool,
        timestamp: i64,
        result: crate::sync_core::SyncProcessResult,
    },
    /// 同步错误
    SyncError {
        error: String,
        timestamp: i64,
    },
    /// 自动同步状态变化
    AutoSyncStatusChanged {
        enabled: bool,
        interval_minutes: u64,
    },
    /// 连接状态变化
    ConnectionStatusChanged {
        connected: bool,
        message: String,
    },
}

/// 事件发射器
/// 用于发送事件到前端
pub struct EventEmitter {
    /// 事件发射器状态
    initialized: bool,
}

impl EventEmitter {
    /// 创建新的事件发射器
    pub fn new() -> Self {
        Self {
            initialized: false,
        }
    }

    /// 初始化事件发射器
    pub fn initialize(&mut self) {
        self.initialized = true;
    }

    /// 检查是否已初始化
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// 发送事件（简化实现）
    pub async fn emit(&self, event: SyncEvent) -> Result<(), String> {
        if !self.initialized {
            return Err("事件发射器未初始化".to_string());
        }

        // 这里简化实现，实际应该使用 Tauri 的事件系统
        println!("发送事件: {:?}", event);
        Ok(())
    }
}

/// 创建共享的事件发射器实例
pub fn create_shared_emitter() -> Arc<Mutex<EventEmitter>> {
    Arc::new(Mutex::new(EventEmitter::new()))
}
