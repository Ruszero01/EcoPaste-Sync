//! 基础类型定义

use serde::{Deserialize, Serialize};

/// 同步状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncStatus {
    Idle,
    Syncing,
    Error,
}

/// 同步结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
}

/// 同步配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// WebDAV 服务器地址
    pub server_url: String,
    /// WebDAV 用户名
    pub username: String,
    /// WebDAV 密码
    pub password: String,
    /// 远程同步路径
    pub path: String,
    /// 是否启用自动同步
    pub auto_sync: bool,
    /// 自动同步间隔（分钟）
    pub auto_sync_interval_minutes: u64,
    /// 是否仅同步收藏项目
    pub only_favorites: bool,
    /// 是否包含文件同步
    pub include_files: bool,
    /// 连接超时（毫秒）
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_timeout() -> u64 {
    30000
}

/// 同步进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub current: u64,
    pub total: u64,
    pub percentage: f64,
}

/// 自动同步状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoSyncStatus {
    pub enabled: bool,
    pub interval_minutes: u64,
    pub last_sync_time: Option<u64>,
    pub next_sync_time: Option<u64>,
}
