//! 基础类型定义

use serde::{Deserialize, Serialize};

/// 同步状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncStatus {
    Idle,
    Syncing,
    Error,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_status_default() {
        let config = SyncConfig {
            server_url: String::new(),
            username: String::new(),
            password: String::new(),
            path: String::new(),
            auto_sync: false,
            auto_sync_interval_minutes: 5,
            only_favorites: false,
            include_images: false,
            include_files: false,
            timeout: 30000,
        };
        assert!(!config.auto_sync);
        assert!(!config.only_favorites);
        assert!(!config.include_files);
        assert_eq!(config.auto_sync_interval_minutes, 5);
        assert_eq!(config.timeout, 30000);
    }

    #[test]
    fn test_sync_progress_completion() {
        let progress = SyncProgress {
            current: 50,
            total: 100,
            percentage: 50.0,
        };
        assert_eq!(progress.percentage, 50.0);
    }

    #[test]
    fn test_sync_progress_full() {
        let progress = SyncProgress {
            current: 100,
            total: 100,
            percentage: 100.0,
        };
        assert_eq!(progress.percentage, 100.0);
    }

    #[test]
    fn test_sync_progress_empty() {
        let progress = SyncProgress {
            current: 0,
            total: 100,
            percentage: 0.0,
        };
        assert_eq!(progress.percentage, 0.0);
    }

    #[test]
    fn test_auto_sync_status_default() {
        let status = AutoSyncStatus {
            enabled: false,
            interval_minutes: 5,
            last_sync_time: None,
            next_sync_time: None,
            is_syncing: false,
        };
        assert!(!status.enabled);
        assert!(!status.is_syncing);
        assert!(status.last_sync_time.is_none());
    }

    #[test]
    fn test_sync_result_success() {
        let result = SyncResult {
            success: true,
            message: "Sync completed".to_string(),
        };
        assert!(result.success);
        assert_eq!(result.message, "Sync completed");
    }

    #[test]
    fn test_sync_result_error() {
        let result = SyncResult {
            success: false,
            message: "Connection failed".to_string(),
        };
        assert!(!result.success);
        assert_eq!(result.message, "Connection failed");
    }
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
    /// 是否包含图片同步
    pub include_images: bool,
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
    pub is_syncing: bool,
}
