//! 迁移数据模型定义
//! 定义迁移状态、进度和结果

use serde::{Deserialize, Serialize};

/// 迁移状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MigrationStatus {
    /// 未知状态
    Unknown,
    /// 需要迁移
    NeedMigration,
    /// 迁移中
    InProgress,
    /// 迁移完成
    Completed,
    /// 迁移失败
    Failed,
    /// 无需迁移（已是新版本）
    UpToDate,
}

/// 迁移类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MigrationType {
    /// 数据库结构迁移
    DatabaseSchema,
    /// 配置格式迁移
    ConfigFormat,
    /// 云端数据格式迁移
    CloudDataFormat,
    /// 完整迁移（包含所有类型）
    Full,
}

/// 迁移检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationCheckResult {
    /// 当前状态
    pub status: MigrationStatus,
    /// 检测到的旧版本号（如果有）
    pub old_version: Option<String>,
    /// 需要的迁移类型
    pub required_migrations: Vec<MigrationType>,
    /// 需要迁移的数据量估算
    pub items_to_migrate: usize,
    /// 估计迁移耗时（秒）
    pub estimated_duration_seconds: u64,
    /// 风险提示
    pub warnings: Vec<String>,
}

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

/// 迁移结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationResult {
    /// 是否成功
    pub success: bool,
    /// 迁移的项数
    pub migrated_items: usize,
    /// 迁移耗时（毫秒）
    pub duration_ms: u64,
    /// 错误信息
    pub errors: Vec<String>,
    /// 迁移后的版本号
    pub new_version: String,
}

/// 迁移标记文件内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationMarker {
    /// 迁移版本
    pub version: String,
    /// 迁移时间戳
    pub timestamp: i64,
    /// 迁移的旧版本号
    pub from_version: String,
    /// 迁移类型
    pub migration_type: MigrationType,
    /// 迁移的项数
    pub migrated_items: usize,
    /// 是否成功
    pub success: bool,
    /// 错误信息
    pub error: Option<String>,
}

impl Default for MigrationMarker {
    fn default() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION").to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            from_version: String::new(),
            migration_type: MigrationType::Full,
            migrated_items: 0,
            success: false,
            error: None,
        }
    }
}

// 保留旧版本数据结构用于参考和文档
// 这些结构体在当前迁移逻辑中未被直接使用
// 因为检测逻辑直接通过检查字段存在与否来判断版本
#[allow(dead_code)]
mod legacy_structures {
    use serde::{Deserialize, Serialize};

    /// 旧版本历史记录项（v0.5.x - v0.6.x 格式）
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LegacyHistoryItem {
        pub id: String,
        #[serde(rename = "type")]
        pub item_type: Option<String>,
        pub group: Option<String>,
        pub value: Option<String>,
        pub search: Option<String>,
        pub count: Option<i32>,
        pub width: Option<i32>,
        pub height: Option<i32>,
        pub favorite: i32,
        pub time: i64,
        pub note: Option<String>,
        pub subtype: Option<String>,
        pub deleted: Option<i32>,
        pub sync_status: Option<String>,
    }

    /// 旧版本同步数据项（复杂格式）
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LegacySyncDataItem {
        pub id: String,
        pub item_type: String,
        pub subtype: Option<String>,
        pub value: Option<String>,
        pub favorite: bool,
        pub note: Option<String>,
        pub time: i64,
        pub checksum: Option<String>,
        pub remote_path: Option<String>,
        pub file_size: Option<u64>,
        pub width: Option<u32>,
        pub height: Option<u32>,
    }

    /// 旧版本配置格式
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LegacyStoreConfig {
        pub global_store: LegacyGlobalStore,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LegacyGlobalStore {
        pub cloud_sync: LegacyCloudSync,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LegacyCloudSync {
        pub server_config: LegacyServerConfig,
        pub auto_sync_settings: Option<LegacyAutoSyncSettings>,
        pub sync_mode_config: Option<LegacySyncModeConfig>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LegacyServerConfig {
        pub url: String,
        pub username: String,
        pub password: String,
        pub path: String,
        pub timeout: Option<u64>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LegacyAutoSyncSettings {
        pub enabled: bool,
        pub interval_hours: f64,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LegacySyncModeConfig {
        pub settings: LegacySyncSettings,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LegacySyncSettings {
        pub include_text: bool,
        pub include_html: bool,
        pub include_rtf: bool,
        pub include_markdown: bool,
        pub include_images: bool,
        pub include_files: bool,
        pub only_favorites: bool,
    }
}
