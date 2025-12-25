//! 数据模型定义
//! 与前端数据库表结构保持一致

use serde::{Deserialize, Serialize};

/// 剪贴板历史记录项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    pub time: i64,
    pub note: Option<String>,
    pub subtype: Option<String>,
    pub file_size: Option<i64>,
    pub deleted: Option<i32>,
    pub sync_status: Option<String>,
    pub is_cloud_data: Option<i32>,
    pub code_language: Option<String>,
    pub is_code: Option<i32>,
    pub source_app_name: Option<String>,
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
            time: 0,
            note: None,
            subtype: None,
            file_size: None,
            deleted: Some(0),
            sync_status: Some("none".to_string()),
            is_cloud_data: Some(0),
            code_language: None,
            is_code: Some(0),
            source_app_name: None,
            source_app_icon: None,
            position: Some(0),
        }
    }
}

/// 同步数据项（用于云同步）
/// 注意：云端不保留 deleted 字段，已删除项目直接从云端移除
/// 注意：所有元数据都保存在 value 字段中（JSON格式），外部不再保留冗余字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDataItem {
    pub id: String,
    pub item_type: String,
    pub subtype: Option<String>,
    pub value: Option<String>,
    pub favorite: bool,
    pub note: Option<String>,
    pub time: i64,
}

impl From<HistoryItem> for SyncDataItem {
    fn from(item: HistoryItem) -> Self {
        Self {
            id: item.id,
            item_type: item.item_type.unwrap_or_else(|| "text".to_string()),
            subtype: item.subtype, // 从历史数据中提取 subtype
            value: item.value,
            favorite: item.favorite == 1,
            note: item.note,
            time: item.time,
            // 所有元数据都保存在 value 字段中（JSON格式）
        }
    }
}

/// 插入数据项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertItem {
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
    pub file_size: Option<i64>,
    pub deleted: Option<i32>,
    pub sync_status: Option<String>,
    pub is_cloud_data: Option<i32>,
    pub code_language: Option<String>,
    pub is_code: Option<i32>,
    pub source_app_name: Option<String>,
    pub source_app_icon: Option<String>,
    pub position: Option<i32>,
}

/// 插入结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsertResult {
    pub is_update: bool,
    pub insert_id: Option<String>,
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

/// 数据库统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseStatistics {
    pub total_items: usize,
    pub active_items: usize,
    pub synced_items: usize,
    pub favorite_items: usize,
}
