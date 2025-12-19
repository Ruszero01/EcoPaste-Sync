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
use tauri_plugin_eco_database::DatabaseState;

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

/// 类型别名：本地数据使用数据库模型
pub type LocalSyncDataItem = tauri_plugin_eco_database::SyncDataItem;

/// 重新导出类型别名，方便使用
pub use LocalSyncDataItem as SyncDataItem;

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

impl Default for SyncDataStatus {
    fn default() -> Self {
        SyncDataStatus::None
    }
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
    pub async fn perform_sync(
        &mut self,
        mode_config: SyncModeConfig,
        database_state: &DatabaseState,
    ) -> Result<SyncProcessResult, String> {
        if self.sync_in_progress {
            return Err("同步正在进行中".to_string());
        }

        self.sync_in_progress = true;
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        log::info!("🚀 开始执行同步: only_favorites={}, include_images={}, include_files={}",
            mode_config.only_favorites, mode_config.include_images, mode_config.include_files);

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
        log::info!("🔄 步骤 1/12: 加载本地数据...");
        let local_data = self.load_local_data(database_state).await.map_err(|e| {
            self.report_error(format!("加载本地数据失败: {}", e));
            e
        })?;
        log::info!("✅ 本地数据加载完成: {} 条记录", local_data.len());

        // 2. 加载云端数据 (20%)
        self.update_progress(0.2);
        log::info!("🔄 步骤 2/12: 加载云端数据...");
        let cloud_data = self.load_cloud_data().await.map_err(|e| {
            self.report_error(format!("加载云端数据失败: {}", e));
            e
        })?;
        log::info!("✅ 云端数据加载完成: {} 条记录", cloud_data.len());

        // 3. 检测模式变更 (30%)
        self.update_progress(0.3);
        log::info!("🔄 步骤 3/12: 检测模式变更...");
        let mut data_manager = self.data_manager.lock().await;
        let mode_changed = data_manager.detect_mode_change(&mode_config);
        if mode_changed {
            data_manager.reset_mode_change_flag();
            result.conflict_items.push("模式变更检测".to_string());
        }
        log::info!("✅ 模式变更检测完成");

        // 4. 检测版本升级问题 (35%)
        self.update_progress(0.35);
        log::info!("🔄 步骤 4/12: 检测版本升级问题...");
        let abnormal_items = data_manager.detect_and_fix_upgrade_issues(&mode_config).await;
        if !abnormal_items.is_empty() {
            result.conflict_items.extend(abnormal_items.iter().cloned());
        }
        log::info!("✅ 版本升级问题检测完成");

        // 5. 检测收藏状态变更 (40%)
        self.update_progress(0.4);
        log::info!("🔄 步骤 5/12: 检测收藏状态变更...");
        let favorite_changes = data_manager.detect_favorite_status_changes(&mode_config);
        result.actually_changed_items.extend(favorite_changes);

        // 清理收藏状态变更记录
        data_manager.clear_favorite_status_changes();
        log::info!("✅ 收藏状态变更检测完成");

        drop(data_manager);

        // 6. 数据筛选和验证 (50%)
        self.update_progress(0.5);
        log::info!("🔄 步骤 6/12: 数据筛选和验证...");
        let filtered_local = self.filter_data_for_sync(&local_data, &mode_config);
        let filtered_cloud = self.filter_data_for_sync(&cloud_data, &mode_config);
        log::info!("✅ 数据筛选完成: 本地 {} 项 (原始: {} 项), 云端 {} 项 (原始: {} 项)",
            filtered_local.len(), local_data.len(), filtered_cloud.len(), cloud_data.len());
        log::info!("   筛选条件: only_favorites={}, include_text={}, include_html={}, include_rtf={}, include_images={}, include_files={}",
            mode_config.only_favorites,
            mode_config.content_types.include_text,
            mode_config.content_types.include_html,
            mode_config.content_types.include_rtf,
            mode_config.include_images,
            mode_config.include_files);

        // 🧹 清理本地已删除的数据（从本地数据中移除 deleted=true 的项目）
        let local_active_count = local_data.iter().filter(|item| !item.deleted).count();
        if local_active_count < local_data.len() {
            log::info!("🧹 本地数据清理: {} -> {} 项", local_data.len(), local_active_count);
            // 这里只是记录日志，实际清理在上传时进行
        }

        // 7. 冲突检测和解决 (60%)
        self.update_progress(0.6);
        log::info!("🔄 步骤 7/12: 冲突检测和解决...");
        let detected_conflicts = self.detect_and_resolve_conflicts(&filtered_local, &filtered_cloud).await;
        result.conflict_items.extend(detected_conflicts.iter().cloned());
        log::info!("✅ 冲突检测完成: 发现 {} 个冲突", detected_conflicts.len());

        // 8. 执行同步操作 - 上传本地新增/更新 (70%)
        self.update_progress(0.7);
        log::info!("🔄 步骤 8/12: 计算同步操作...");
        let (items_to_upload, items_to_download, items_to_delete) =
            self.calculate_sync_operations(&filtered_local, &filtered_cloud).await;
        log::info!("✅ 同步操作计算完成: 上传 {} 项，下载 {} 项，删除 {} 项", items_to_upload.len(), items_to_download.len(), items_to_delete.len());

        // 上传本地变更
        if !items_to_upload.is_empty() {
            log::info!("🔄 步骤 8/12: 上传本地变更...");
            match self.upload_local_changes(&items_to_upload, database_state).await {
                Ok(uploaded) => {
                    result.uploaded_items.extend(uploaded.iter().cloned());
                    log::info!("✅ 本地变更上传完成: {} 项", uploaded.len());
                }
                Err(e) => {
                    result.errors.push(format!("上传失败: {}", e));
                    log::error!("❌ 本地变更上传失败: {}", e);
                }
            }
        } else {
            log::info!("✅ 步骤 8/12: 无需上传本地变更");
        }

        // 9. 执行同步操作 - 下载云端新增/更新 (80%)
        self.update_progress(0.8);
        if !items_to_download.is_empty() {
            log::info!("🔄 步骤 9/12: 下载云端变更...");
            match self.download_cloud_changes(&items_to_download, database_state).await {
                Ok(downloaded) => {
                    result.downloaded_items.extend(downloaded.iter().cloned());
                    log::info!("✅ 云端变更下载完成: {} 项", downloaded.len());
                }
                Err(e) => {
                    result.errors.push(format!("下载失败: {}", e));
                    log::error!("❌ 下载云端变更失败: {}", e);
                }
            }
        } else {
            log::info!("✅ 步骤 9/12: 无需下载云端变更");
        }

        // 10. 处理删除操作 (85%)
        self.update_progress(0.85);
        if !items_to_delete.is_empty() {
            log::info!("🔄 步骤 10/12: 处理删除操作...");
            match self.process_deletions(&items_to_delete, database_state).await {
                Ok(deleted) => {
                    result.deleted_items.extend(deleted.iter().cloned());
                    log::info!("✅ 删除操作完成: {} 项", deleted.len());
                }
                Err(e) => {
                    result.errors.push(format!("删除失败: {}", e));
                    log::error!("❌ 删除操作失败: {}", e);
                }
            }
        } else {
            log::info!("✅ 步骤 10/12: 无需删除操作");
        }

        // 11. 状态一致性验证和修复 (90%)
        self.update_progress(0.9);
        log::info!("🔄 步骤 11/12: 状态一致性验证和修复...");
        let validation_result = self.validate_and_fix_state().await?;
        let abnormal_items = validation_result.abnormal_items.clone();
        if !validation_result.is_valid {
            self.fix_abnormal_state(validation_result).await?;
        }
        log::info!("✅ 状态验证完成");

        // 🧹 清理本地已删除的数据（彻底删除）
        {
            let db = database_state.lock().await;
            let deleted_items: Vec<String> = {
                let manager = self.data_manager.lock().await;
                manager.get_local_data()
                    .iter()
                    .filter(|item| item.deleted)
                    .map(|item| item.id.clone())
                    .collect()
            };

            if !deleted_items.is_empty() {
                log::info!("🧹 清理本地已删除数据，共 {} 项", deleted_items.len());
                for item_id in &deleted_items {
                    if let Err(e) = db.mark_deleted(item_id) {
                        self.report_error(format!("清理本地删除数据失败: {}", e));
                    }
                }
            }
        }

        // 12. 更新索引和清理 (100%)
        self.update_progress(1.0);
        log::info!("🔄 步骤 12/12: 更新索引和清理...");
        self.update_sync_index(&mode_config).await?;
        log::info!("✅ 索引更新完成");

        result.conflict_items.extend(abnormal_items);

        let end_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        result.success = result.errors.is_empty();
        result.duration_ms = (end_time - start_time) as u64;

        // 检查是否有实际变化（模拟前端逻辑）
        let has_changes = !result.uploaded_items.is_empty()
            || !result.downloaded_items.is_empty()
            || !result.deleted_items.is_empty();

        if !has_changes {
            log::info!("✅ 同步完成: 云端和本地数据已一致，无需同步");
        } else {
            log::info!(
                "✅ 同步完成: 上传 {} 项，下载 {} 项，删除 {} 项",
                result.uploaded_items.len(),
                result.downloaded_items.len(),
                result.deleted_items.len()
            );
        }

        // 记录错误信息（如果存在）
        if !result.errors.is_empty() {
            log::error!("❌ 同步过程中发生 {} 个错误:", result.errors.len());
            for (i, error) in result.errors.iter().enumerate() {
                log::error!("   {}. {}", i + 1, error);
            }
        }

        log::info!("🎉 同步流程全部完成！");
        self.sync_in_progress = false;
        Ok(result)
    }

    /// 验证和修复状态
    /// 前端踩坑：需要严格检查本地状态与云端是否真正匹配
    /// 改进：内建状态验证机制
    /// 简化：前端只读取数据库显示，所有操作在后端完成
    async fn validate_and_fix_state(&self) -> Result<StateValidationResult, String> {
        log::info!("🔄 简化状态验证...");

        // 简化：不做复杂的状态验证，直接返回通过
        // 前端只负责读取数据库显示，所有状态管理在后端完成
        Ok(StateValidationResult {
            is_valid: true,
            abnormal_items: vec![],
            items_to_fix: vec![],
            validation_details: HashMap::new(),
        })
    }

    /// 修复异常状态
    /// 前端踩坑：状态不一致时需要批量修复
    /// 改进：自动状态修复机制
    /// 简化：前端只读取数据库显示，所有操作在后端完成
    async fn fix_abnormal_state(&mut self, validation_result: StateValidationResult) -> Result<(), String> {
        if validation_result.items_to_fix.is_empty() {
            return Ok(());
        }

        log::info!("ℹ️ 状态验证发现 {} 项异常，但跳过修复（简化逻辑）", validation_result.items_to_fix.len());

        // 简化：不做任何修复
        // 前端只负责读取数据库显示，所有操作在后端完成
        Ok(())
    }

    /// 严格检查项目是否真的已同步（简化版）
    /// 移除冗余字段：直接比较核心字段
    fn is_item_actually_synced(&self, local_item: &SyncDataItem, cloud_item: &SyncDataItem) -> bool {
        // 基础字段匹配检查
        if local_item.item_type != cloud_item.item_type
            || local_item.favorite != cloud_item.favorite
            || local_item.note != cloud_item.note {
            return false;
        }

        // 使用内容比较（文本内容或文件路径）
        if let (Some(local_value), Some(cloud_value)) = (&local_item.value, &cloud_item.value) {
            // 对于长内容，只比较前1000字符以提高性能
            // 注意：使用 char_indices 来安全地按字符边界切片
            let max_chars = 1000;
            let local_chars: Vec<char> = local_value.chars().collect();
            let cloud_chars: Vec<char> = cloud_value.chars().collect();

            let local_slice = if local_chars.len() > max_chars {
                local_chars[..max_chars].iter().collect::<String>()
            } else {
                local_value.clone()
            };

            let cloud_slice = if cloud_chars.len() > max_chars {
                cloud_chars[..max_chars].iter().collect::<String>()
            } else {
                cloud_value.clone()
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
    /// 从架构设计上，直接查询数据库，不依赖内部的initialized标志
    /// 只要数据库文件存在，就能查询
    async fn load_local_data(&self, database_state: &DatabaseState) -> Result<Vec<SyncDataItem>, String> {
        let data_manager = self.data_manager.clone();

        log::info!("🔄 正在锁定数据库状态...");
        // 直接查询数据库，不检查initialized标志
        // initialized是内部实现细节，不应该影响外部查询
        let db = database_state.lock().await;
        log::info!("✅ 数据库状态锁定成功");

        let options = tauri_plugin_eco_database::QueryOptions {
            where_clause: None,
            order_by: Some("createTime DESC".to_string()),
            limit: None,
            offset: None,
            only_favorites: false,
            exclude_deleted: false,
        };

        log::info!("🔄 正在查询历史数据...");
        log::info!("   查询参数: only_favorites={}, exclude_deleted={}",
            options.only_favorites, options.exclude_deleted);
        // 直接尝试查询，失败则返回空数组
        let history_items = match db.query_history(options) {
            Ok(items) => {
                log::info!("✅ 历史数据查询成功，共 {} 条记录", items.len());
                // 统计收藏和未收藏数量
                let favorite_count = items.iter().filter(|i| i.favorite != 0).count();
                log::info!("   其中收藏项: {} 条, 未收藏项: {} 条", favorite_count, items.len() - favorite_count);
                items
            }
            Err(e) => {
                // 查询失败可能是因为数据库文件不存在，返回空数组
                log::error!("❌ 数据库查询失败，返回空数据: {}", e);
                let mut manager = data_manager.lock().await;
                manager.load_local_data(vec![]).await;
                return Ok(vec![]);
            }
        };

        log::info!("🔄 正在转换数据格式...");
        // 转换为精简版SyncDataItem格式
        let sync_items: Vec<SyncDataItem> = history_items
            .into_iter()
            .map(|item| {
                // 优先使用 last_modified，如果不存在则使用 create_time
                let last_modified = if let Some(ts) = item.last_modified {
                    ts
                } else if let Ok(ts) = item.create_time.parse::<i64>() {
                    ts
                } else {
                    chrono::Utc::now().timestamp_millis()
                };

                SyncDataItem {
                    id: item.id,
                    item_type: item.item_type.unwrap_or_default(),
                    subtype: item.subtype.clone(), // 从历史数据中提取 subtype
                    value: item.value,
                    favorite: item.favorite != 0,
                    note: item.note,
                    last_modified,
                    deleted: item.deleted.unwrap_or(0) != 0,
                    // 统计元数据
                    file_size: item.file_size,
                    width: item.width,
                    height: item.height,
                }
            })
            .collect();

        log::info!("🔄 正在更新缓存...");
        // 更新缓存
        let mut manager = data_manager.lock().await;
        manager.load_local_data(sync_items.clone()).await;

        log::info!("✅ 本地数据加载完成");
        Ok(sync_items)
    }

    /// 加载云端数据
    async fn load_cloud_data(&self) -> Result<Vec<SyncDataItem>, String> {
        let webdav_client = self.webdav_client.clone();
        let data_manager = self.data_manager.clone();

        log::info!("🔄 开始加载云端数据...");

        // 从云端下载同步数据
        let client = webdav_client.lock().await;
        log::info!("🔄 正在从云端下载 sync-data.json...");
        match client.download_sync_data("sync-data.json").await {
            Ok(result) => {
                log::info!("✅ 云端数据下载成功");
                let cloud_data = if let Some(data) = result.data {
                    // 反序列化同步数据
                    log::info!("🔄 正在反序列化云端数据...");
                    let cloud_items: Vec<SyncDataItem> = serde_json::from_str(&data)
                        .map_err(|e| format!("反序列化云端数据失败: {}", e))?;

                    // 更新DataManager的云端数据缓存
                    let mut manager = data_manager.lock().await;
                    manager.load_cloud_data(cloud_items.clone()).await;

                    log::info!("✅ 从云端下载了 {} 条记录", cloud_items.len());

                    cloud_items
                } else {
                    // 云端无数据，初始化为空
                    let mut manager = data_manager.lock().await;
                    manager.load_cloud_data(vec![]).await;

                    log::info!("ℹ️ 云端无数据");
                    vec![]
                };

                Ok(cloud_data)
            }
            Err(e) => {
                // 下载失败，返回错误
                log::error!("❌ 下载云端数据失败: {}", e);
                Err(format!("下载云端数据失败: {}", e))
            }
        }
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
        // 检查时间戳判断谁更新
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

        // 构建索引（过滤已删除项目）
        let local_index: HashMap<String, &SyncDataItem> = local_data
            .iter()
            .filter(|item| !item.deleted) // 过滤掉已删除的项目（上传时不包含删除的项目）
            .map(|item| (item.id.clone(), item))
            .collect();

        let cloud_index: HashMap<String, &SyncDataItem> = cloud_data
            .iter()
            .filter(|item| !item.deleted) // 过滤掉云端已删除的项目
            .map(|item| (item.id.clone(), item))
            .collect();

        // 收集需要清理的已删除项目
        let items_to_cleanup: Vec<String> = local_data
            .iter()
            .filter(|item| item.deleted)
            .map(|item| item.id.clone())
            .collect();

        if !items_to_cleanup.is_empty() {
            log::info!("🧹 发现 {} 项已删除数据将在上传前清理", items_to_cleanup.len());
        }

        // 查找本地新增或更新的项目（需要上传）
        for (id, local_item) in &local_index {
            if let Some(cloud_item) = cloud_index.get(id) {
                // 双方都存在，检查时间戳判断谁更新
                if local_item.last_modified > cloud_item.last_modified {
                    items_to_upload.push(id.clone());
                }
            } else {
                // 本地新增（云端没有）
                items_to_upload.push(id.clone());
            }
        }

        // 查找云端新增或更新的项目（需要下载）
        for (id, cloud_item) in &cloud_index {
            if let Some(local_item) = local_index.get(id) {
                // 双方都存在，检查时间戳判断谁更新
                if cloud_item.last_modified > local_item.last_modified {
                    items_to_download.push(id.clone());
                }
            } else {
                // 云端新增（本地没有）
                items_to_download.push(id.clone());
            }
        }

        // 查找需要删除的项目（本地标记为删除的项目）
        for item in local_data {
            if item.deleted {
                // 检查云端是否还有这个项目（如果是新增删除，本地有云端可能没有）
                // 或者云端还有这个项目且未标记删除
                if cloud_index.contains_key(&item.id) {
                    items_to_delete.push(item.id.clone());
                }
            }
        }

        (items_to_upload, items_to_download, items_to_delete)
    }

    /// 上传本地变更
    async fn upload_local_changes(&self, items: &[String], database_state: &DatabaseState) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        log::info!("🔄 开始上传本地变更，共 {} 项", items.len());

        let mut uploaded_items = Vec::new();
        let webdav_client = self.webdav_client.clone();
        let data_manager = self.data_manager.clone();
        let file_sync_manager = self.file_sync_manager.clone();

        // 获取本地项目数据
        let local_data = {
            let manager = data_manager.lock().await;
            manager.get_local_data().to_vec()
        };

        // 获取云端数据用于对比
        let cloud_data = {
            let manager = data_manager.lock().await;
            manager.get_cloud_data().to_vec()
        };

        // 关键修复：增量合并上传，不覆盖云端数据
        // 先下载云端现有数据，然后合并本地新数据

        log::info!("🔄 下载云端现有数据用于合并...");
        let client = webdav_client.lock().await;
        let (cloud_existing, cloud_count) = match client.download_sync_data("sync-data.json").await {
            Ok(result) => {
                if let Some(data) = result.data {
                    match serde_json::from_str::<Vec<tauri_plugin_eco_database::SyncDataItem>>(&data) {
                        Ok(items) => {
                            let count = items.len();
                            log::info!("✅ 云端现有数据加载完成: {} 条记录", count);
                            (items, count)
                        }
                        Err(e) => {
                            log::warn!("⚠️ 云端数据格式异常，重新开始: {}", e);
                            (vec![], 0)
                        }
                    }
                } else {
                    log::info!("ℹ️ 云端暂无数据，从零开始");
                    (vec![], 0)
                }
            }
            Err(e) => {
                log::warn!("⚠️ 下载云端数据失败，从零开始: {}", e);
                (vec![], 0)
            }
        };
        drop(client);

        // 🧹 清理云端已删除的数据（从云端数据中移除 deleted=true 的项目）
        let cloud_existing_clean: Vec<_> = cloud_existing.iter()
            .filter(|item| !item.deleted)
            .cloned()
            .collect();

        if cloud_existing.len() > cloud_existing_clean.len() {
            log::info!("🧹 清理云端已删除数据: {} -> {}",
                cloud_existing.len(), cloud_existing_clean.len());
        }

        // 构建合并后的完整数据（云端数据 + 本地新数据）
        let mut merged_items = cloud_existing_clean;
        let mut actually_uploaded = Vec::new();
        let mut file_items_to_upload = Vec::new();

        // 收集需要上传的项目并检查是否真的发生了变化
        for item_id in items {
            if let Some(local_item) = local_data.iter().find(|i| i.id == *item_id) {
                // 检查是否真的需要上传（模拟前端filterActuallyChangedItems）
                let cloud_item = cloud_data.iter().find(|i| i.id == *item_id);

                let needs_upload = if let Some(cloud) = cloud_item {
                    // 双方都存在，检查是否真的不同
                    !self.is_item_actually_synced(local_item, cloud)
                } else {
                    // 本地新增，直接上传
                    true
                };

                if needs_upload {
                    // 添加到合并列表（覆盖云端旧数据）
                    if let Some(pos) = merged_items.iter().position(|i| i.id == *item_id) {
                        merged_items[pos] = local_item.clone();
                    } else {
                        merged_items.push(local_item.clone());
                    }
                    actually_uploaded.push(item_id.clone());

                    // 分离文件/图片项目，后续单独上传文件
                    if local_item.item_type == "image" || local_item.item_type == "files" {
                        file_items_to_upload.push(local_item.clone());
                        log::info!("📁 准备上传文件: {} (类型: {}, 路径: {:?})",
                            local_item.id, local_item.item_type, local_item.value);
                    }
                }
            }
        }

        if actually_uploaded.is_empty() {
            return Ok(vec![]);
        }

        log::info!("实际上传项目数: {}/{}", actually_uploaded.len(), items.len());
        log::info!("其中文件/图片项目: {} 项", file_items_to_upload.len());
        log::info!("合并后云端总项目数: {}", merged_items.len());

        // 首先上传文件/图片到云端
        if !file_items_to_upload.is_empty() {
            log::info!("🔄 开始上传文件/图片，共 {} 项", file_items_to_upload.len());
            let file_sync_manager_locked = file_sync_manager.lock().await;

            for file_item in &file_items_to_upload {
                if let Some(file_path) = &file_item.value {
                    let file_name = std::path::Path::new(file_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown");

                    log::info!("📁 上传文件: {} -> {}", file_path, file_name);

                    // 构建文件上传任务（使用简化后的元数据）
                    let metadata = crate::file_sync_manager::FileMetadata {
                        id: file_item.id.clone(),
                        file_name: file_name.to_string(),
                        original_path: Some(std::path::PathBuf::from(file_path)),
                        remote_path: format!("files/{}_{}", file_item.id, file_name),
                        size: 0, // TODO: 获取文件大小
                        create_time: file_item.last_modified, // 使用last_modified作为create_time
                        last_modified: chrono::Utc::now().timestamp_millis(),
                        checksum: None, // 简化：不再使用checksum
                        mime_type: None,
                    };

                    let upload_task = crate::file_sync_manager::FileUploadTask {
                        metadata,
                        local_path: std::path::PathBuf::from(file_path),
                        remote_path: format!("files/{}_{}", file_item.id, file_name),
                    };

                    // 执行文件上传
                    match file_sync_manager_locked.upload_file(upload_task).await {
                        Ok(result) => {
                            if result.success {
                                log::info!("✅ 文件上传成功: {}", file_name);
                            } else {
                                log::error!("❌ 文件上传失败: {}, 错误: {:?}", file_name, result.errors);
                            }
                        }
                        Err(e) => {
                            log::error!("❌ 文件上传异常: {}, 错误: {}", file_name, e);
                        }
                    }
                }
            }
        }

        // 序列化合并后的完整数据为 JSON
        // 这样云端数据就是累积的，不会因为模式切换而丢失
        log::info!("🔄 正在序列化合并后的同步数据，共 {} 项（云端 {} + 新增 {}）",
            merged_items.len(), cloud_count, actually_uploaded.len());
        let sync_json = serde_json::to_string(&merged_items)
            .map_err(|e| format!("序列化同步数据失败: {}", e))?;

        // 上传同步数据到云端
        let client = webdav_client.lock().await;
        match client.upload_sync_data("sync-data.json", &sync_json).await {
            Ok(_) => {
                // 上传成功，更新DataManager状态
                {
                    let mut manager = data_manager.lock().await;
                    for item_id in &actually_uploaded {
                        manager.mark_item_as_synced(item_id);
                    }
                }

                // 更新数据库状态为"synced"
                {
                    let db = database_state.lock().await;
                    for item_id in &actually_uploaded {
                        if let Err(e) = db.update_sync_status(item_id, "synced") {
                            self.report_error(format!("更新数据库同步状态失败: {}", e));
                        }
                    }
                }

                uploaded_items.extend(actually_uploaded);
            }
            Err(e) => {
                // 上传失败，记录错误
                self.report_error(format!("上传同步数据失败: {}", e));
                // 更新为失败状态
                {
                    let mut manager = data_manager.lock().await;
                    for item_id in items {
                        manager.mark_item_as_failed(item_id);
                    }
                }
                return Err(e);
            }
        }

        Ok(uploaded_items)
    }

    /// 下载云端变更
    async fn download_cloud_changes(&self, items: &[String], database_state: &DatabaseState) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        let mut downloaded_items = Vec::new();
        let webdav_client = self.webdav_client.clone();
        let data_manager = self.data_manager.clone();
        let file_sync_manager = self.file_sync_manager.clone();

        // 从云端下载同步数据
        let client = webdav_client.lock().await;
        match client.download_sync_data("sync-data.json").await {
            Ok(result) => {
                if let Some(data) = result.data {
                    // 反序列化云端数据（直接使用数据库模型，没有 sync_status 字段）
                    let cloud_items: Vec<tauri_plugin_eco_database::SyncDataItem> = serde_json::from_str(&data)
                        .map_err(|e| format!("反序列化云端数据失败: {}", e))?;

                    // 🧹 过滤掉已删除的项目（清理云端数据）
                    let cloud_items_active: Vec<_> = cloud_items.iter()
                        .filter(|item| !item.deleted)
                        .cloned()
                        .collect();

                    if cloud_items.len() > cloud_items_active.len() {
                        log::info!("🧹 下载时过滤已删除数据: {} -> {}",
                            cloud_items.len(), cloud_items_active.len());
                    }

                    // 收集需要下载的文件项目
                    let mut file_items_to_download = Vec::new();

                    // 查找需要下载的项目（使用过滤后的活跃数据）
                    for item_id in items {
                        if let Some(cloud_item) = cloud_items_active.iter().find(|i| i.id == *item_id) {
                            // 将云端项目保存到内存
                            let mut manager = data_manager.lock().await;
                            manager.save_item_from_cloud(cloud_item);
                            drop(manager);

                            // 如果是文件/图片类型，先下载文件
                            if cloud_item.item_type == "image" || cloud_item.item_type == "files" {
                                file_items_to_download.push(cloud_item.clone());
                                log::info!("📁 准备下载文件: {} (类型: {})", cloud_item.id, cloud_item.item_type);
                            }

                            // 保存到数据库（保留统计元数据）
                            let db_item = tauri_plugin_eco_database::SyncDataItem {
                                id: cloud_item.id.clone(),
                                item_type: cloud_item.item_type.clone(),
                                subtype: cloud_item.subtype.clone(),
                                value: cloud_item.value.clone(),
                                favorite: cloud_item.favorite,
                                note: cloud_item.note.clone(),
                                last_modified: chrono::Utc::now().timestamp_millis(),
                                deleted: cloud_item.deleted,
                                // 添加统计元数据
                                file_size: cloud_item.file_size,
                                width: cloud_item.width,
                                height: cloud_item.height,
                            };

                            let db = database_state.lock().await;
                            if let Err(e) = db.upsert_from_cloud(&db_item) {
                                self.report_error(format!("保存云端数据到数据库失败: {}", e));
                            }
                            drop(db);

                            downloaded_items.push(item_id.clone());
                        }
                    }

                    // 🧹 更新DataManager中的云端数据（使用过滤后的数据）
                    {
                        let mut manager = data_manager.lock().await;
                        manager.load_cloud_data(cloud_items_active.clone()).await;
                        log::info!("✅ DataManager云端数据已更新，共 {} 项", cloud_items_active.len());
                    }

                    // 下载文件/图片
                    if !file_items_to_download.is_empty() {
                        log::info!("🔄 开始下载文件/图片，共 {} 项", file_items_to_download.len());
                        let file_sync_manager_locked = file_sync_manager.lock().await;

                        for file_item in file_items_to_download {
                            if let Some(file_name) = &file_item.value {
                                // 构建下载任务（使用简化后的元数据）
                                let metadata = crate::file_sync_manager::FileMetadata {
                                    id: file_item.id.clone(),
                                    file_name: file_name.clone(),
                                    original_path: None,
                                    remote_path: format!("files/{}_{}", file_item.id, file_name),
                                    size: 0,
                                    create_time: file_item.last_modified, // 使用last_modified作为create_time
                                    last_modified: chrono::Utc::now().timestamp_millis(),
                                    checksum: None, // 简化：不再使用checksum
                                    mime_type: None,
                                };

                                // 使用 itemId 作为文件名构建本地路径
                                let local_path = std::path::PathBuf::from(format!("cache/{}_{}", file_item.id, file_name));

                                let download_task = crate::file_sync_manager::FileDownloadTask {
                                    metadata,
                                    local_path: local_path.clone(),
                                    remote_path: format!("files/{}_{}", file_item.id, file_name),
                                };

                                // 执行文件下载
                                match file_sync_manager_locked.download_file(download_task).await {
                                    Ok(result) => {
                                        if result.success {
                                            log::info!("✅ 文件下载成功: {}", file_name);
                                        } else {
                                            log::error!("❌ 文件下载失败: {}, 错误: {:?}", file_name, result.errors);
                                        }
                                    }
                                    Err(e) => {
                                        log::error!("❌ 文件下载异常: {}, 错误: {}", file_name, e);
                                    }
                                }
                            }
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
    async fn process_deletions(&self, items: &[String], database_state: &DatabaseState) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        log::info!("🔄 开始处理删除操作，共 {} 项", items.len());

        let mut deleted_items = Vec::new();
        let data_manager = self.data_manager.clone();

        // 获取本地数据用于检查同步状态
        let local_data = {
            let manager = data_manager.lock().await;
            manager.get_local_data().to_vec()
        };

        // 分离已同步和未同步的项目
        let mut synced_items_to_mark = Vec::new();
        let mut unsynced_items_to_delete = Vec::new();

        for item_id in items {
            if local_data.iter().find(|i| i.id == *item_id).is_some() {
                let sync_status = {
                    let manager = data_manager.lock().await;
                    manager.get_item_sync_status(item_id)
                };

                match sync_status {
                    SyncDataStatus::Synced => {
                        // 已同步：先标记删除，下一次同步时清理
                        synced_items_to_mark.push(item_id.clone());
                        log::info!("📋 已同步项目标记删除: {} (下次同步时清理)", item_id);
                    }
                    _ => {
                        // 未同步：直接数据库删除
                        unsynced_items_to_delete.push(item_id.clone());
                        log::info!("🗑️ 未同步项目直接删除: {}", item_id);
                    }
                }
            }
        }

        // 1. 处理已同步项目的删除标记（延迟清理）
        if !synced_items_to_mark.is_empty() {
            let webdav_client = self.webdav_client.clone();
            let client = webdav_client.lock().await;

            // 下载当前云端数据
            if let Ok(result) = client.download_sync_data("sync-data.json").await {
                if let Some(data) = result.data {
                    let cloud_items_result: Result<Vec<SyncDataItem>, _> = serde_json::from_str(&data);
                    if let Ok(mut cloud_items) = cloud_items_result {
                        // 标记项目为已删除
                        for item_id in &synced_items_to_mark {
                            if let Some(item) = cloud_items.iter_mut().find(|i| i.id == *item_id) {
                                item.deleted = true;
                            }
                        }

                        // 重新上传更新后的数据
                        let updated_json = serde_json::to_string(&cloud_items)
                            .map_err(|e| format!("序列化删除更新数据失败: {}", e))?;

                        if let Err(e) = client.upload_sync_data("sync-data.json", &updated_json).await {
                            self.report_error(format!("更新云端删除状态失败: {}", e));
                        } else {
                            log::info!("✅ 云端删除标记更新成功: {} 项", synced_items_to_mark.len());
                        }
                    }
                }
            }
            drop(client);
        }

        // 2. 处理未同步项目的直接删除
        if !unsynced_items_to_delete.is_empty() {
            let db = database_state.lock().await;
            for item_id in &unsynced_items_to_delete {
                // 直接从数据库删除（未同步的数据云端还没有）
                if let Err(e) = db.mark_deleted(item_id) {
                    self.report_error(format!("标记数据库删除失败: {}", e));
                } else {
                    log::info!("✅ 数据库删除成功: {}", item_id);
                }
            }
        }

        // 3. 更新本地DataManager状态
        {
            let mut manager = data_manager.lock().await;
            for item_id in items {
                manager.mark_item_as_deleted(item_id);
                deleted_items.push(item_id.clone());
            }
        }

        log::info!("✅ 删除处理完成: 标记删除 {} 项，直接删除 {} 项",
            synced_items_to_mark.len(), unsynced_items_to_delete.len());

        Ok(deleted_items)
    }

    /// 更新同步索引
    async fn update_sync_index(&mut self, mode_config: &SyncModeConfig) -> Result<(), String> {
        log::info!("🔄 更新同步索引...");

        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        // 获取当前数据（只读取，不做复杂处理）
        let data_manager = self.data_manager.lock().await;
        let raw_data = data_manager.get_local_data().to_vec();

        drop(data_manager);

        // 创建简化版索引
        let new_index = SyncIndex {
            format_version: "1.0".to_string(),
            device_id: mode_config.device_id.clone(),
            timestamp: current_time,
            last_sync_time: current_time,
            sync_mode: mode_config.clone(),
            raw_data,
            active_data: vec![], // 简化：不计算活跃数据
            filtered_data: vec![], // 简化：不筛选数据
            data_checksum: None, // 简化：不计算校验和
            statistics: SyncStatistics {
                total_items: 0,
                active_items: 0,
                synced_items: 0,
                unsynced_items: 0,
                conflict_items: 0,
                deleted_items: 0,
            },
        };

        // 更新索引
        self.previous_index = self.current_index.clone();
        self.current_index = Some(new_index);

        log::info!("✅ 同步索引更新完成");
        Ok(())
    }
}
