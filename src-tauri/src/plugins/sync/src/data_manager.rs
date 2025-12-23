//! 数据管理器模块
//! 负责本地和云端数据的增删改查、状态管理和一致性保证
//! 基于前端经验教训，设计更robust的数据管理策略
//!
//! 前端踩坑经验：
//! 1. 版本升级后同步状态异常，需要自动检测和修复
//! 2. 模式变更（收藏模式、内容类型）需要触发全量同步
//! 3. 严格验证同步状态，防止错误标记
//! 4. 区分原始数据、活跃数据、筛选数据，避免状态混乱
//! 5. 收藏状态变更需要特殊处理
//! 6. 删除流程需要严格验证，确保云端删除成功

use crate::sync_core::{
    SyncDataItem, SyncIndex, SyncModeConfig, StateValidationResult, SyncStatistics, SyncDataStatus,
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

/// 数据管理器（根据优化方案重构）
/// 负责本地和云端数据的统一管理
pub struct DataManager {
    /// 本地数据缓存
    local_data: Vec<SyncDataItem>,
    /// 云端数据缓存
    cloud_data: Vec<SyncDataItem>,
    /// 本地同步状态跟踪（独立于 SyncDataItem）
    /// key: item_id, value: 同步状态
    local_sync_status: HashMap<String, SyncDataStatus>,
    /// 统一的变更跟踪器（根据优化方案）
    /// 当数据发生 [收藏状态变更] [内容变更] [类型变更] [子类型变更] [备注变更] [文件哈希变更] 时设置状态为已变更
    changed_items: HashSet<String>,
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
            local_sync_status: HashMap::new(),
            changed_items: HashSet::new(),
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
    pub fn calculate_statistics(&self) -> SyncStatistics {
        let total_items = self.local_data.len();
        let synced_items = self
            .local_data
            .iter()
            .filter(|item| self.get_item_sync_status(&item.id) == SyncDataStatus::Synced)
            .count();
        let changed_items = self
            .local_data
            .iter()
            .filter(|item| self.get_item_sync_status(&item.id) == SyncDataStatus::Changed)
            .count();
        let unsynced_items = total_items - synced_items - changed_items;

        SyncStatistics {
            total_items,
            synced_items,
            unsynced_items,
            changed_items,
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

    /// 标记项目为已同步
    /// 根据优化方案：同步成功后，自动清理变更记录
    pub fn mark_item_as_synced(&mut self, item_id: &str) {
        self.local_sync_status.insert(item_id.to_string(), SyncDataStatus::Synced);
        // 同步成功后，清理变更记录
        self.changed_items.remove(item_id);
    }

    /// 标记项目为未同步
    pub fn mark_item_as_unsynced(&mut self, item_id: &str) {
        self.local_sync_status.insert(item_id.to_string(), SyncDataStatus::NotSynced);
    }

    /// 标记项目为已变更（统一的变更跟踪器）
    /// 根据优化方案：当数据发生 [收藏状态变更] [内容变更] [类型变更] [子类型变更] [备注变更] [文件哈希变更] 时设置状态为已变更
    pub fn mark_item_as_changed(&mut self, item_id: &str) {
        self.changed_items.insert(item_id.to_string());
        self.local_sync_status.insert(item_id.to_string(), SyncDataStatus::Changed);
    }

    /// 标记项目为已删除
    /// 根据优化方案：从本地数据中移除
    pub fn mark_item_as_deleted(&mut self, item_id: &str) {
        self.local_data.retain(|item| item.id != *item_id);
        // 同时清理状态记录
        self.local_sync_status.remove(item_id);
        self.changed_items.remove(item_id);
    }

    /// 获取已变更的项目ID列表
    /// 这些项目在同步时应该被优先处理
    pub fn get_changed_items(&self) -> Vec<String> {
        self.changed_items.iter().cloned().collect()
    }

    /// 清除变更记录
    /// 通常在同步完成后调用
    pub fn clear_changed_items(&mut self) {
        self.changed_items.clear();
    }

    /// 检查项目是否被标记为已变更
    pub fn is_item_changed(&self, item_id: &str) -> bool {
        self.changed_items.contains(item_id)
    }

    /// 获取项目的同步状态
    pub fn get_item_sync_status(&self, item_id: &str) -> SyncDataStatus {
        self.local_sync_status.get(item_id).cloned().unwrap_or(SyncDataStatus::NotSynced)
    }

    /// 从云端保存项目到本地（简化版）
    /// 根据优化方案：从云端下载的数据天然就是已同步的
    pub fn save_item_from_cloud(&mut self, cloud_item: &tauri_plugin_eco_database::SyncDataItem) {
        if let Some(local_item) = self.local_data.iter_mut().find(|i| i.id == cloud_item.id) {
            // 更新现有项目
            local_item.item_type = cloud_item.item_type.clone();
            local_item.value = cloud_item.value.clone();
            local_item.favorite = cloud_item.favorite;
            local_item.note = cloud_item.note.clone();
            local_item.time = chrono::Utc::now().timestamp_millis();
            // 标记为已同步
            self.local_sync_status.insert(cloud_item.id.clone(), SyncDataStatus::Synced);
            // 清除变更记录
            self.changed_items.remove(&cloud_item.id);
        } else {
            // 添加新项目（天然就是已同步的）
            self.local_data.push(cloud_item.clone());
            self.local_sync_status.insert(cloud_item.id.clone(), SyncDataStatus::Synced);
        }
    }
}

/// 创建共享的数据管理器实例
pub fn create_shared_manager() -> Arc<Mutex<DataManager>> {
    Arc::new(Mutex::new(DataManager::new()))
}
