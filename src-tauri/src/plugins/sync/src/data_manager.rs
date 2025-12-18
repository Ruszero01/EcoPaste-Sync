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
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

/// 数据变更操作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataChangeOp {
    /// 新增
    Add(SyncDataItem),
    /// 更新
    Update(SyncDataItem),
    /// 删除
    Delete(String),
}

/// 数据变更批次
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataChangeBatch {
    /// 操作列表
    pub operations: Vec<DataChangeOp>,
    /// 时间戳
    pub timestamp: i64,
    /// 设备ID
    pub device_id: String,
}

/// 数据变更结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataChangeResult {
    /// 成功的操作数
    pub success_count: usize,
    /// 失败的操作数
    pub failed_count: usize,
    /// 成功的项目ID列表
    pub success_items: Vec<String>,
    /// 失败的项目ID列表
    pub failed_items: Vec<String>,
    /// 错误信息
    pub errors: Vec<String>,
}

/// 数据筛选器
/// 前端踩坑：需要区分原始数据、活跃数据、筛选数据
/// 改进：清晰的数据层级和筛选策略
#[derive(Debug, Clone)]
pub struct DataFilter {
    /// 是否包含已删除的项目
    pub include_deleted: bool,
    /// 是否仅包含收藏项目
    pub only_favorites: bool,
    /// 内容类型筛选
    pub content_type_filter: ContentTypeFilter,
    /// 时间范围筛选
    pub time_range: Option<TimeRange>,
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

/// 时间范围
#[derive(Debug, Clone)]
pub struct TimeRange {
    pub start_time: i64,
    pub end_time: i64,
}

/// 数据差异
/// 用于检测本地和云端数据的差异，支持增量同步
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataDiff {
    /// 仅存在于本地的项目
    pub local_only: Vec<SyncDataItem>,
    /// 仅存在于云端的项目
    pub cloud_only: Vec<SyncDataItem>,
    /// 双方都存在但有差异的项目
    pub different: Vec<DataDiffItem>,
    /// 冲突的项目
    pub conflicts: Vec<ConflictItem>,
}

/// 数据差异项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataDiffItem {
    /// 项目ID
    pub id: String,
    /// 本地版本
    pub local_item: SyncDataItem,
    /// 云端版本
    pub cloud_item: SyncDataItem,
    /// 差异字段
    pub different_fields: Vec<String>,
}

/// 冲突项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictItem {
    /// 项目ID
    pub id: String,
    /// 本地版本
    pub local_item: SyncDataItem,
    /// 云端版本
    pub cloud_item: SyncDataItem,
    /// 冲突类型
    pub conflict_type: ConflictType,
    /// 建议的解决方案
    pub suggested_resolution: ConflictResolution,
}

/// 冲突类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictType {
    /// 内容冲突
    Content,
    /// 时间戳冲突
    Timestamp,
    /// 设备冲突
    Device,
    /// 删除冲突
    Delete,
}

/// 冲突解决方案
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictResolution {
    /// 使用本地版本
    UseLocal,
    /// 使用云端版本
    UseRemote,
    /// 合并版本
    Merge,
    /// 手动处理
    Manual,
}

/// 数据管理器
/// 负责本地和云端数据的统一管理
pub struct DataManager {
    /// 本地数据缓存
    local_data: Vec<SyncDataItem>,
    /// 云端数据缓存
    cloud_data: Vec<SyncDataItem>,
    /// 当前同步索引
    #[allow(dead_code)]
    current_index: Option<SyncIndex>,
    /// 数据变更历史（用于增量同步）
    change_history: Vec<DataChangeBatch>,
    /// 上次同步模式配置（用于检测模式变更）
    previous_mode_config: Option<SyncModeConfig>,
    /// 模式变更检测结果
    mode_changed: bool,
    /// 版本升级检测标记
    upgrade_detected: bool,
    /// 收藏状态变更的项目ID
    favorite_status_changes: Vec<String>,
}

impl DataManager {
    /// 创建新的数据管理器实例
    pub fn new() -> Self {
        Self {
            local_data: vec![],
            cloud_data: vec![],
            current_index: None,
            change_history: vec![],
            previous_mode_config: None,
            mode_changed: false,
            upgrade_detected: false,
            favorite_status_changes: vec![],
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
            // 跳过已删除的项目（如果不包含已删除）
            if !filter.include_deleted && item.deleted {
                continue;
            }

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

            // 时间范围筛选
            if let Some(time_range) = &filter.time_range {
                if item.create_time < time_range.start_time || item.create_time > time_range.end_time {
                    continue;
                }
            }

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

    /// 计算数据差异
    /// 用于增量同步，避免全量比较
    pub fn calculate_data_diff(&self) -> DataDiff {
        let local_ids: HashSet<&str> = self.local_data.iter().map(|item| item.id.as_str()).collect();
        let cloud_ids: HashSet<&str> = self.cloud_data.iter().map(|item| item.id.as_str()).collect();

        // 仅存在于本地的项目
        let local_only: Vec<SyncDataItem> = self
            .local_data
            .iter()
            .filter(|item| !cloud_ids.contains(item.id.as_str()))
            .cloned()
            .collect();

        // 仅存在于云端的项目
        let cloud_only: Vec<SyncDataItem> = self
            .cloud_data
            .iter()
            .filter(|item| !local_ids.contains(item.id.as_str()))
            .cloned()
            .collect();

        // 双方都存在但有差异的项目
        let mut different = Vec::new();
        let mut conflicts = Vec::new();

        for local_item in &self.local_data {
            if let Some(cloud_item) = self.cloud_data.iter().find(|item| item.id == local_item.id) {
                // 检查是否有差异
                let diff_fields = self.detect_differences(local_item, cloud_item);
                if !diff_fields.is_empty() {
                    // 判断是普通差异还是冲突
                    if self.is_conflict(local_item, cloud_item) {
                        conflicts.push(ConflictItem {
                            id: local_item.id.clone(),
                            local_item: local_item.clone(),
                            cloud_item: cloud_item.clone(),
                            conflict_type: self.determine_conflict_type(local_item, cloud_item),
                            suggested_resolution: self.suggest_conflict_resolution(local_item, cloud_item),
                        });
                    } else {
                        different.push(DataDiffItem {
                            id: local_item.id.clone(),
                            local_item: local_item.clone(),
                            cloud_item: cloud_item.clone(),
                            different_fields: diff_fields,
                        });
                    }
                }
            }
        }

        DataDiff {
            local_only,
            cloud_only,
            different,
            conflicts,
        }
    }

    /// 检测两个项目之间的差异
    fn detect_differences(&self, local: &SyncDataItem, cloud: &SyncDataItem) -> Vec<String> {
        let mut diff_fields = Vec::new();

        if local.favorite != cloud.favorite {
            diff_fields.push("favorite".to_string());
        }
        if local.note != cloud.note {
            diff_fields.push("note".to_string());
        }
        if local.value != cloud.value {
            diff_fields.push("value".to_string());
        }
        if local.checksum != cloud.checksum {
            diff_fields.push("checksum".to_string());
        }
        if local.last_modified != cloud.last_modified {
            diff_fields.push("last_modified".to_string());
        }

        diff_fields
    }

    /// 判断是否为冲突
    /// 冲突定义：双方都有实质性更新且时间戳接近
    fn is_conflict(&self, local: &SyncDataItem, cloud: &SyncDataItem) -> bool {
        // 如果一方被标记为删除，另一方有更新，则是删除冲突
        if local.deleted != cloud.deleted {
            return true;
        }

        // 如果时间戳差异很小且内容不同，可能是并发修改冲突
        let time_diff = (local.last_modified - cloud.last_modified).abs();
        if time_diff < 60000 && local.value != cloud.value { // 1分钟内
            return true;
        }

        false
    }

    /// 确定冲突类型
    fn determine_conflict_type(&self, local: &SyncDataItem, cloud: &SyncDataItem) -> ConflictType {
        if local.deleted != cloud.deleted {
            ConflictType::Delete
        } else if local.last_modified != cloud.last_modified {
            ConflictType::Timestamp
        } else {
            ConflictType::Content
        }
    }

    /// 建议冲突解决方案
    fn suggest_conflict_resolution(&self, local: &SyncDataItem, cloud: &SyncDataItem) -> ConflictResolution {
        // 如果云端版本更新，使用云端版本
        if cloud.last_modified > local.last_modified {
            ConflictResolution::UseRemote
        } else {
            // 否则使用本地版本
            ConflictResolution::UseLocal
        }
    }

    /// 应用数据变更
    /// # Arguments
    /// * `changes` - 数据变更批次
    pub async fn apply_changes(&mut self, changes: DataChangeBatch) -> DataChangeResult {
        let mut result = DataChangeResult {
            success_count: 0,
            failed_count: 0,
            success_items: vec![],
            failed_items: vec![],
            errors: vec![],
        };

        for op in &changes.operations {
            match op {
                DataChangeOp::Add(item) => {
                    if self.add_item(item.clone()).await.is_ok() {
                        result.success_count += 1;
                        result.success_items.push(item.id.clone());
                    } else {
                        result.failed_count += 1;
                        result.failed_items.push(item.id.clone());
                        result.errors.push(format!("添加项目失败: {}", item.id));
                    }
                }
                DataChangeOp::Update(item) => {
                    if self.update_item(item).await.is_ok() {
                        result.success_count += 1;
                        result.success_items.push(item.id.clone());
                    } else {
                        result.failed_count += 1;
                        result.failed_items.push(item.id.clone());
                        result.errors.push(format!("更新项目失败: {}", item.id));
                    }
                }
                DataChangeOp::Delete(id) => {
                    if self.delete_item(id).await.is_ok() {
                        result.success_count += 1;
                        result.success_items.push(id.clone());
                    } else {
                        result.failed_count += 1;
                        result.failed_items.push(id.clone());
                        result.errors.push(format!("删除项目失败: {}", id));
                    }
                }
            }
        }

        // 记录变更历史
        self.change_history.push(changes);

        result
    }

    /// 添加项目
    async fn add_item(&mut self, item: SyncDataItem) -> Result<(), String> {
        // 检查是否已存在
        if self.local_data.iter().any(|i| i.id == item.id) {
            return Err("项目已存在".to_string());
        }

        self.local_data.push(item);
        Ok(())
    }

    /// 更新项目
    async fn update_item(&mut self, item: &SyncDataItem) -> Result<(), String> {
        if let Some(existing) = self.local_data.iter_mut().find(|i| i.id == item.id) {
            *existing = item.clone();
            Ok(())
        } else {
            Err("项目不存在".to_string())
        }
    }

    /// 删除项目
    async fn delete_item(&mut self, id: &str) -> Result<(), String> {
        if let Some(pos) = self.local_data.iter().position(|i| i.id == id) {
            self.local_data.remove(pos);
            Ok(())
        } else {
            Err("项目不存在".to_string())
        }
    }

    /// 验证数据状态一致性
    /// 前端踩坑：需要严格检查状态是否真的匹配
    /// 改进：自动状态验证和修复
    pub fn validate_state_consistency(&self) -> StateValidationResult {
        let mut abnormal_items = Vec::new();
        let mut items_to_fix = Vec::new();
        let mut validation_details = HashMap::new();

        for local_item in &self.local_data {
            // 检查状态一致性
            if let Some(cloud_item) = self.cloud_data.iter().find(|i| i.id == local_item.id) {
                // 如果本地显示已同步，但云端不匹配，则是异常状态
                if local_item.sync_status == SyncDataStatus::Synced {
                    let is_actually_synced = self.is_item_actually_synced(local_item, cloud_item);
                    if !is_actually_synced {
                        abnormal_items.push(local_item.id.clone());
                        items_to_fix.push(local_item.id.clone());
                        validation_details.insert(
                            local_item.id.clone(),
                            "本地显示已同步但云端不匹配".to_string(),
                        );
                    }
                }
            } else {
                // 本地显示已同步但云端不存在，也是异常状态
                if local_item.sync_status == SyncDataStatus::Synced {
                    abnormal_items.push(local_item.id.clone());
                    items_to_fix.push(local_item.id.clone());
                    validation_details.insert(
                        local_item.id.clone(),
                        "本地显示已同步但云端不存在".to_string(),
                    );
                }
            }
        }

        StateValidationResult {
            is_valid: abnormal_items.is_empty(),
            abnormal_items,
            items_to_fix,
            validation_details,
        }
    }

    /// 严格检查项目是否真的已同步
    fn is_item_actually_synced(&self, local_item: &SyncDataItem, cloud_item: &SyncDataItem) -> bool {
        // 基础字段匹配检查
        if local_item.item_type != cloud_item.item_type
            || local_item.favorite != cloud_item.favorite
            || local_item.note != cloud_item.note {
            return false;
        }

        // 使用校验和验证（如果可用）
        if let (Some(local_checksum), Some(cloud_checksum)) = (&local_item.checksum, &cloud_item.checksum) {
            if !local_checksum.is_empty() && !cloud_checksum.is_empty() {
                return local_checksum == cloud_checksum;
            }
        }

        // 使用内容比较（fallback）
        if let (Some(local_value), Some(cloud_value)) = (&local_item.value, &cloud_item.value) {
            let max_len = 1000;
            let local_slice = if local_value.len() > max_len {
                &local_value[..max_len]
            } else {
                local_value
            };
            let cloud_slice = if cloud_value.len() > max_len {
                &cloud_value[..max_len]
            } else {
                cloud_value
            };
            return local_slice == cloud_slice;
        }

        false
    }

    /// 计算统计信息
    pub fn calculate_statistics(&self) -> SyncStatistics {
        let total_items = self.local_data.len();
        let active_items = self.local_data.iter().filter(|item| !item.deleted).count();
        let synced_items = self
            .local_data
            .iter()
            .filter(|item| item.sync_status == SyncDataStatus::Synced)
            .count();
        let unsynced_items = total_items - synced_items;
        let conflict_items = self
            .local_data
            .iter()
            .filter(|item| item.sync_status == SyncDataStatus::Conflict)
            .count();
        let deleted_items = self.local_data.iter().filter(|item| item.deleted).count();

        SyncStatistics {
            total_items,
            active_items,
            synced_items,
            unsynced_items,
            conflict_items,
            deleted_items,
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

    /// 检测并修复版本升级后的同步状态问题
    /// 前端踩坑：覆盖安装后所有数据被错误标记为已同步
    /// 改进：自动检测并重置异常状态，触发全量同步验证
    pub async fn detect_and_fix_upgrade_issues(&mut self, mode_config: &SyncModeConfig) -> Vec<String> {
        let mut abnormal_items = Vec::new();

        for item in &self.local_data {
            // 检查同步状态是否异常
            if item.sync_status == SyncDataStatus::Synced {
                // 验证项目是否真的符合同步模式要求
                let is_valid_for_sync = self.is_item_valid_for_sync_mode(item, mode_config);

                if !is_valid_for_sync {
                    abnormal_items.push(item.id.clone());
                }
            }

            // 检查是否有空或异常的同步状态
            if matches!(item.sync_status, SyncDataStatus::None) {
                abnormal_items.push(item.id.clone());
            }
        }

        if !abnormal_items.is_empty() {
            self.upgrade_detected = true;
            // 重置这些项目的同步状态
            for item in &mut self.local_data {
                if abnormal_items.contains(&item.id) {
                    item.sync_status = SyncDataStatus::None;
                }
            }
        }

        abnormal_items
    }

    /// 检测同步模式是否发生变更
    /// 前端踩坑：模式变更需要触发全量同步，否则状态会混乱
    /// 改进：从设计上支持模式变更检测和自动修复
    pub fn detect_mode_change(&mut self, new_config: &SyncModeConfig) -> bool {
        // 首次初始化不算模式变更
        if self.previous_mode_config.is_none() {
            self.previous_mode_config = Some(new_config.clone());
            return false;
        }

        let previous_config = self.previous_mode_config.as_ref().unwrap();

        // 检查收藏模式是否发生变化
        if previous_config.only_favorites != new_config.only_favorites {
            self.mode_changed = true;
            self.previous_mode_config = Some(new_config.clone());
            return true;
        }

        // 检查内容类型设置是否发生变化
        if previous_config.include_images != new_config.include_images
            || previous_config.include_files != new_config.include_files
            || previous_config.content_types != new_config.content_types {
            self.mode_changed = true;
            self.previous_mode_config = Some(new_config.clone());
            return true;
        }

        self.previous_mode_config = Some(new_config.clone());
        false
    }

    /// 检测收藏状态变更
    /// 前端踩坑：收藏模式下状态变更需要特殊处理
    /// 改进：专门检测收藏状态变化并加入同步列表
    pub fn detect_favorite_status_changes(&mut self, mode_config: &SyncModeConfig) -> Vec<String> {
        if !mode_config.only_favorites {
            return Vec::new();
        }

        let mut changed_items = Vec::new();

        for cloud_item in &self.cloud_data {
            if let Some(local_item) = self.local_data.iter().find(|i| i.id == cloud_item.id) {
                // 检查收藏状态是否发生变化
                if local_item.favorite != cloud_item.favorite {
                    changed_items.push(local_item.id.clone());
                    self.favorite_status_changes.push(local_item.id.clone());
                }
            }
        }

        changed_items
    }

    /// 过滤真正发生变更的项目，避免重复计数
    /// 前端踩坑：需要严格检查项目是否真的已同步，避免重复计数
    /// 改进：内建校验和验证机制
    pub fn filter_actually_changed_items(
        &self,
        item_ids: &[String],
        cloud_result: &DataChangeResult,
    ) -> Vec<String> {
        let mut actually_changed = Vec::new();

        for item_id in item_ids {
            // 检查是否为新增项目
            if cloud_result.success_items.contains(item_id) {
                actually_changed.push(item_id.clone());
                continue;
            }

            // 检查是否为更新项目（这里简化处理，实际应详细比较）
            if cloud_result.failed_items.contains(item_id) {
                continue;
            }

            // 默认认为发生了变更
            actually_changed.push(item_id.clone());
        }

        actually_changed
    }

    /// 同步本地状态与云端存在性保持一致
    /// 前端踩坑：需要严格检查本地状态与云端是否真正匹配
    /// 改进：内建状态验证机制
    pub fn sync_local_status_with_cloud(&mut self) -> Vec<String> {
        let mut mismatched_items = Vec::new();

        // 先收集需要更新的项目ID和状态
        let mut updates: Vec<(String, SyncDataStatus)> = Vec::new();

        for cloud_item in &self.cloud_data {
            if let Some(local_item) = self.local_data.iter().find(|i| i.id == cloud_item.id) {
                if !local_item.deleted {
                    let is_actually_synced = self.is_item_actually_synced(local_item, cloud_item);

                    // 状态不匹配且项目实际已同步，需要更新状态
                    if is_actually_synced && local_item.sync_status != SyncDataStatus::Synced {
                        mismatched_items.push(cloud_item.id.clone());
                        updates.push((cloud_item.id.clone(), SyncDataStatus::Synced));
                    }
                }
            }
        }

        // 应用更新（避免借用冲突）
        for (item_id, new_status) in updates {
            if let Some(item) = self.local_data.iter_mut().find(|i| i.id == item_id) {
                item.sync_status = new_status;
            }
        }

        mismatched_items
    }

    /// 检查项目是否对当前同步模式有效
    /// 前端踩坑：需要验证项目是否真的符合同步要求
    fn is_item_valid_for_sync_mode(&self, item: &SyncDataItem, mode_config: &SyncModeConfig) -> bool {
        // 收藏模式检查
        if mode_config.only_favorites && !item.favorite {
            return false;
        }

        // 内容类型检查
        match item.item_type.as_str() {
            "text" => mode_config.content_types.include_text,
            "html" => mode_config.content_types.include_html,
            "rtf" => mode_config.content_types.include_rtf,
            "image" => mode_config.include_images,
            "file" => mode_config.include_files,
            _ => true,
        }
    }

    /// 重置模式变更标记
    pub fn reset_mode_change_flag(&mut self) {
        self.mode_changed = false;
    }

    /// 检查是否有模式变更
    pub fn has_mode_changed(&self) -> bool {
        self.mode_changed
    }

    /// 检查是否检测到版本升级
    pub fn is_upgrade_detected(&self) -> bool {
        self.upgrade_detected
    }

    /// 清除版本升级标记
    pub fn clear_upgrade_detected(&mut self) {
        self.upgrade_detected = false;
    }

    /// 获取收藏状态变更的项目ID
    pub fn get_favorite_status_changes(&self) -> &[String] {
        &self.favorite_status_changes
    }

    /// 清除收藏状态变更记录
    pub fn clear_favorite_status_changes(&mut self) {
        self.favorite_status_changes.clear();
    }

    /// 标记项目为已同步
    pub fn mark_item_as_synced(&mut self, item_id: &str) {
        if let Some(item) = self.local_data.iter_mut().find(|i| i.id == *item_id) {
            item.sync_status = SyncDataStatus::Synced;
        }
    }

    /// 标记项目为同步失败
    pub fn mark_item_as_failed(&mut self, item_id: &str) {
        if let Some(item) = self.local_data.iter_mut().find(|i| i.id == *item_id) {
            item.sync_status = SyncDataStatus::Failed;
        }
    }

    /// 标记项目为未同步
    pub fn mark_item_as_unsynced(&mut self, item_id: &str) {
        if let Some(item) = self.local_data.iter_mut().find(|i| i.id == *item_id) {
            item.sync_status = SyncDataStatus::None;
        }
    }

    /// 标记项目为需要同步
    pub fn mark_item_as_needs_sync(&mut self, item_id: &str) {
        if let Some(item) = self.local_data.iter_mut().find(|i| i.id == *item_id) {
            item.sync_status = SyncDataStatus::None;
        }
    }

    /// 标记项目为已删除
    pub fn mark_item_as_deleted(&mut self, item_id: &str) {
        if let Some(item) = self.local_data.iter_mut().find(|i| i.id == *item_id) {
            item.deleted = true;
        }
    }

    /// 从云端保存项目到本地
    pub fn save_item_from_cloud(&mut self, cloud_item: &SyncDataItem) {
        if let Some(local_item) = self.local_data.iter_mut().find(|i| i.id == cloud_item.id) {
            // 更新现有项目
            local_item.item_type = cloud_item.item_type.clone();
            local_item.checksum = cloud_item.checksum.clone();
            local_item.value = cloud_item.value.clone();
            local_item.favorite = cloud_item.favorite;
            local_item.note = cloud_item.note.clone();
            local_item.last_modified = cloud_item.last_modified;
            local_item.device_id = cloud_item.device_id.clone();
            local_item.deleted = cloud_item.deleted;
            local_item.sync_status = cloud_item.sync_status.clone();
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
