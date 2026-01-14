//! 迁移数据模型定义
//! 定义旧版本数据结构和新版本数据结构的映射关系

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
    /// 本地需要迁移的数据量
    pub local_items_to_migrate: usize,
    /// 云端需要迁移的数据量
    pub cloud_items_to_migrate: usize,
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
    /// 迁移的本地项数
    pub migrated_local_items: usize,
    /// 迁移的云端项数
    pub migrated_cloud_items: usize,
    /// 迁移耗时（毫秒）
    pub duration_ms: u64,
    /// 错误信息
    pub errors: Vec<String>,
    /// 迁移后的版本号
    pub new_version: String,
}

/// 旧版数据库中的历史记录项结构（用于读取旧版数据）
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct LegacyHistoryItem {
    pub id: String,
    pub item_type: String,
    pub group: String,
    pub value: String,
    pub search: String,
    pub count: i32,
    pub width: i32,
    pub height: i32,
    pub favorite: i32,
    pub create_time: i64, // 字符串时间戳
    pub note: String,
    pub subtype: String,
    pub deleted: i32,
    pub sync_status: String,
    // 以下旧版字段在新版中已移除，会被丢弃：
    pub lazy_download: bool,
    pub file_size: i64,
    pub file_type: String,
    pub last_modified: i64,
    pub is_code: bool,
    pub code_language: String,
    pub source_app_name: String,
    pub source_app_icon: String,
    pub position: i32,
}

/// 新版数据库中的历史记录项结构（用于写入新版数据）
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct NewHistoryItem {
    pub id: String,
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
    pub source_app_name: Option<String>,
    pub source_app_icon: Option<String>,
    pub position: Option<i32>,
}

impl From<LegacyHistoryItem> for NewHistoryItem {
    fn from(legacy: LegacyHistoryItem) -> Self {
        Self {
            id: legacy.id,
            item_type: Some(legacy.item_type).filter(|s| !s.is_empty()),
            group: Some(legacy.group).filter(|s| !s.is_empty()),
            value: Some(legacy.value).filter(|s| !s.is_empty()),
            search: Some(legacy.search).filter(|s| !s.is_empty()),
            count: Some(legacy.count),
            width: Some(legacy.width),
            height: Some(legacy.height),
            favorite: legacy.favorite,
            // 优先使用 create_time，如果为0则使用 last_modified
            time: if legacy.create_time > 0 {
                legacy.create_time
            } else {
                legacy.last_modified
            },
            note: Some(legacy.note).filter(|s| !s.is_empty()),
            subtype: Some(legacy.subtype).filter(|s| !s.is_empty()),
            deleted: Some(legacy.deleted),
            // 同步状态映射
            sync_status: match legacy.sync_status.as_str() {
                "synced" => Some("synced".to_string()),
                "syncing" => Some("changed".to_string()),
                _ => Some("not_synced".to_string()),
            },
            source_app_name: Some(legacy.source_app_name).filter(|s| !s.is_empty()),
            source_app_icon: Some(legacy.source_app_icon).filter(|s| !s.is_empty()),
            position: Some(legacy.position),
        }
    }
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
    /// 迁移的本地项数
    pub migrated_local_items: usize,
    /// 迁移的云端项数
    pub migrated_cloud_items: usize,
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
            migrated_local_items: 0,
            migrated_cloud_items: 0,
            success: false,
            error: None,
        }
    }
}
