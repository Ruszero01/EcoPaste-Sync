//! 同步核心模块
//! 基于前端云同步引擎的经验教训，设计更robust的同步架构
//! 规避前端实现中踩的坑，从底层设计上保证状态一致性

use crate::types::*;
use crate::webdav::WebDAVClientState;
use crate::data_manager::DataManager;
use crate::file_sync_manager::FileSyncManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use md5;

/// 同步模式配置
/// 前端踩坑：模式变更需要触发全量同步，否则状态会混乱
/// 改进：从设计上支持模式变更检测和自动修复
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncModeConfig {
    /// 是否启用自动同步
    pub auto_sync: bool,
    /// 自动同步间隔（分钟）
    pub auto_sync_interval_minutes: u64,
    /// 是否仅同步收藏项目
    pub only_favorites: bool,
    /// 是否包含图片
    pub include_images: bool,
    /// 是否包含文件
    pub include_files: bool,
    /// 内容类型设置
    pub content_types: ContentTypeConfig,
    /// 冲突解决策略
    pub conflict_resolution: ConflictResolutionStrategy,
    /// 设备ID（用于标识数据来源）
    pub device_id: String,
    /// 上次模式配置（用于检测变更）
    pub previous_mode: Option<Box<SyncModeConfig>>,
}

/// 内容类型配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentTypeConfig {
    pub include_text: bool,
    pub include_html: bool,
    pub include_rtf: bool,
}

/// 冲突解决策略
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConflictResolutionStrategy {
    /// 本地优先
    Local,
    /// 云端优先
    Remote,
    /// 智能合并
    Merge,
    /// 手动干预
    Manual,
}

/// 同步数据项
/// 前端踩坑：需要严格检查项目是否真的已同步，避免重复计数
/// 改进：内建校验和验证机制
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDataItem {
    /// 项目ID
    pub id: String,
    /// 项目类型
    pub item_type: String,
    /// 内容校验和（用于严格验证是否真的匹配）
    pub checksum: Option<String>,
    /// 内容值
    pub value: Option<String>,
    /// 是否收藏
    pub favorite: bool,
    /// 备注
    pub note: Option<String>,
    /// 创建时间
    pub create_time: i64,
    /// 最后修改时间
    pub last_modified: i64,
    /// 设备ID
    pub device_id: String,
    /// 同步状态
    pub sync_status: SyncDataStatus,
    /// 是否已删除
    pub deleted: bool,
}

/// 同步数据状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncDataStatus {
    /// 未同步
    None,
    /// 正在同步
    Syncing,
    /// 已同步
    Synced,
    /// 同步失败
    Failed,
    /// 冲突
    Conflict,
}

/// 同步索引
/// 前端踩坑：需要区分原始数据和筛选后数据，避免状态混乱
/// 改进：清晰的数据层级划分
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncIndex {
    /// 格式版本
    pub format_version: String,
    /// 设备ID
    pub device_id: String,
    /// 时间戳
    pub timestamp: i64,
    /// 最后同步时间
    pub last_sync_time: i64,
    /// 同步模式配置
    pub sync_mode: SyncModeConfig,
    /// 原始数据（包含已删除的项目）
    pub raw_data: Vec<SyncDataItem>,
    /// 活跃数据（未删除的项目）
    pub active_data: Vec<SyncDataItem>,
    /// 筛选后的同步数据（根据当前模式）
    pub filtered_data: Vec<SyncDataItem>,
    /// 数据校验和（用于验证数据完整性）
    pub data_checksum: Option<String>,
    /// 统计信息
    pub statistics: SyncStatistics,
}

/// 同步统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatistics {
    /// 总项目数
    pub total_items: usize,
    /// 活跃项目数
    pub active_items: usize,
    /// 已同步项目数
    pub synced_items: usize,
    /// 未同步项目数
    pub unsynced_items: usize,
    /// 冲突项目数
    pub conflict_items: usize,
    /// 已删除项目数
    pub deleted_items: usize,
}

/// 同步结果
/// 前端踩坑：需要区分上传、下载、删除、冲突等不同类型的结果
/// 改进：详细的分类统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProcessResult {
    /// 是否成功
    pub success: bool,
    /// 上传的项目ID列表
    pub uploaded_items: Vec<String>,
    /// 下载的项目ID列表
    pub downloaded_items: Vec<String>,
    /// 删除的项目ID列表
    pub deleted_items: Vec<String>,
    /// 冲突的项目ID列表
    pub conflict_items: Vec<String>,
    /// 错误信息
    pub errors: Vec<String>,
    /// 耗时（毫秒）
    pub duration_ms: u64,
    /// 时间戳
    pub timestamp: i64,
    /// 实际变更的项目（避免重复计数）
    pub actually_changed_items: Vec<String>,
}

/// 状态验证结果
/// 前端踩坑：需要严格检查本地状态与云端是否真正匹配
/// 改进：内建状态验证机制
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateValidationResult {
    /// 是否通过验证
    pub is_valid: bool,
    /// 异常的项目ID列表
    pub abnormal_items: Vec<String>,
    /// 需要修复的项目ID列表
    pub items_to_fix: Vec<String>,
    /// 验证详情
    pub validation_details: HashMap<String, String>,
}

/// 同步核心引擎
/// 专注于核心同步逻辑，内建状态验证和错误修复机制
/// 规避前端实现中的常见问题
pub struct SyncCore {
    /// WebDAV 客户端
    webdav_client: WebDAVClientState,
    /// 数据管理器
    data_manager: Arc<Mutex<DataManager>>,
    /// 文件同步管理器（保留用于未来扩展）
    #[allow(dead_code)]
    file_sync_manager: Arc<Mutex<FileSyncManager>>,
    /// 当前同步索引
    current_index: Option<SyncIndex>,
    /// 上次同步的索引（用于增量同步）
    previous_index: Option<SyncIndex>,
    /// 是否正在同步
    sync_in_progress: bool,
    /// 同步进度回调
    progress_callback: Option<Box<dyn Fn(f64) + Send + Sync>>,
    /// 错误回调
    error_callback: Option<Box<dyn Fn(String) + Send + Sync>>,
}

impl SyncCore {
    /// 创建新的同步核心实例
    pub fn new(
        webdav_client: WebDAVClientState,
        data_manager: Arc<Mutex<DataManager>>,
        file_sync_manager: Arc<Mutex<FileSyncManager>>,
    ) -> Self {
        Self {
            webdav_client,
            data_manager,
            file_sync_manager,
            current_index: None,
            previous_index: None,
            sync_in_progress: false,
            progress_callback: None,
            error_callback: None,
        }
    }

    /// 设置进度回调函数
    /// # Arguments
    /// * `callback` - 进度回调函数，参数为进度百分比（0.0-1.0）
    pub fn set_progress_callback(&mut self, callback: Box<dyn Fn(f64) + Send + Sync>) {
        self.progress_callback = Some(callback);
    }

    /// 设置错误回调函数
    /// # Arguments
    /// * `callback` - 错误回调函数，参数为错误信息
    pub fn set_error_callback(&mut self, callback: Box<dyn Fn(String) + Send + Sync>) {
        self.error_callback = Some(callback);
    }

    /// 执行双向同步
    /// 前端踩坑：流程复杂，容易遗漏步骤
    /// 改进：结构化的同步流程，每步都有明确的进度反馈
    pub async fn perform_sync(&mut self, mode_config: SyncModeConfig) -> Result<SyncProcessResult, String> {
        if self.sync_in_progress {
            return Err("同步正在进行中".to_string());
        }

        self.sync_in_progress = true;
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        let mut result = SyncProcessResult {
            success: false,
            uploaded_items: vec![],
            downloaded_items: vec![],
            deleted_items: vec![],
            conflict_items: vec![],
            errors: vec![],
            duration_ms: 0,
            timestamp: start_time,
            actually_changed_items: vec![],
        };

        // 1. 加载本地数据 (10%)
        self.update_progress(0.1);
        let local_data = self.load_local_data().await.map_err(|e| {
            self.report_error(format!("加载本地数据失败: {}", e));
            e
        })?;

        // 2. 加载云端数据 (20%)
        self.update_progress(0.2);
        let cloud_data = self.load_cloud_data().await.map_err(|e| {
            self.report_error(format!("加载云端数据失败: {}", e));
            e
        })?;

        // 3. 检测模式变更 (30%)
        self.update_progress(0.3);
        let mut data_manager = self.data_manager.lock().await;
        let mode_changed = data_manager.detect_mode_change(&mode_config);
        if mode_changed {
            data_manager.reset_mode_change_flag();
            result.conflict_items.push("模式变更检测".to_string());
        }

        // 4. 检测版本升级问题 (35%)
        self.update_progress(0.35);
        let abnormal_items = data_manager.detect_and_fix_upgrade_issues(&mode_config).await;
        if !abnormal_items.is_empty() {
            result.conflict_items.extend(abnormal_items.iter().cloned());
        }

        // 5. 检测收藏状态变更 (40%)
        self.update_progress(0.4);
        let favorite_changes = data_manager.detect_favorite_status_changes(&mode_config);
        result.actually_changed_items.extend(favorite_changes);

        // 清理收藏状态变更记录
        data_manager.clear_favorite_status_changes();

        drop(data_manager);

        // 6. 数据筛选和验证 (50%)
        self.update_progress(0.5);
        let filtered_local = self.filter_data_for_sync(&local_data, &mode_config);
        let filtered_cloud = self.filter_data_for_sync(&cloud_data, &mode_config);

        // 7. 冲突检测和解决 (60%)
        self.update_progress(0.6);
        let conflicts = self.detect_and_resolve_conflicts(&filtered_local, &filtered_cloud).await;
        result.conflict_items.extend(conflicts);

        // 8. 执行同步操作 - 上传本地新增/更新 (70%)
        self.update_progress(0.7);
        let (items_to_upload, items_to_download, items_to_delete) =
            self.calculate_sync_operations(&filtered_local, &filtered_cloud).await;

        // 上传本地变更
        if !items_to_upload.is_empty() {
            match self.upload_local_changes(&items_to_upload).await {
                Ok(upload_result) => {
                    result.uploaded_items.extend(upload_result);
                }
                Err(e) => {
                    result.errors.push(format!("上传失败: {}", e));
                }
            }
        }

        // 9. 执行同步操作 - 下载云端新增/更新 (80%)
        self.update_progress(0.8);
        if !items_to_download.is_empty() {
            match self.download_cloud_changes(&items_to_download).await {
                Ok(download_result) => {
                    result.downloaded_items.extend(download_result);
                }
                Err(e) => {
                    result.errors.push(format!("下载失败: {}", e));
                }
            }
        }

        // 10. 处理删除操作 (85%)
        self.update_progress(0.85);
        if !items_to_delete.is_empty() {
            match self.process_deletions(&items_to_delete).await {
                Ok(delete_result) => {
                    result.deleted_items.extend(delete_result);
                }
                Err(e) => {
                    result.errors.push(format!("删除失败: {}", e));
                }
            }
        }

        // 11. 状态一致性验证和修复 (90%)
        self.update_progress(0.9);
        let validation_result = self.validate_and_fix_state().await?;
        let abnormal_items = validation_result.abnormal_items.clone();
        if !validation_result.is_valid {
            self.fix_abnormal_state(validation_result).await?;
        }

        // 12. 更新索引和清理 (100%)
        self.update_progress(1.0);
        self.update_sync_index(&mode_config).await?;

        result.conflict_items.extend(abnormal_items);

        let end_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        result.success = result.errors.is_empty();
        result.duration_ms = (end_time - start_time) as u64;

        self.sync_in_progress = false;
        Ok(result)
    }

    /// 验证和修复状态
    /// 前端踩坑：需要严格检查本地状态与云端是否真正匹配
    /// 改进：内建状态验证机制
    async fn validate_and_fix_state(&self) -> Result<StateValidationResult, String> {
        let data_manager = self.data_manager.lock().await;
        let local_data = data_manager.get_local_data();
        let cloud_data = data_manager.get_cloud_data();

        let mut abnormal_items = Vec::new();
        let mut items_to_fix = Vec::new();
        let mut validation_details = HashMap::new();

        // 1. 检查本地项目是否真的与云端匹配
        for local_item in local_data {
            if let Some(cloud_item) = cloud_data.iter().find(|i| i.id == local_item.id) {
                let is_synced = self.is_item_actually_synced(local_item, cloud_item);

                // 检查状态一致性
                if is_synced && local_item.sync_status != SyncDataStatus::Synced {
                    abnormal_items.push(local_item.id.clone());
                    items_to_fix.push(local_item.id.clone());
                    validation_details.insert(
                        local_item.id.clone(),
                        format!("状态不一致：本地={:?}, 云端=Synced", local_item.sync_status)
                    );
                } else if !is_synced && local_item.sync_status == SyncDataStatus::Synced {
                    abnormal_items.push(local_item.id.clone());
                    items_to_fix.push(local_item.id.clone());
                    validation_details.insert(
                        local_item.id.clone(),
                        format!("状态不一致：本地=Synced, 云端=未同步")
                    );
                }
            }
        }

        // 2. 验证校验和
        for item in local_data {
            if let Some(cloud_item) = cloud_data.iter().find(|i| i.id == item.id) {
                if let (Some(local_checksum), Some(cloud_checksum)) = (&item.checksum, &cloud_item.checksum) {
                    if !local_checksum.is_empty() && !cloud_checksum.is_empty() && local_checksum != cloud_checksum {
                        abnormal_items.push(item.id.clone());
                        items_to_fix.push(item.id.clone());
                        validation_details.insert(
                            item.id.clone(),
                            "校验和不匹配".to_string()
                        );
                    }
                }
            }
        }

        // 3. 检查状态一致性
        // 4. 生成修复建议
        let is_valid = abnormal_items.is_empty();

        Ok(StateValidationResult {
            is_valid,
            abnormal_items,
            items_to_fix,
            validation_details,
        })
    }

    /// 修复异常状态
    /// 前端踩坑：状态不一致时需要批量修复
    /// 改进：自动状态修复机制
    async fn fix_abnormal_state(&mut self, validation_result: StateValidationResult) -> Result<(), String> {
        if validation_result.items_to_fix.is_empty() {
            return Ok(());
        }

        // 1. 批量更新异常项目状态
        let data_manager = self.data_manager.clone();
        let mut manager = data_manager.lock().await;

        // 修复每个异常项目
        for item_id in &validation_result.items_to_fix {
            // 根据验证详情确定正确的状态
            if let Some(detail) = validation_result.validation_details.get(item_id) {
                if detail.contains("本地=Synced, 云端=未同步") {
                    // 本地状态错误，需要重置为未同步
                    manager.mark_item_as_unsynced(item_id);
                } else if detail.contains("本地=未同步") {
                    // 标记为已同步
                    manager.mark_item_as_synced(item_id);
                } else if detail.contains("校验和不匹配") {
                    // 校验和不匹配，重新上传
                    manager.mark_item_as_needs_sync(item_id);
                }
            }
        }

        // 2. 重新验证修复结果
        let fix_result = self.validate_and_fix_state().await?;
        if !fix_result.is_valid && !fix_result.abnormal_items.is_empty() {
            // 修复失败，记录错误
            self.report_error(format!("状态修复失败，仍有 {} 项异常", fix_result.abnormal_items.len()));
        }

        // 3. 记录修复日志
        println!("已修复 {} 项异常状态", validation_result.items_to_fix.len());

        Ok(())
    }

    /// 严格检查项目是否真的已同步
    /// 前端踩坑：需要使用校验和或内容比较来验证
    /// 改进：内建严格验证机制
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
            // 对于长内容，只比较前1000字符以提高性能
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

    /// 更新进度
    fn update_progress(&self, progress: f64) {
        if let Some(callback) = &self.progress_callback {
            callback(progress);
        }
    }

    /// 报告错误
    fn report_error(&self, error: String) {
        if let Some(callback) = &self.error_callback {
            callback(error);
        }
    }

    /// 获取当前同步索引
    pub fn get_current_index(&self) -> Option<&SyncIndex> {
        self.current_index.as_ref()
    }

    /// 获取同步状态
    pub fn get_sync_status(&self) -> SyncStatus {
        if self.sync_in_progress {
            SyncStatus::Syncing
        } else {
            SyncStatus::Idle
        }
    }

    /// 停止同步
    pub async fn stop_sync(&mut self) -> Result<(), String> {
        self.sync_in_progress = false;
        Ok(())
    }

    /// 加载本地数据
    async fn load_local_data(&self) -> Result<Vec<SyncDataItem>, String> {
        let data_manager = self.data_manager.lock().await;
        Ok(data_manager.get_local_data().to_vec())
    }

    /// 加载云端数据
    async fn load_cloud_data(&self) -> Result<Vec<SyncDataItem>, String> {
        let data_manager = self.data_manager.lock().await;
        Ok(data_manager.get_cloud_data().to_vec())
    }

    /// 根据同步模式筛选数据
    fn filter_data_for_sync(&self, data: &[SyncDataItem], mode_config: &SyncModeConfig) -> Vec<SyncDataItem> {
        data.iter()
            .filter(|item| {
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
                    "files" => mode_config.include_files,
                    _ => true,
                }
            })
            .cloned()
            .collect()
    }

    /// 检测和解决冲突
    async fn detect_and_resolve_conflicts(&self, local_data: &[SyncDataItem], cloud_data: &[SyncDataItem]) -> Vec<String> {
        let mut conflicts = Vec::new();

        // 构建云端数据的索引
        let cloud_index: HashMap<String, &SyncDataItem> = cloud_data
            .iter()
            .map(|item| (item.id.clone(), item))
            .collect();

        for local_item in local_data {
            if let Some(cloud_item) = cloud_index.get(&local_item.id) {
                // 检查是否发生冲突
                if self.is_conflict(local_item, cloud_item) {
                    conflicts.push(local_item.id.clone());
                }
            }
        }

        conflicts
    }

    /// 检查是否为冲突
    fn is_conflict(&self, local_item: &SyncDataItem, cloud_item: &SyncDataItem) -> bool {
        // 检查修改时间
        if local_item.last_modified > cloud_item.last_modified {
            // 本地更新更新
            return false;
        }

        // 检查内容是否不同
        if let (Some(local_value), Some(cloud_value)) = (&local_item.value, &cloud_item.value) {
            if local_value != cloud_value {
                return true;
            }
        }

        false
    }

    /// 计算同步操作
    async fn calculate_sync_operations(
        &self,
        local_data: &[SyncDataItem],
        cloud_data: &[SyncDataItem],
    ) -> (Vec<String>, Vec<String>, Vec<String>) {
        let mut items_to_upload = Vec::new();
        let mut items_to_download = Vec::new();
        let mut items_to_delete = Vec::new();

        // 构建索引
        let local_index: HashMap<String, &SyncDataItem> = local_data
            .iter()
            .map(|item| (item.id.clone(), item))
            .collect();

        let cloud_index: HashMap<String, &SyncDataItem> = cloud_data
            .iter()
            .map(|item| (item.id.clone(), item))
            .collect();

        // 查找本地新增或更新的项目（需要上传）
        for (id, local_item) in &local_index {
            if let Some(cloud_item) = cloud_index.get(id) {
                if local_item.last_modified > cloud_item.last_modified {
                    items_to_upload.push(id.clone());
                }
            } else {
                // 本地新增
                items_to_upload.push(id.clone());
            }
        }

        // 查找云端新增或更新的项目（需要下载）
        for (id, cloud_item) in &cloud_index {
            if let Some(local_item) = local_index.get(id) {
                if cloud_item.last_modified > local_item.last_modified {
                    items_to_download.push(id.clone());
                }
            } else {
                // 云端新增
                items_to_download.push(id.clone());
            }
        }

        // 查找需要删除的项目
        for id in local_index.keys() {
            if !cloud_index.contains_key(id) {
                items_to_delete.push(id.clone());
            }
        }

        (items_to_upload, items_to_download, items_to_delete)
    }

    /// 上传本地变更
    async fn upload_local_changes(&self, items: &[String]) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        let mut uploaded_items = Vec::new();
        let webdav_client = self.webdav_client.clone();
        let data_manager = self.data_manager.clone();

        // 获取本地项目数据
        let local_data = {
            let manager = data_manager.lock().await;
            manager.get_local_data().to_vec()
        };

        // 构建同步数据数组
        let mut sync_items = Vec::new();

        // 收集需要上传的项目
        for item_id in items {
            if let Some(item) = local_data.iter().find(|i| i.id == *item_id) {
                sync_items.push(item.clone());
            }
        }

        if sync_items.is_empty() {
            return Ok(vec![]);
        }

        // 序列化同步数据为 JSON
        let sync_json = serde_json::to_string(&sync_items)
            .map_err(|e| format!("序列化同步数据失败: {}", e))?;

        // 上传同步数据到云端
        let client = webdav_client.lock().await;
        match client.upload_sync_data("sync-data.json", &sync_json).await {
            Ok(_) => {
                // 上传成功，更新所有项目状态为已同步
                for item_id in items {
                    let mut manager = data_manager.lock().await;
                    manager.mark_item_as_synced(item_id);
                    uploaded_items.push(item_id.clone());
                }
            }
            Err(e) => {
                // 上传失败，记录错误
                self.report_error(format!("上传同步数据失败: {}", e));
                // 更新为失败状态
                for item_id in items {
                    let mut manager = data_manager.lock().await;
                    manager.mark_item_as_failed(item_id);
                }
                return Err(e);
            }
        }

        Ok(uploaded_items)
    }

    /// 下载云端变更
    async fn download_cloud_changes(&self, items: &[String]) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        let mut downloaded_items = Vec::new();
        let webdav_client = self.webdav_client.clone();
        let data_manager = self.data_manager.clone();

        // 从云端下载同步数据
        let client = webdav_client.lock().await;
        match client.download_sync_data("sync-data.json").await {
            Ok(result) => {
                if let Some(data) = result.data {
                    // 反序列化同步数据
                    let cloud_items: Vec<SyncDataItem> = serde_json::from_str(&data)
                        .map_err(|e| format!("反序列化云端数据失败: {}", e))?;

                    // 查找需要下载的项目
                    for item_id in items {
                        if let Some(cloud_item) = cloud_items.iter().find(|i| i.id == *item_id) {
                            // 将云端项目保存到本地
                            let mut manager = data_manager.lock().await;
                            manager.save_item_from_cloud(cloud_item);
                            downloaded_items.push(item_id.clone());
                        }
                    }
                } else {
                    return Err("下载的数据为空".to_string());
                }
            }
            Err(e) => {
                // 下载失败，记录错误
                self.report_error(format!("下载云端数据失败: {}", e));
                return Err(e);
            }
        }

        Ok(downloaded_items)
    }

    /// 处理删除操作
    async fn process_deletions(&self, items: &[String]) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        let mut deleted_items = Vec::new();
        let data_manager = self.data_manager.clone();

        // 本地删除
        {
            let mut manager = data_manager.lock().await;
            for item_id in items {
                manager.mark_item_as_deleted(item_id);
                deleted_items.push(item_id.clone());
            }
        }

        // 更新云端同步数据（标记为已删除）
        let webdav_client = self.webdav_client.clone();
        let client = webdav_client.lock().await;

        // 下载当前云端数据
        if let Ok(result) = client.download_sync_data("sync-data.json").await {
            if let Some(data) = result.data {
                // 反序列化同步数据
                let cloud_items_result: Result<Vec<SyncDataItem>, _> = serde_json::from_str(&data);
                if let Ok(mut cloud_items) = cloud_items_result {
                    // 标记项目为已删除
                    for item_id in items {
                        if let Some(item) = cloud_items.iter_mut().find(|i| i.id == *item_id) {
                            item.deleted = true;
                            item.sync_status = SyncDataStatus::Synced;
                        }
                    }

                    // 重新上传更新后的数据
                    let updated_json = serde_json::to_string(&cloud_items)
                        .map_err(|e| format!("序列化删除更新数据失败: {}", e))?;

                    if let Err(e) = client.upload_sync_data("sync-data.json", &updated_json).await {
                        // 上传失败，记录错误但不中断流程
                        self.report_error(format!("更新云端删除状态失败: {}", e));
                    }
                }
            }
        }

        Ok(deleted_items)
    }

    /// 更新同步索引
    async fn update_sync_index(&mut self, mode_config: &SyncModeConfig) -> Result<(), String> {
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        // 获取当前数据
        let data_manager = self.data_manager.lock().await;
        let raw_data = data_manager.get_local_data().to_vec();
        let active_data: Vec<SyncDataItem> = raw_data.iter().filter(|item| !item.deleted).cloned().collect();

        drop(data_manager);

        // 根据当前模式筛选数据
        let filtered_data_vec: Vec<SyncDataItem> = self.filter_data_for_sync(&active_data, mode_config);

        // 计算数据校验和
        let data_json = serde_json::to_string(&filtered_data_vec).unwrap_or_default();
        let data_checksum = Some(format!("{:x}", md5::compute(data_json)));

        // 创建统计信息
        let statistics = SyncStatistics {
            total_items: raw_data.len(),
            active_items: active_data.len(),
            synced_items: 0,
            unsynced_items: filtered_data_vec.len(),
            conflict_items: 0,
            deleted_items: raw_data.len() - active_data.len(),
        };

        // 创建新的同步索引
        let new_index = SyncIndex {
            format_version: "1.0".to_string(),
            device_id: mode_config.device_id.clone(),
            timestamp: current_time,
            last_sync_time: current_time,
            sync_mode: mode_config.clone(),
            raw_data,
            active_data,
            filtered_data: filtered_data_vec,
            data_checksum,
            statistics,
        };

        // 更新索引
        self.previous_index = self.current_index.clone();
        self.current_index = Some(new_index);

        Ok(())
    }
}
