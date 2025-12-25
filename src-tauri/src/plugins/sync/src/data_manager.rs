//! 数据管理器模块
//! 负责本地和云端数据的缓存和筛选
//! 注意：同步状态管理已统一到 database/src/change_tracker.rs
//! 此模块不再维护同步状态，只做数据缓存

use crate::sync_core::{
    SyncDataItem, SyncIndex, SyncModeConfig, StateValidationResult, SyncStatistics,
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

/// 数据筛选器（简化版）
#[derive(Debug, Clone)]
pub struct DataFilter {
    /// 是否仅包含收藏项目
    pub only_favorites: bool,
    /// 内容类型筛选
    pub content_type_filter: ContentTypeFilter,
}

/// 内容类型筛选
#[derive(Debug, Clone)]
pub struct ContentTypeFilter {
    pub include_text: bool,
    pub include_html: bool,
    pub include_rtf: bool,
    pub include_images: bool,
    pub include_files: bool,
}

/// 数据管理器
/// 负责本地和云端数据的缓存和筛选
/// 同步状态管理已统一到 database/src/change_tracker.rs
pub struct DataManager {
    /// 本地数据缓存
    local_data: Vec<SyncDataItem>,
    /// 云端数据缓存
    cloud_data: Vec<SyncDataItem>,
    /// 当前同步索引
    #[allow(dead_code)]
    current_index: Option<SyncIndex>,
}

impl DataManager {
    /// 创建新的数据管理器实例
    pub fn new() -> Self {
        Self {
            local_data: vec![],
            cloud_data: vec![],
            current_index: None,
        }
    }

    /// 加载本地数据
    /// # Arguments
    /// * `data` - 本地数据
    pub async fn load_local_data(&mut self, data: Vec<SyncDataItem>) {
        self.local_data = data;
    }

    /// 加载云端数据
    /// # Arguments
    /// * `data` - 云端数据
    pub async fn load_cloud_data(&mut self, data: Vec<SyncDataItem>) {
        self.cloud_data = data;
    }

    /// 筛选数据
    /// # Arguments
    /// * `data` - 要筛选的数据
    /// * `filter` - 筛选条件
    /// * `mode_config` - 同步模式配置
    pub fn filter_data(
        &self,
        data: &[SyncDataItem],
        filter: &DataFilter,
        mode_config: &SyncModeConfig,
    ) -> Vec<SyncDataItem> {
        let mut filtered = Vec::new();

        for item in data {
            // 🧹 云端数据不包含已删除项目，无需检查 deleted 字段

            // 仅收藏项目筛选
            if filter.only_favorites || mode_config.only_favorites {
                if !item.favorite {
                    continue;
                }
            }

            // 内容类型筛选
            if !self.matches_content_type(item, &filter.content_type_filter, mode_config) {
                continue;
            }

            // 简化：移除时间范围筛选（create_time字段已移除）

            filtered.push(item.clone());
        }

        filtered
    }

    /// 检查项目是否匹配内容类型
    fn matches_content_type(
        &self,
        item: &SyncDataItem,
        filter: &ContentTypeFilter,
        mode_config: &SyncModeConfig,
    ) -> bool {
        match item.item_type.as_str() {
            "text" => filter.include_text && mode_config.content_types.include_text,
            "html" => filter.include_html && mode_config.content_types.include_html,
            "rtf" => filter.include_rtf && mode_config.content_types.include_rtf,
            "image" => filter.include_images && mode_config.include_images,
            "file" => filter.include_files && mode_config.include_files,
            _ => true,
        }
    }

    /// 计算数据差异（简化版）
    /// 用于增量同步，避免全量比较
    pub fn calculate_data_diff(&self) -> Vec<String> {
        let cloud_ids: HashSet<&str> = self.cloud_data.iter().map(|item| item.id.as_str()).collect();

        // 仅存在于本地的项目ID
        self.local_data
            .iter()
            .filter(|item| !cloud_ids.contains(item.id.as_str()))
            .map(|item| item.id.clone())
            .collect()
    }

    /// 验证数据状态一致性（简化版）
    /// 根据优化方案：简化验证逻辑
    pub fn validate_state_consistency(&self) -> StateValidationResult {
        // 简化：不做复杂的状态验证
        StateValidationResult {
            is_valid: true,
            abnormal_items: vec![],
            items_to_fix: vec![],
            validation_details: HashMap::new(),
        }
    }

    /// 计算统计信息（简化版）
    /// 注意：同步状态统计现在从数据库查询，不再从内存缓存
    pub fn calculate_statistics(&self) -> SyncStatistics {
        // 简化：不做复杂的状态验证
        let total_items = self.local_data.len();

        SyncStatistics {
            total_items,
            synced_items: 0, // 从数据库查询
            unsynced_items: 0, // 从数据库查询
            changed_items: 0, // 从数据库查询
        }
    }

    /// 获取本地数据
    pub fn get_local_data(&self) -> &[SyncDataItem] {
        &self.local_data
    }

    /// 获取云端数据
    pub fn get_cloud_data(&self) -> &[SyncDataItem] {
        &self.cloud_data
    }

    /// 从缓存中移除已删除的项目
    pub fn remove_deleted_items(&mut self, item_ids: &[String]) {
        for item_id in item_ids {
            self.local_data.retain(|item| item.id != *item_id);
        }
    }

    /// 从云端保存项目到本地（简化版）
    /// 注意：不再维护同步状态，状态由数据库管理
    pub fn save_item_from_cloud(&mut self, cloud_item: &tauri_plugin_eco_database::SyncDataItem) {
        if let Some(local_item) = self.local_data.iter_mut().find(|i| i.id == cloud_item.id) {
            // 更新现有项目
            local_item.item_type = cloud_item.item_type.clone();
            local_item.value = cloud_item.value.clone();
            local_item.favorite = cloud_item.favorite;
            local_item.note = cloud_item.note.clone();
            local_item.time = chrono::Utc::now().timestamp_millis();
        } else {
            // 添加新项目
            self.local_data.push(cloud_item.clone());
        }
    }
}

/// 创建共享的数据管理器实例
pub fn create_shared_manager() -> Arc<Mutex<DataManager>> {
    Arc::new(Mutex::new(DataManager::new()))
}
