//! 迁移数据模型定义

use serde::{Deserialize, Serialize};

/// 迁移进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationProgress {
    /// 当前迁移阶段
    pub current_phase: String,
    /// 已处理的项数
    pub processed_items: usize,
    /// 总项数
    pub total_items: usize,
    /// 进度百分比 (0-100)
    pub percentage: f64,
    /// 当前操作描述
    pub current_operation: String,
    /// 是否完成
    pub completed: bool,
    /// 错误信息（如果有）
    pub error: Option<String>,
}

/// 迁移标记文件内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationMarker {
    /// 迁移版本
    pub version: String,
    /// 迁移时间戳
    pub timestamp: i64,
    /// 迁移的旧版本号
    #[serde(default)]
    pub from_version: String,
    /// 迁移的本地项数
    #[serde(default)]
    pub migrated_local_items: usize,
    /// 迁移的云端项数
    #[serde(default)]
    pub migrated_cloud_items: usize,
    /// 是否成功
    pub success: bool,
    /// 错误信息
    #[serde(default)]
    pub error: Option<String>,
    /// 两阶段迁移阶段标记
    #[serde(default)]
    pub phase: Option<MigrationPhase>,
}

impl Default for MigrationMarker {
    fn default() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION").to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            from_version: String::new(),
            migrated_local_items: 0,
            migrated_cloud_items: 0,
            success: false,
            error: None,
            phase: None,
        }
    }
}

/// 两阶段迁移阶段标记
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MigrationPhase {
    /// 阶段1完成：旧数据库已备份
    Phase1Completed,
    /// 阶段2完成：数据已迁移到新数据库
    Phase2Completed,
}
