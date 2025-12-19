//! 数据模型定义
//! 与前端数据库表结构保持一致

use serde::{Deserialize, Serialize};

/// 剪贴板历史记录项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
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
    #[serde(rename = "createTime")]
    pub create_time: String,
    pub note: Option<String>,
    pub subtype: Option<String>,
    #[serde(rename = "lazyDownload")]
    pub lazy_download: Option<i32>,
    #[serde(rename = "fileSize")]
    pub file_size: Option<i64>,
    #[serde(rename = "fileType")]
    pub file_type: Option<String>,
    pub deleted: Option<i32>,
    #[serde(rename = "syncStatus")]
    pub sync_status: Option<String>,
    #[serde(rename = "isCloudData")]
    pub is_cloud_data: Option<i32>,
    #[serde(rename = "codeLanguage")]
    pub code_language: Option<String>,
    #[serde(rename = "isCode")]
    pub is_code: Option<i32>,
    #[serde(rename = "lastModified")]
    pub last_modified: Option<i64>,
    #[serde(rename = "sourceAppName")]
    pub source_app_name: Option<String>,
    #[serde(rename = "sourceAppIcon")]
    pub source_app_icon: Option<String>,
    pub position: Option<i32>,
}

impl Default for HistoryItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            item_type: None,
            group: None,
            value: None,
            search: None,
            count: None,
            width: None,
            height: None,
            favorite: 0,
            create_time: String::new(),
            note: None,
            subtype: None,
            lazy_download: Some(0),
            file_size: None,
            file_type: None,
            deleted: Some(0),
            sync_status: Some("none".to_string()),
            is_cloud_data: Some(0),
            code_language: None,
            is_code: Some(0),
            last_modified: None,
            source_app_name: None,
            source_app_icon: None,
            position: Some(0),
        }
    }
}

/// 同步数据项（用于云同步）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDataItem {
    pub id: String,
    pub item_type: String,
    pub subtype: Option<String>,
    pub value: Option<String>,
    pub favorite: bool,
    pub note: Option<String>,
    pub last_modified: i64,
    pub deleted: bool,
    // 统计元数据
    pub file_size: Option<i64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

impl From<HistoryItem> for SyncDataItem {
    fn from(item: HistoryItem) -> Self {
        let last_modified = chrono::DateTime::parse_from_rfc3339(&item.create_time)
            .map(|dt| dt.timestamp_millis())
            .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis());

        Self {
            id: item.id,
            item_type: item.item_type.unwrap_or_else(|| "text".to_string()),
            subtype: item.subtype, // 从历史数据中提取 subtype
            value: item.value,
            favorite: item.favorite == 1,
            note: item.note,
            last_modified: item.last_modified.unwrap_or(last_modified),
            deleted: item.deleted.unwrap_or(0) == 1,
            // 统计元数据
            file_size: item.file_size,
            width: item.width,
            height: item.height,
        }
    }
}

/// 查询选项
#[derive(Debug, Clone, Default)]
pub struct QueryOptions {
    /// 筛选条件
    pub where_clause: Option<String>,
    /// 排序
    pub order_by: Option<String>,
    /// 限制数量
    pub limit: Option<i32>,
    /// 偏移量
    pub offset: Option<i32>,
    /// 仅收藏
    pub only_favorites: bool,
    /// 排除已删除
    pub exclude_deleted: bool,
}
