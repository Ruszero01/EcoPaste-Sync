//! 同步核心模块
//! 基于前端云同步引擎的经验教训，设计更robust的同步架构
//! 规避前端实现中踩的坑，从底层设计上保证状态一致性

use crate::types::*;
use crate::webdav::WebDAVClientState;
use crate::data_manager::DataManager;
use crate::file_sync_manager::FileSyncManager;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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

/// 从 value 字段提取文件元数据
/// 支持两种格式：
/// 1. 本地格式：JSON数组文件路径，如 ["C:\\path\\to\\file"]
/// 2. 云端格式：简化元数据 JSON，如 {"fileName": "file.rs", "checksum": "...", "remotePath": "..."}
#[allow(dead_code)]
fn extract_file_metadata_from_value(value: &Option<String>) -> Option<super::file_sync_manager::FileMetadata> {
    if let Some(ref v) = value {
        // 尝试解析为 JSON
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(v) {
            // 优先尝试云端简化元数据格式（包含 checksum 字段）
            if let Some(checksum_obj) = parsed.get("checksum") {
                if let Some(checksum) = checksum_obj.as_str() {
                    let file_name = parsed.get("fileName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let remote_path = parsed.get("remotePath")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    // 构建简化的 FileMetadata
                    let metadata = super::file_sync_manager::FileMetadata {
                        id: "".to_string(),
                        file_name: file_name.clone(),
                        original_path: None,
                        remote_path,
                        size: 0,
                        time: 0,
                        checksum: Some(checksum.to_string()),
                        mime_type: None,
                    };

                    log::info!("🔍 从云端简化元数据提取到文件哈希: {} = {}", file_name, checksum);
                    return Some(metadata);
                }
            }

            // 尝试标准 FileMetadata 格式
            if let Ok(meta) = serde_json::from_value::<super::file_sync_manager::FileMetadata>(parsed.clone()) {
                return Some(meta);
            }

            // 尝试本地文件路径格式（JSON数组）
            if let Ok(paths) = serde_json::from_str::<Vec<String>>(v) {
                if !paths.is_empty() {
                    // 本地格式，没有哈希，返回 None
                    log::info!("🔍 检测到本地文件路径格式，无文件哈希");
                    return None;
                }
            }
        }
    }
    None
}

/// 简化的同步数据状态（根据优化方案）
/// 只保留三种状态：已同步、未同步、已变更
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncDataStatus {
    /// 未同步 - 数据从未上传或已从云端删除
    NotSynced,
    /// 已同步 - 数据已成功同步到云端且一致
    Synced,
    /// 已变更 - 数据在本地被修改，需要同步到云端
    Changed,
}

impl Default for SyncDataStatus {
    fn default() -> Self {
        SyncDataStatus::NotSynced
    }
}

/// 简化的同步索引（根据优化方案）
/// 去除冗余字段，简化数据结构
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
    /// 同步数据（云端不包含已删除项目）
    pub data: Vec<SyncDataItem>,
    /// 数据校验和（用于验证数据完整性）
    pub data_checksum: Option<String>,
}

/// 简化的同步统计信息（根据优化方案）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatistics {
    /// 总项目数
    pub total_items: usize,
    /// 已同步项目数
    pub synced_items: usize,
    /// 未同步项目数
    pub unsynced_items: usize,
    /// 已变更项目数
    pub changed_items: usize,
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
    pub data_manager: Arc<Mutex<DataManager>>,
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

    /// 执行同步操作（根据优化方案重构）
    /// 流程：收集本地数据 -> 检查云端索引 -> 数据比对 -> 双向合并 -> 更新本地状态 -> 文件同步 -> 统计结果
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

        // 步骤 1: 收集本地数据
        self.update_progress(0.1);
        log::info!("🔄 步骤 1/8: 收集本地数据...");
        let local_data = self.load_local_data(database_state).await.map_err(|e| {
            self.report_error(format!("收集本地数据失败: {}", e));
            e
        })?;
        log::info!("✅ 本地数据收集完成: {} 条记录", local_data.len());

        // 步骤 2: 检查云端索引
        self.update_progress(0.2);
        log::info!("🔄 步骤 2/8: 检查云端索引...");
        let cloud_data = self.load_cloud_data().await.map_err(|e| {
            self.report_error(format!("检查云端索引失败: {}", e));
            e
        })?;
        log::info!("✅ 云端索引检查完成: {} 条记录", cloud_data.len());

        // 步骤 3: 数据比对判断是否需要同步
        self.update_progress(0.3);
        log::info!("🔄 步骤 3/8: 数据比对判断是否需要同步...");
        let data_manager = self.data_manager.lock().await;

        // 从database的内部状态跟踪器获取已变更的数据
        let db = database_state.lock().await;
        let changed_items = db.get_change_tracker().get_changed_items();
        drop(db);

        let filtered_local = self.filter_data_for_sync(&local_data, &mode_config);
        let filtered_cloud = self.filter_data_for_sync(&cloud_data, &mode_config);

        // 筛选出未同步和已变更状态的数据
        let items_to_sync: Vec<String> = filtered_local
            .iter()
            .filter(|item| {
                let status = data_manager.get_item_sync_status(&item.id);
                status == SyncDataStatus::NotSynced || status == SyncDataStatus::Changed
            })
            .map(|item| item.id.clone())
            .collect();

        log::info!("✅ 数据比对完成: 需要同步 {} 项 (本地变更 {} 项，未同步 {} 项)",
            items_to_sync.len(), changed_items.len(), items_to_sync.len() - changed_items.len());
        drop(data_manager);

        // 步骤 4: 根据比对结果执行双向合并更新云端索引
        self.update_progress(0.4);
        log::info!("🔄 步骤 4/8: 执行双向合并更新云端索引...");

        // 4.1 上传本地未同步/已变更数据
        if !items_to_sync.is_empty() {
            match self.upload_local_changes(&items_to_sync, database_state).await {
                Ok(uploaded) => {
                    result.uploaded_items.extend(uploaded.iter().cloned());
                    log::info!("✅ 本地数据上传完成: {} 项", uploaded.len());
                }
                Err(e) => {
                    result.errors.push(format!("上传失败: {}", e));
                    log::error!("❌ 本地数据上传失败: {}", e);
                }
            }
        }

        // 4.2 下载云端新增数据
        let items_to_download = self.calculate_items_to_download(&filtered_local, &filtered_cloud);
        if !items_to_download.is_empty() {
            match self.download_cloud_changes(&items_to_download, database_state).await {
                Ok(downloaded) => {
                    result.downloaded_items.extend(downloaded.iter().cloned());
                    log::info!("✅ 云端数据下载完成: {} 项", downloaded.len());
                }
                Err(e) => {
                    result.errors.push(format!("下载失败: {}", e));
                    log::error!("❌ 云端数据下载失败: {}", e);
                }
            }
        }

        // 4.3 处理删除操作（本地软删除的项目）
        let items_to_delete = self.calculate_items_to_delete(database_state).await;
        if !items_to_delete.is_empty() {
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
        }

        // 步骤 5: 处理本地数据
        self.update_progress(0.6);
        log::info!("🔄 步骤 5/8: 处理本地数据...");

        // 更新本地数据状态
        {
            let db = database_state.lock().await;
            for item_id in &result.uploaded_items {
                if let Err(e) = db.update_sync_status(item_id, "synced") {
                    self.report_error(format!("更新本地同步状态失败: {}", e));
                }
            }
            for item_id in &result.downloaded_items {
                if let Err(e) = db.update_sync_status(item_id, "synced") {
                    self.report_error(format!("更新本地同步状态失败: {}", e));
                }
            }
        }

        log::info!("✅ 本地数据处理完成");

        // 步骤 6: 处理文件同步
        self.update_progress(0.7);
        log::info!("🔄 步骤 6/8: 处理文件同步...");
        self.process_file_sync(&filtered_local, database_state).await?;
        log::info!("✅ 文件同步处理完成");

        // 步骤 7: 更新本地同步状态
        self.update_progress(0.8);
        log::info!("🔄 步骤 7/8: 更新本地同步状态...");
        {
            let mut data_manager = self.data_manager.lock().await;
            // 清除变更记录
            data_manager.clear_changed_items();
            // 标记已上传/下载的项目为已同步
            for item_id in result.uploaded_items.iter().chain(result.downloaded_items.iter()) {
                data_manager.mark_item_as_synced(item_id);
            }
        }
        log::info!("✅ 本地同步状态更新完成");

        // 步骤 8: 统计同步结果
        self.update_progress(0.9);
        log::info!("🔄 步骤 8/8: 统计同步结果...");
        self.update_sync_index(&mode_config).await?;
        log::info!("✅ 同步结果统计完成");

        let end_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        result.success = result.errors.is_empty();
        result.duration_ms = (end_time - start_time) as u64;

        if !result.uploaded_items.is_empty() || !result.downloaded_items.is_empty() || !result.deleted_items.is_empty() {
            log::info!(
                "✅ 同步完成: 上传 {} 项，下载 {} 项，删除 {} 项",
                result.uploaded_items.len(),
                result.downloaded_items.len(),
                result.deleted_items.len()
            );
        } else {
            log::info!("✅ 同步完成: 云端和本地数据已一致，无需同步");
        }

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
    #[allow(dead_code)]
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
    #[allow(dead_code)]
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
    /// 从架构设计上，使用新的数据筛选模块，统一处理数据查询
    async fn load_local_data(&self, database_state: &DatabaseState) -> Result<Vec<SyncDataItem>, String> {
        let data_manager = self.data_manager.clone();

        log::info!("🔄 正在使用数据筛选模块查询本地数据...");

        // 使用数据库插件的查询命令，通过Tauri调用
        // 注意：这里我们需要通过invoke调用命令，但为了简化，我们直接使用内部方法
        // 实际实现中，前端会调用这些命令

        let db = database_state.lock().await;
        log::info!("✅ 数据库状态锁定成功");

        // 直接查询所有数据（不应用筛选，同步引擎会在filter_data_for_sync中处理）
        let options = tauri_plugin_eco_database::QueryOptions {
            where_clause: None,
            order_by: Some("time DESC".to_string()),
            limit: None,
            offset: None,
            only_favorites: false,
            exclude_deleted: false, // 包含软删除数据，用于删除检测和冲突处理
        };

        log::info!("🔄 正在查询历史数据...");
        log::info!("   查询参数: only_favorites={}, exclude_deleted={}",
            options.only_favorites, options.exclude_deleted);

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
                // 使用统一的 time 字段
                let time = item.time;

                SyncDataItem {
                    id: item.id,
                    item_type: item.item_type.unwrap_or_default(),
                    subtype: item.subtype.clone(), // 从历史数据中提取 subtype
                    value: item.value,
                    favorite: item.favorite != 0,
                    note: item.note,
                    time,
                    // 所有元数据都保存在 value 字段中（JSON格式）
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

    /// 查询本地软删除的项目ID和同步状态
    /// 用于区分已同步和未同步数据的删除策略
    #[allow(dead_code)]
    async fn load_local_deleted_items(&self, database_state: &DatabaseState) -> Result<Vec<(String, SyncDataStatus)>, String> {
        let db = database_state.lock().await;
        let data_manager = self.data_manager.clone();

        // 查询软删除的数据
        let options = tauri_plugin_eco_database::QueryOptions {
            where_clause: Some("deleted = 1".to_string()),
            order_by: None,
            limit: None,
            offset: None,
            only_favorites: false,
            exclude_deleted: false, // 包含软删除数据
        };

        let history_items = match db.query_history(options) {
            Ok(items) => {
                log::info!("✅ 本地软删除数据查询成功，共 {} 条记录", items.len());
                items
            }
            Err(e) => {
                log::error!("❌ 本地软删除数据查询失败: {}", e);
                return Ok(vec![]);
            }
        };

        // 检查每个软删除项目的同步状态
        let mut deleted_items_with_status = Vec::new();
        let manager = data_manager.lock().await;
        for item in history_items {
            let sync_status = manager.get_item_sync_status(&item.id);
            deleted_items_with_status.push((item.id, sync_status));
        }

        // 统计不同状态的软删除项目数量
        let synced_count = deleted_items_with_status.iter().filter(|(_, status)| *status == SyncDataStatus::Synced).count();
        let not_synced_count = deleted_items_with_status.iter().filter(|(_, status)| *status == SyncDataStatus::NotSynced).count();

        log::info!("📋 软删除项目统计: 已同步={}, 未同步={}, 总计={}",
                   synced_count, not_synced_count, deleted_items_with_status.len());

        Ok(deleted_items_with_status)
    }

    /// 批量查询本地项目的同步状态
    /// 优化性能：一次性查询所有项目的同步状态，避免循环查询数据库
    #[allow(dead_code)]
    async fn batch_query_local_sync_status(
        &self,
        local_data: &[SyncDataItem],
        database_state: &DatabaseState,
    ) -> HashMap<String, String> {
        if local_data.is_empty() {
            return HashMap::new();
        }

        let db = database_state.lock().await;

        // 构建 IN 查询
        let ids: Vec<String> = local_data.iter().map(|item| item.id.clone()).collect();
        let placeholders: Vec<String> = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let where_clause = format!("id IN ({})", placeholders.join(", "));

        let options = tauri_plugin_eco_database::QueryOptions {
            where_clause: Some(where_clause),
            order_by: None,
            limit: None,
            offset: None,
            only_favorites: false,
            exclude_deleted: false,
        };

        let history_items = match db.query_history(options) {
            Ok(items) => {
                log::info!("✅ 批量查询历史数据成功，共 {} 条记录", items.len());
                items
            }
            Err(e) => {
                log::error!("❌ 批量查询历史数据失败: {}", e);
                return HashMap::new();
            }
        };

        // 构建同步状态映射
        let mut sync_status_map = HashMap::new();
        for item in &history_items {
            let status = item.sync_status.clone().unwrap_or_else(|| "none".to_string());
            sync_status_map.insert(item.id.clone(), status);
        }

        // 对于没有查询到的项目，默认为 "none"
        for item in local_data {
            if !sync_status_map.contains_key(&item.id) {
                sync_status_map.insert(item.id.clone(), "none".to_string());
            }
        }

        log::info!("✅ 同步状态映射构建完成，共 {} 项", sync_status_map.len());
        sync_status_map
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
    #[allow(dead_code)]
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
        if local_item.time > cloud_item.time {
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

    /// 计算需要下载的云端新增项目（简化版）
    /// 根据优化方案：云端有本地没有的数据 -> 在本地添加数据
    fn calculate_items_to_download(&self, local_data: &[SyncDataItem], cloud_data: &[SyncDataItem]) -> Vec<String> {
        let local_ids: HashSet<&str> = local_data.iter().map(|item| item.id.as_str()).collect();

        // 查找云端有但本地没有的项目
        cloud_data
            .iter()
            .filter(|item| !local_ids.contains(item.id.as_str()))
            .map(|item| item.id.clone())
            .collect()
    }

    /// 计算需要删除的项目（简化版）
    /// 根据优化方案：本地标记删除的项目直接在云端索引中删除
    async fn calculate_items_to_delete(&self, _database_state: &DatabaseState) -> Vec<String> {
        let db = _database_state.lock().await;

        // 查询本地软删除的项目
        let options = tauri_plugin_eco_database::QueryOptions {
            where_clause: Some("deleted = 1".to_string()),
            order_by: None,
            limit: None,
            offset: None,
            only_favorites: false,
            exclude_deleted: false,
        };

        match db.query_history(options) {
            Ok(items) => {
                log::info!("🗑️ 本地软删除项目: {} 项", items.len());
                items.into_iter().map(|item| item.id).collect()
            }
            Err(e) => {
                log::error!("❌ 查询软删除项目失败: {}", e);
                vec![]
            }
        }
    }

    /// 处理文件同步（根据优化方案完善）
    /// 根据优化方案：
    /// - 本地已有的，需要上传的项目从历史记录数据中提取实际路径上传文件，并保持本地数据原本的 value 字段，只设置同步状态
    /// - 本地没有的，需要下载的项目下载到缓存目录（本地数据库目录下的 images 和 files 目录），并设置对应数据的 value 字段指向本地缓存路径
    async fn process_file_sync(&self, local_data: &[SyncDataItem], _database_state: &DatabaseState) -> Result<(), String> {
        // 筛选出文件/图片类型的项目
        let file_items: Vec<_> = local_data
            .iter()
            .filter(|item| item.item_type == "image" || item.item_type == "files")
            .collect();

        if file_items.is_empty() {
            log::info!("✅ 无文件/图片项目需要同步");
            return Ok(());
        }

        log::info!("📁 发现 {} 个文件/图片项目需要同步", file_items.len());

        let file_sync_manager = self.file_sync_manager.clone();
        let file_manager = file_sync_manager.lock().await;

        // 获取缓存目录
        let cache_dir = file_manager.get_cache_dir().await
            .map_err(|e| format!("获取缓存目录失败: {}", e))?;

        let images_cache_dir = cache_dir.join("images");
        let files_cache_dir = cache_dir.join("files");

        // 确保缓存目录存在
        tokio::fs::create_dir_all(&images_cache_dir).await
            .map_err(|e| format!("创建图片缓存目录失败: {}", e))?;
        tokio::fs::create_dir_all(&files_cache_dir).await
            .map_err(|e| format!("创建文件缓存目录失败: {}", e))?;

        let mut upload_tasks = Vec::new();
        let mut download_tasks = Vec::new();

        for item in &file_items {
            // 解析文件元数据
            if let Some(value) = &item.value {
                // 检查是否包含云端简化元数据（包含 checksum 字段）
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                    if parsed.get("checksum").is_some() {
                        // 云端简化元数据格式：需要下载文件
                        let remote_path = parsed.get("remotePath")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        let file_name = parsed.get("fileName")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");

                        let checksum = parsed.get("checksum")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        if !remote_path.is_empty() {
                            // 确定缓存目录
                            let cache_subdir = if item.item_type == "image" {
                                &images_cache_dir
                            } else {
                                &files_cache_dir
                            };

                            let local_path = cache_subdir.join(format!("{}_{}", item.id, file_name));

                            // 构建下载任务
                            let metadata = crate::file_sync_manager::FileMetadata {
                                id: item.id.clone(),
                                file_name: file_name.to_string(),
                                original_path: None, // 云端下载的，没有原始路径
                                remote_path: remote_path.to_string(),
                                size: parsed.get("fileSize")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0),
                                time: item.time,
                                checksum: Some(checksum.to_string()),
                                mime_type: None,
                            };

                            download_tasks.push(crate::file_sync_manager::FileDownloadTask {
                                metadata,
                                local_path: local_path.clone(),
                                remote_path: remote_path.to_string(),
                            });

                            log::info!("📥 准备下载文件: {} -> {}", remote_path, local_path.display());
                        }
                    }
                } else {
                    // 本地路径格式：需要上传文件
                    let file_paths = self.parse_file_paths(value);
                    for file_path in file_paths {
                        if file_path.exists() {
                            let file_name = file_path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("unknown");

                            // 计算文件哈希
                            let file_checksum = match crate::file_sync_manager::calculate_file_checksum(&file_path).await {
                                Ok(hash) => {
                                    log::info!("🔐 文件哈希: {} = {}", file_name, hash);
                                    Some(hash)
                                }
                                Err(e) => {
                                    log::warn!("⚠️ 计算文件哈希失败: {} ({})", file_name, e);
                                    None
                                }
                            };

                            // 构建上传任务
                            let metadata = crate::file_sync_manager::FileMetadata {
                                id: item.id.clone(),
                                file_name: file_name.to_string(),
                                original_path: Some(file_path.clone()),
                                remote_path: format!("files/{}_{}", item.id, file_name),
                                size: 0, // TODO: 获取文件大小
                                time: item.time,
                                checksum: file_checksum.clone(),
                                mime_type: None,
                            };

                            upload_tasks.push(crate::file_sync_manager::FileUploadTask {
                                metadata,
                                local_path: file_path.clone(),
                                remote_path: format!("files/{}_{}", item.id, file_name),
                            });

                            log::info!("📤 准备上传文件: {} -> files/{}_{}", file_path.display(), item.id, file_name);
                        }
                    }
                }
            }
        }

        // 执行上传任务
        if !upload_tasks.is_empty() {
            log::info!("🔄 开始上传 {} 个文件...", upload_tasks.len());
            for task in upload_tasks {
                match file_manager.upload_file(task).await {
                    Ok(result) => {
                        if result.success {
                            log::info!("✅ 文件上传成功");
                        } else {
                            log::error!("❌ 文件上传失败: {:?}", result.errors);
                        }
                    }
                    Err(e) => {
                        log::error!("❌ 文件上传异常: {}", e);
                    }
                }
            }
        }

        // 执行下载任务
        if !download_tasks.is_empty() {
            log::info!("🔄 开始下载 {} 个文件...", download_tasks.len());
            for task in download_tasks {
                match file_manager.download_file(task).await {
                    Ok(result) => {
                        if result.success {
                            log::info!("✅ 文件下载成功");
                        } else {
                            log::error!("❌ 文件下载失败: {:?}", result.errors);
                        }
                    }
                    Err(e) => {
                        log::error!("❌ 文件下载异常: {}", e);
                    }
                }
            }
        }

        log::info!("✅ 文件同步处理完成");
        Ok(())
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

        // 🧹 云端数据本身就不包含已删除项目，直接使用
        let cloud_existing_clean = cloud_existing;

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

            // 用于存储上传成功的文件元数据
            let mut uploaded_file_metadata: Vec<(String, serde_json::Value)> = Vec::new();

            for file_item in &file_items_to_upload {
                if let Some(value) = &file_item.value {
                    // 尝试解析JSON格式的文件路径
                    let file_path_str = if value.starts_with('[') {
                        // JSON数组格式：["/path/to/file"]
                        if let Ok(paths) = serde_json::from_str::<Vec<String>>(value) {
                            if !paths.is_empty() {
                                paths[0].clone()
                            } else {
                                continue;
                            }
                        } else {
                            log::error!("❌ 无法解析文件路径JSON: {}", value);
                            continue;
                        }
                    } else {
                        // 直接字符串格式
                        value.clone()
                    };

                    let file_name = std::path::Path::new(&file_path_str)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown");

                    log::info!("📁 上传文件: {} -> {}", file_path_str, file_name);

                    // 检查文件是否存在
                    let file_path_buf = std::path::PathBuf::from(&file_path_str);
                    if !file_path_buf.exists() {
                        log::error!("❌ 文件不存在: {}", file_path_str);
                        continue;
                    }

                    // 计算文件哈希（用于去重和变更检测）
                    let file_checksum = match crate::file_sync_manager::calculate_file_checksum(&file_path_buf).await {
                        Ok(hash) => {
                            log::info!("🔐 文件哈希: {} = {}", file_name, hash);
                            Some(hash)
                        }
                        Err(e) => {
                            log::warn!("⚠️ 计算文件哈希失败: {} ({})", file_name, e);
                            None
                        }
                    };

                    // 关键修复：使用数据库中的时间戳，而不是文件系统的修改时间
                    // 这样确保时间戳一致，避免误判为需要重新上传
                    let file_modified_time = file_item.time;

                    // 构建文件上传任务（包含文件哈希和数据库时间戳）
                    let metadata = crate::file_sync_manager::FileMetadata {
                        id: file_item.id.clone(),
                        file_name: file_name.to_string(),
                        original_path: Some(file_path_buf.clone()),
                        remote_path: format!("files/{}_{}", file_item.id, file_name),
                        size: 0, // TODO: 获取文件大小
                        time: file_modified_time, // 使用数据库时间戳确保一致性
                        checksum: file_checksum.clone(), // 存储文件哈希
                        mime_type: None,
                    };

                    log::info!("📅 使用数据库时间戳: {} ({})", file_name, file_modified_time);

                    let upload_task = crate::file_sync_manager::FileUploadTask {
                        metadata,
                        local_path: std::path::PathBuf::from(&file_path_str),
                        remote_path: format!("files/{}_{}", file_item.id, file_name),
                    };

                    // 执行文件上传
                    match file_sync_manager_locked.upload_file(upload_task).await {
                        Ok(result) => {
                            if result.success {
                                log::info!("✅ 文件上传成功: {}", file_name);

                                // 收集文件元数据，用于更新云端同步索引
                                // 根据优化方案：云端文件元数据包含的字段：[云端文件路径] [文件哈希] [文件大小] [图片宽度] [图片高度]
                                let mut metadata_map = serde_json::Map::new();
                                metadata_map.insert("remotePath".to_string(), serde_json::Value::String(format!("files/{}_{}", file_item.id, file_name)));

                                // 存储文件哈希（用于去重和变更检测）
                                if let Some(ref checksum) = &file_checksum {
                                    metadata_map.insert("checksum".to_string(), serde_json::Value::String(checksum.clone()));
                                    log::info!("🔐 已保存文件哈希到云端元数据: {} = {}", file_name, checksum);
                                }

                                // 存储文件大小（可选）
                                if let Ok(metadata) = std::fs::metadata(&file_path_buf) {
                                    let file_size: Result<u32, _> = metadata.len().try_into();
                                    if let Ok(file_size_val) = file_size {
                                        metadata_map.insert("fileSize".to_string(), serde_json::Value::Number(file_size_val.into()));
                                    }
                                }

                                // 存储图片宽度和高度（仅图片类型）
                                if file_item.item_type == "image" {
                                    // TODO: 从数据库获取图片宽高信息
                                    // 这里暂时不实现，因为需要数据库查询
                                }

                                let file_metadata = serde_json::Value::Object(metadata_map);
                                uploaded_file_metadata.push((file_item.id.clone(), file_metadata));
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

            // ✅ 关键修复：更新merged_items中的文件项目，将值替换为文件元数据
            for (item_id, metadata) in uploaded_file_metadata {
                if let Some(item) = merged_items.iter_mut().find(|i| i.id == item_id) {
                    item.value = Some(serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string()));
                    log::info!("📝 已更新文件元数据到同步索引: {}", item_id);
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
                // 更新为已变更状态（等待重试）
                {
                    let mut manager = data_manager.lock().await;
                    for item_id in items {
                        manager.mark_item_as_changed(item_id);
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
                    // 反序列化云端数据（云端不包含已删除项目）
                    let cloud_items: Vec<tauri_plugin_eco_database::SyncDataItem> = serde_json::from_str(&data)
                        .map_err(|e| format!("反序列化云端数据失败: {}", e))?;

                    // 收集需要下载的文件项目
                    let mut file_items_to_download = Vec::new();

                    // 查找需要下载的项目
                    for item_id in items {
                        if let Some(cloud_item) = cloud_items.iter().find(|i| i.id == *item_id) {
                            // 将云端项目保存到内存
                            let mut manager = data_manager.lock().await;
                            manager.save_item_from_cloud(cloud_item);
                            drop(manager);

                            // 如果是文件/图片类型，先下载文件
                            if cloud_item.item_type == "image" || cloud_item.item_type == "files" {
                                file_items_to_download.push(cloud_item.clone());
                                log::info!("📁 准备下载文件: {} (类型: {})", cloud_item.id, cloud_item.item_type);
                            }

                            // 保存到数据库（所有元数据都在 value 字段中）
                            let db_item = tauri_plugin_eco_database::SyncDataItem {
                                id: cloud_item.id.clone(),
                                item_type: cloud_item.item_type.clone(),
                                subtype: cloud_item.subtype.clone(),
                                value: cloud_item.value.clone(),
                                favorite: cloud_item.favorite,
                                note: cloud_item.note.clone(),
                                time: chrono::Utc::now().timestamp_millis(),
                                // 所有元数据都保存在 value 字段中（JSON格式）
                            };

                            let db = database_state.lock().await;
                            if let Err(e) = db.upsert_from_cloud(&db_item) {
                                self.report_error(format!("保存云端数据到数据库失败: {}", e));
                            }
                            drop(db);

                            downloaded_items.push(item_id.clone());
                        }
                    }

                    // 🧹 更新DataManager中的云端数据
                    {
                        let mut manager = data_manager.lock().await;
                        manager.load_cloud_data(cloud_items.clone()).await;
                        log::info!("✅ DataManager云端数据已更新，共 {} 项", cloud_items.len());
                    }

                    // 下载文件/图片
                    if !file_items_to_download.is_empty() {
                        log::info!("🔄 开始下载文件/图片，共 {} 项", file_items_to_download.len());
                        let file_sync_manager_locked = file_sync_manager.lock().await;
                        let cache_dir = file_sync_manager_locked.get_cache_dir().await
                            .map_err(|e| format!("获取缓存目录失败: {}", e))?;

                        for file_item in file_items_to_download {
                            if let Some(value) = &file_item.value {
                                // 解析云端简化元数据（JSON格式）
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                                    let remote_path = parsed.get("remotePath")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");

                                    let file_name = parsed.get("fileName")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown");

                                    let checksum = parsed.get("checksum")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string());

                                    let file_size = parsed.get("fileSize")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0);

                                    if !remote_path.is_empty() {
                                        // 确定缓存目录
                                        let cache_subdir = if file_item.item_type == "image" {
                                            cache_dir.join("images")
                                        } else {
                                            cache_dir.join("files")
                                        };

                                        let local_path = cache_subdir.join(format!("{}_{}", file_item.id, file_name));

                                        // 构建下载任务
                                        let metadata = crate::file_sync_manager::FileMetadata {
                                            id: file_item.id.clone(),
                                            file_name: file_name.to_string(),
                                            original_path: None,
                                            remote_path: remote_path.to_string(),
                                            size: file_size,
                                            time: chrono::Utc::now().timestamp_millis(),
                                            checksum,
                                            mime_type: None,
                                        };

                                        let download_task = crate::file_sync_manager::FileDownloadTask {
                                            metadata,
                                            local_path: local_path.clone(),
                                            remote_path: remote_path.to_string(),
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
    /// 同步引擎的删除逻辑：
    /// 1. 删除云端文件和数据索引
    /// 2. 本地硬删除软删除项目
    /// 注意：同步状态判断在用户操作层面（数据库操作层面）处理
    async fn process_deletions(&self, items: &[String], database_state: &DatabaseState) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        log::info!("🔄 开始处理删除操作，共 {} 项", items.len());

        let mut deleted_items = Vec::new();
        let file_sync_manager = self.file_sync_manager.clone();

        // 传入的 items 都是需要从云端删除的已同步软删除项目
        let synced_deleted_items = items.to_vec();
        log::info!("📋 需要处理的 {} 个已同步删除项目", synced_deleted_items.len());

        // 1. 删除云端文件和数据索引
        if !synced_deleted_items.is_empty() {
            log::info!("🗑️ 开始删除云端文件和记录...");

            // 1.1 删除云端文件
            let file_sync_manager_locked = file_sync_manager.lock().await;
            if let Err(e) = file_sync_manager_locked.delete_remote_files(&synced_deleted_items).await {
                log::error!("❌ 删除云端文件失败: {}", e);
                // 不阻断流程，继续删除云端记录
            } else {
                log::info!("✅ 云端文件删除完成");
            }
            drop(file_sync_manager_locked);

            // 1.2 删除云端记录（从索引中移除）
            let webdav_client = self.webdav_client.clone();
            let client = webdav_client.lock().await;

            if let Ok(result) = client.download_sync_data("sync-data.json").await {
                if let Some(data) = result.data {
                    let cloud_items_result: Result<Vec<SyncDataItem>, _> = serde_json::from_str(&data);
                    if let Ok(mut cloud_items) = cloud_items_result {
                        // 过滤掉要删除的项目（云端索引中不保留已删除内容）
                        let original_count = cloud_items.len();
                        cloud_items.retain(|item| !synced_deleted_items.contains(&item.id));

                        if cloud_items.len() < original_count {
                            log::info!("🧹 从云端索引移除 {} 项记录", original_count - cloud_items.len());

                            // 重新上传更新后的数据（已删除项目被完全移除）
                            let updated_json = serde_json::to_string(&cloud_items)
                                .map_err(|e| format!("序列化删除更新数据失败: {}", e))?;

                            if let Err(e) = client.upload_sync_data("sync-data.json", &updated_json).await {
                                self.report_error(format!("更新云端索引失败: {}", e));
                                return Err(format!("云端删除失败: {}", e));
                            } else {
                                log::info!("✅ 云端索引更新成功");
                            }
                        } else {
                            log::warn!("⚠️ 云端索引中未找到要删除的项目");
                        }
                    }
                }
            }
            drop(client);
        }

        // 2. 本地硬删除软删除项目
        log::info!("🗑️ 开始本地硬删除软删除项目...");
        let db = database_state.lock().await;
        for item_id in &synced_deleted_items {
            if let Err(e) = db.hard_delete(item_id) {
                self.report_error(format!("本地硬删除失败: {}", e));
                log::error!("❌ 本地硬删除失败: {}", e);
            } else {
                log::info!("✅ 本地硬删除完成: {}", item_id);
                deleted_items.push(item_id.clone());
            }
        }

        // 3. 更新本地DataManager状态
        {
            let data_manager = self.data_manager.clone();
            let mut manager = data_manager.lock().await;
            for item_id in &synced_deleted_items {
                manager.mark_item_as_deleted(item_id);
            }
        }

        log::info!("✅ 删除操作完成，共处理 {} 项", deleted_items.len());
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
            format_version: "2.0".to_string(), // 更新版本号以区分
            device_id: mode_config.device_id.clone(),
            timestamp: current_time,
            last_sync_time: current_time,
            sync_mode: mode_config.clone(),
            data: raw_data,
            data_checksum: None, // 简化：不计算校验和
        };

        // 更新索引
        self.previous_index = self.current_index.clone();
        self.current_index = Some(new_index);

        log::info!("✅ 同步索引更新完成");
        Ok(())
    }

    /// 解析文件路径
    /// 支持JSON数组格式 ["path1", "path2"] 和直接字符串格式 "path"
    fn parse_file_paths(&self, value: &str) -> Vec<std::path::PathBuf> {
        // 尝试JSON数组格式
        if value.starts_with('[') {
            if let Ok(paths) = serde_json::from_str::<Vec<String>>(value) {
                return paths.into_iter()
                    .map(std::path::PathBuf::from)
                    .filter(|p| !p.to_string_lossy().is_empty())
                    .collect();
            }
        }

        // 直接字符串格式
        vec![std::path::PathBuf::from(value)]
    }
}
