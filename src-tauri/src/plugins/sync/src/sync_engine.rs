//! 云同步引擎
//! 协调各子模块，实现清晰的数据流向和职责分离

use crate::types::*;
use crate::webdav::WebDAVClientState;
use crate::auto_sync_manager::AutoSyncManagerState;
use crate::sync_core::{SyncCore, SyncModeConfig, SyncProcessResult};
use crate::data_manager::{DataManager, create_shared_manager as create_data_manager};
use crate::file_sync_manager::{FileSyncManager, create_shared_manager as create_file_sync_manager};
use crate::config_sync_manager::{ConfigSyncManager};
use crate::bookmark_sync_manager::{BookmarkSyncManager};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri_plugin_eco_database::DatabaseState;

/// 统一配置结构
/// 合并老配置和新配置，提供统一的配置接口
#[derive(Debug, Clone)]
pub struct UnifiedConfig {
    /// WebDAV 服务器配置
    pub server_url: String,
    /// 自动同步设置
    pub auto_sync: bool,
    pub auto_sync_interval_minutes: u64,
    /// 同步模式配置
    pub sync_mode: SyncModeConfig,
}

/// 云同步引擎
/// 专注于协调各子模块，不包含具体同步逻辑
/// 实现清晰的数据流向：CloudSyncEngine -> SyncCore -> DataManager/FileSyncManager
pub struct CloudSyncEngine {
    /// 当前状态
    pub status: SyncStatus,
    /// 统一配置
    pub config: Option<UnifiedConfig>,
    /// 进度
    pub progress: Option<SyncProgress>,
    /// WebDAV 客户端
    pub webdav_client: WebDAVClientState,
    /// 自动同步管理器
    pub auto_sync_manager: AutoSyncManagerState,
    /// 同步核心引擎
    pub sync_core: Arc<Mutex<SyncCore>>,
    /// 数据管理器
    pub data_manager: Arc<Mutex<DataManager>>,
    /// 文件同步管理器
    pub file_sync_manager: Arc<Mutex<FileSyncManager>>,
    /// 配置同步管理器
    pub config_sync_manager: Arc<Mutex<ConfigSyncManager>>,
    /// 书签同步管理器
    pub bookmark_sync_manager: Arc<Mutex<BookmarkSyncManager>>,
}

impl CloudSyncEngine {
    /// 创建新实例
    pub fn new(
        webdav_client: WebDAVClientState,
        auto_sync_manager: AutoSyncManagerState,
    ) -> Self {
        let data_manager = create_data_manager();
        let file_sync_manager = create_file_sync_manager(webdav_client.clone());
        let sync_core = Arc::new(Mutex::new(SyncCore::new(
            webdav_client.clone(),
            data_manager.clone(),
            file_sync_manager.clone(),
        )));
        let config_sync_manager = Arc::new(Mutex::new(ConfigSyncManager::new(webdav_client.clone())));
        let device_id = "device-".to_string() + &chrono::Utc::now().timestamp_millis().to_string();
        let bookmark_sync_manager = Arc::new(Mutex::new(BookmarkSyncManager::new(
            webdav_client.clone(),
            device_id,
        )));

        Self {
            status: SyncStatus::Idle,
            config: None,
            progress: None,
            webdav_client,
            auto_sync_manager,
            sync_core,
            data_manager,
            file_sync_manager,
            config_sync_manager,
            bookmark_sync_manager,
        }
    }

    /// 初始化同步引擎
    pub async fn init(&mut self, config: SyncConfig, database_state: &DatabaseState) -> Result<SyncResult, String> {
        // 初始化 WebDAV 客户端
        let webdav_config = crate::webdav::WebDAVConfig {
            url: config.server_url.clone(),
            username: config.username.clone(),
            password: config.password.clone(),
            path: config.path.clone(),
            timeout: config.timeout,
        };

        let mut client = self.webdav_client.lock().await;
        if let Err(e) = client.initialize(webdav_config).await {
            return Err(format!("WebDAV 客户端初始化失败: {}", e));
        }
        drop(client);

        // 转换并保存配置（统一保存到 SyncCore）
        let unified_config = self.convert_config(config.clone());
        self.config = Some(unified_config.clone());
        self.status = SyncStatus::Idle;

        // 同步配置到 SyncCore（统一配置入口）
        let sync_core = self.sync_core.clone();
        sync_core.lock().await.update_config(config.clone()).await;

        // 设置同步核心的回调
        let sync_core = self.sync_core.clone();
        let mut core = sync_core.lock().await;
        core.set_progress_callback(Box::new(|_progress| {
            // TODO: 更新进度
        }));
        core.set_error_callback(Box::new(|_error| {
            // TODO: 处理错误
        }));
        drop(core);

        // 清理孤儿缓存文件
        let file_sync_manager = self.file_sync_manager.clone();
        file_sync_manager.lock().await.cleanup_stale_cache_files(database_state).await;

        // 如果配置中启用了自动同步，启动它
        if config.auto_sync {
            self.start_auto_sync(config.auto_sync_interval_minutes, database_state).await?;
        }

        Ok(SyncResult {
            success: true,
            message: "✅ 初始化完成".to_string(),
        })
    }

    /// 启动同步引擎
    pub async fn start(&mut self) -> Result<SyncResult, String> {
        self.status = SyncStatus::Idle;
        Ok(SyncResult {
            success: true,
            message: "✅ 启动成功".to_string(),
        })
    }

    /// 停止同步引擎
    pub async fn stop(&mut self) -> Result<SyncResult, String> {
        // 停止自动同步
        let _ = self.stop_auto_sync().await;
        self.status = SyncStatus::Idle;
        Ok(SyncResult {
            success: true,
            message: "✅ 已停止".to_string(),
        })
    }

    /// 执行同步操作
    /// 委托给 SyncCore 执行，遵循清晰的数据流向
    pub async fn sync(&mut self, database_state: &DatabaseState) -> Result<SyncProcessResult, String> {
        let config = self.config.as_ref()
            .ok_or_else(|| "同步引擎未初始化，请先调用 init()".to_string())?;

        let sync_core = self.sync_core.clone();
        let mut core = sync_core.lock().await;

        self.status = SyncStatus::Syncing;
        let result = core.perform_sync(config.sync_mode.clone(), database_state).await;

        // 执行书签同步（只在主同步成功且有书签数据时）
        if let Ok(_) = &result {
            log::info!("🔄 执行书签同步...");
            let bookmark_sync_manager = self.bookmark_sync_manager.clone();
            let manager = bookmark_sync_manager.lock().await;

            // 检查是否有书签数据需要同步
            if manager.has_bookmark_data() {
                match manager.sync_bookmarks().await {
                    Ok(bookmark_result) => {
                        if bookmark_result.need_upload || bookmark_result.need_download {
                            log::info!("📚 书签同步: {}", bookmark_result.message);
                        } else {
                            log::info!("📚 书签数据无需同步");
                        }
                    }
                    Err(e) => {
                        log::warn!("⚠️ 书签同步失败: {}", e);
                        // 书签同步失败不影响主同步结果
                    }
                }
            } else {
                log::info!("📚 本地无书签数据，跳过书签同步");
            }
        }

        self.status = SyncStatus::Idle;

        result
    }

    /// 手动触发同步（同步真实剪贴板数据到云端）
    pub async fn trigger_with_data(
        &mut self,
        local_data: Option<Vec<crate::sync_core::SyncDataItem>>,
        database_state: &DatabaseState,
    ) -> Result<SyncResult, String> {
        // 加载本地数据到 DataManager
        if let Some(data) = local_data {
            let data_manager = self.data_manager.clone();
            let mut manager = data_manager.lock().await;
            manager.load_local_data(data).await;
        }

        match self.sync(database_state).await {
            Ok(process_result) => Ok(SyncResult {
                success: process_result.success,
                message: if process_result.success {
                    format!(
                        "✅ 同步完成",
                    )
                } else {
                    "❌ 同步失败".to_string()
                },
            }),
            Err(e) => Err(e),
        }
    }

    /// 启动自动同步
    pub async fn start_auto_sync(&mut self, interval_minutes: u64, database_state: &DatabaseState) -> Result<SyncResult, String> {
        let auto_sync_manager = self.auto_sync_manager.clone();
        let mut manager = auto_sync_manager.lock().await;

        // 设置自动同步回调（统一从 SyncCore 获取配置）
        let sync_core = self.sync_core.clone();
        let database_state_clone = database_state.clone();
        manager.set_sync_callback(Box::new(move || {
            let sync_core = sync_core.clone();
            let database_state = database_state_clone.clone();
            tauri::async_runtime::spawn(async move {
                let mut core = sync_core.lock().await;
                // 从 SyncCore 统一配置入口获取同步模式
                let config = core.get_config().await;
                let mode_config = crate::sync_core::SyncModeConfig {
                    auto_sync: true,
                    auto_sync_interval_minutes: 60,
                    only_favorites: config.as_ref().map(|c| c.only_favorites).unwrap_or(false),
                    include_images: true,
                    include_files: config.as_ref().map(|c| c.include_files).unwrap_or(false),
                    content_types: crate::sync_core::ContentTypeConfig {
                        include_text: true,
                        include_html: true,
                        include_rtf: true,
                        include_markdown: true,
                    },
                    conflict_resolution: crate::sync_core::ConflictResolutionStrategy::Merge,
                    device_id: "device".to_string(),
                    previous_mode: None,
                };
                let _ = core.perform_sync(mode_config, &database_state).await;
            });
        }));

        if let Err(e) = manager.start(interval_minutes).await {
            return Err(e);
        }

        Ok(SyncResult {
            success: true,
            message: format!("✅ 自动同步已启动 ({}分钟)", interval_minutes),
        })
    }

    /// 停止自动同步
    pub async fn stop_auto_sync(&mut self) -> Result<SyncResult, String> {
        let auto_sync_manager = self.auto_sync_manager.clone();
        let mut manager = auto_sync_manager.lock().await;

        if let Err(e) = manager.stop().await {
            return Err(e);
        }

        Ok(SyncResult {
            success: true,
            message: "✅ 自动同步已停止".to_string(),
        })
    }

    /// 更新自动同步间隔
    pub async fn update_auto_sync_interval(&mut self, interval_minutes: u64) -> Result<SyncResult, String> {
        let auto_sync_manager = self.auto_sync_manager.clone();
        let mut manager = auto_sync_manager.lock().await;

        if let Err(e) = manager.update_interval(interval_minutes).await {
            return Err(e);
        }

        Ok(SyncResult {
            success: true,
            message: format!("✅ 同步间隔: {}分钟", interval_minutes),
        })
    }

    /// 获取自动同步状态
    pub fn get_auto_sync_status(&self) -> AutoSyncStatus {
        let manager = self.auto_sync_manager.blocking_lock();
        manager.get_status()
    }

    /// 获取状态
    pub fn get_status(&self) -> &SyncStatus {
        &self.status
    }

    /// 获取配置
    pub fn get_config(&self) -> Option<&UnifiedConfig> {
        self.config.as_ref()
    }

    /// 获取进度
    pub fn get_progress(&self) -> Option<&SyncProgress> {
        self.progress.as_ref()
    }

    /// 获取同步模式是否仅收藏
    pub fn get_sync_mode_only_favorites(&self) -> bool {
        self.config
            .as_ref()
            .map(|c| c.sync_mode.only_favorites)
            .unwrap_or(false)
    }

    /// 使用数据库状态执行同步
    /// 从数据库直接读取数据并执行同步流程
    pub async fn sync_with_database(
        &mut self,
        database_state: &DatabaseState,
        only_favorites: bool,
    ) -> Result<SyncProcessResult, String> {
        let config = self.config.as_ref()
            .ok_or_else(|| "同步引擎未初始化，请先调用 init()".to_string())?;

        let sync_core = self.sync_core.clone();
        let mut core = sync_core.lock().await;

        self.status = SyncStatus::Syncing;

        // 简化模式配置，只保留 only_favorites
        let mut mode_config = config.sync_mode.clone();
        mode_config.only_favorites = only_favorites;

        log::info!("🔄 开始执行同步... only_favorites={}", only_favorites);

        // 直接执行同步，让 perform_sync 负责所有数据库操作
        // 避免死锁：不要在调用 perform_sync 之前锁定 database_state
        let result = core.perform_sync(mode_config, database_state).await;

        // 执行书签同步（只在主同步成功且有书签数据时）
        if let Ok(_) = &result {
            log::info!("🔄 执行书签同步...");
            let bookmark_sync_manager = self.bookmark_sync_manager.clone();
            let manager = bookmark_sync_manager.lock().await;

            // 检查是否有书签数据需要同步
            if manager.has_bookmark_data() {
                match manager.sync_bookmarks().await {
                    Ok(bookmark_result) => {
                        if bookmark_result.need_upload || bookmark_result.need_download {
                            log::info!("📚 书签同步: {}", bookmark_result.message);
                        } else {
                            log::info!("📚 书签数据无需同步");
                        }
                    }
                    Err(e) => {
                        log::warn!("⚠️ 书签同步失败: {}", e);
                        // 书签同步失败不影响主同步结果
                    }
                }
            } else {
                log::info!("📚 本地无书签数据，跳过书签同步");
            }
        }

        self.status = SyncStatus::Idle;

        match &result {
            Ok(_) => log::info!("✅ 同步执行完成"),
            Err(e) => log::error!("❌ 同步执行失败: {}", e),
        }

        result
    }

    /// 上传单个文件
    pub async fn upload_file(&self, task: crate::file_sync_manager::FileUploadTask) -> Result<crate::file_sync_manager::FileOperationResult, String> {
        let file_sync_manager = self.file_sync_manager.clone();
        let manager = file_sync_manager.lock().await;
        manager.upload_file(task).await
    }

    /// 下载单个文件
    pub async fn download_file(&self, task: crate::file_sync_manager::FileDownloadTask) -> Result<crate::file_sync_manager::FileOperationResult, String> {
        let file_sync_manager = self.file_sync_manager.clone();
        let manager = file_sync_manager.lock().await;
        manager.download_file(task).await
    }

    /// 删除单个文件
    pub async fn delete_file(&self, file_id: String, remote_path: String) -> Result<crate::file_sync_manager::FileOperationResult, String> {
        let file_sync_manager = self.file_sync_manager.clone();
        let manager = file_sync_manager.lock().await;
        manager.delete_file(file_id, remote_path).await
    }

    /// 批量文件同步
    pub async fn sync_file_batch(&mut self, batch: crate::file_sync_manager::FileSyncBatch) -> Result<crate::file_sync_manager::FileOperationResult, String> {
        let file_sync_manager = self.file_sync_manager.clone();
        let mut manager = file_sync_manager.lock().await;
        manager.sync_file_batch(batch).await
    }

    /// 批量删除文件
    pub async fn delete_files(&self, file_ids: Vec<String>, remote_paths: Vec<String>) -> Result<crate::file_sync_manager::FileOperationResult, String> {
        let file_sync_manager = self.file_sync_manager.clone();
        let manager = file_sync_manager.lock().await;
        manager.delete_files(file_ids, remote_paths).await
    }

    /// 获取文件同步配置
    pub fn get_file_sync_config(&self) -> crate::file_sync_manager::FileSyncConfig {
        let manager = self.file_sync_manager.blocking_lock();
        manager.get_config().clone()
    }

    /// 更新文件同步配置
    pub async fn update_file_sync_config(&mut self, config: crate::file_sync_manager::FileSyncConfig) {
        let file_sync_manager = self.file_sync_manager.clone();
        let mut manager = file_sync_manager.lock().await;
        manager.update_config(config);
    }

    /// 将老配置转换为统一配置
    fn convert_config(&self, old_config: SyncConfig) -> UnifiedConfig {
        UnifiedConfig {
            server_url: old_config.server_url,
            auto_sync: old_config.auto_sync,
            auto_sync_interval_minutes: old_config.auto_sync_interval_minutes,
            sync_mode: SyncModeConfig {
                auto_sync: old_config.auto_sync,
                auto_sync_interval_minutes: old_config.auto_sync_interval_minutes,
                only_favorites: old_config.only_favorites,
                include_images: old_config.include_files, // 使用 include_files 作为 include_images 的值
                include_files: old_config.include_files,
                content_types: crate::sync_core::ContentTypeConfig {
                    include_text: true,
                    include_html: true,
                    include_rtf: true,
                    include_markdown: true,
                },
                conflict_resolution: crate::sync_core::ConflictResolutionStrategy::Merge,
                device_id: "device".to_string(), // TODO: 生成设备ID
                previous_mode: None,
            },
        }
    }

    /// 上传本地配置到云端
    pub async fn upload_local_config(&self) -> Result<SyncResult, String> {
        let config_sync_manager = self.config_sync_manager.lock().await;

        match config_sync_manager.upload_local_config().await {
            Ok(result) => Ok(SyncResult {
                success: result.success,
                message: result.message,
            }),
            Err(e) => Err(e),
        }
    }

    /// 应用云端配置
    pub async fn apply_remote_config(&self) -> Result<SyncResult, String> {
        let config_sync_manager = self.config_sync_manager.lock().await;

        match config_sync_manager.apply_remote_config().await {
            Ok(result) => Ok(SyncResult {
                success: result.success,
                message: result.message,
            }),
            Err(e) => Err(e),
        }
    }

    /// 设置书签同步数据
    pub async fn set_bookmark_sync_data(&mut self, bookmark_data: crate::bookmark_sync_manager::BookmarkSyncData) {
        let mut bookmark_sync_manager = self.bookmark_sync_manager.lock().await;
        bookmark_sync_manager.set_local_data(bookmark_data);
    }

    /// 执行书签同步
    pub async fn sync_bookmarks(&self) -> Result<SyncResult, String> {
        let bookmark_sync_manager = self.bookmark_sync_manager.lock().await;

        match bookmark_sync_manager.sync_bookmarks().await {
            Ok(result) => Ok(SyncResult {
                success: result.success,
                message: result.message,
            }),
            Err(e) => Err(e),
        }
    }

    /// 下载书签数据
    pub async fn download_bookmarks(&self) -> Result<SyncResult, String> {
        let bookmark_sync_manager = self.bookmark_sync_manager.lock().await;

        match bookmark_sync_manager.download_bookmarks().await {
            Ok(Some(_data)) => Ok(SyncResult {
                success: true,
                message: "书签数据下载成功".to_string(),
            }),
            Ok(None) => Ok(SyncResult {
                success: true,
                message: "云端无书签数据".to_string(),
            }),
            Err(e) => Err(e),
        }
    }
}

/// 创建共享的同步引擎实例
pub fn create_shared_engine(
    webdav_client: WebDAVClientState,
    auto_sync_manager: AutoSyncManagerState,
) -> Arc<Mutex<CloudSyncEngine>> {
    Arc::new(Mutex::new(CloudSyncEngine::new(
        webdav_client,
        auto_sync_manager,
    )))
}
