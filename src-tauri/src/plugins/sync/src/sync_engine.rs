//! 云同步引擎
//! 协调各子模块，实现清晰的数据流向和职责分离

use crate::auto_sync_manager::AutoSyncManagerState;
use crate::bookmark_sync_manager::{BookmarkSyncData, BookmarkSyncManager};
use crate::commands::load_bookmark_data_local;
use crate::config_sync_manager::ConfigSyncManager;
use crate::data_manager::{create_shared_manager as create_data_manager, DataManager};
use crate::file_sync_manager::{
    create_shared_manager as create_file_sync_manager, FileSyncManager,
};
use crate::sync_core::{SyncCore, SyncModeConfig, SyncProcessResult};
use crate::types::*;
use crate::webdav::WebDAVClientState;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_eco_common::server_config::{get_last_sync_time, update_last_sync_time};
use tauri_plugin_eco_database::DatabaseState;
use tokio::sync::Mutex;

/// 云同步引擎
/// 专注于协调各子模块，不包含具体同步逻辑
/// 实现清晰的数据流向：CloudSyncEngine -> SyncCore -> DataManager/FileSyncManager
#[derive(Clone)]
pub struct CloudSyncEngine {
    /// 当前状态
    pub status: SyncStatus,
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
    pub fn new<R: Runtime>(
        webdav_client: WebDAVClientState,
        auto_sync_manager: AutoSyncManagerState,
        app_handle: &AppHandle<R>,
    ) -> Self {
        let data_manager = create_data_manager();
        let file_sync_manager = create_file_sync_manager(webdav_client.clone());
        let sync_core = Arc::new(Mutex::new(SyncCore::new(
            webdav_client.clone(),
            data_manager.clone(),
            file_sync_manager.clone(),
        )));
        let config_sync_manager = Arc::new(Mutex::new(ConfigSyncManager::new(
            webdav_client.clone(),
            app_handle,
        )));
        let device_id = "device-".to_string() + &chrono::Utc::now().timestamp_millis().to_string();
        let bookmark_sync_manager = Arc::new(Mutex::new(BookmarkSyncManager::new(
            webdav_client.clone(),
            device_id,
        )));

        Self {
            status: SyncStatus::Idle,
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
    pub async fn init<T: Runtime>(
        &mut self,
        config: SyncConfig,
        database_state: &DatabaseState,
        app_handle: &AppHandle<T>,
    ) -> Result<SyncResult, String> {
        // 提取需要的配置字段
        let auto_sync = config.auto_sync;
        let auto_sync_interval = config.auto_sync_interval_minutes;

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

        self.status = SyncStatus::Idle;

        // 从缓存读取同步时间
        let cached_sync_time = get_last_sync_time();
        {
            let mut auto_sync_manager = self.auto_sync_manager.lock().await;
            auto_sync_manager.set_last_sync_time(cached_sync_time);
        }

        // 同步配置到 SyncCore（统一配置入口）
        {
            let core = self.sync_core.lock().await;
            core.update_config(config).await;
        }

        // 如果配置中启用了自动同步，启动它
        if auto_sync {
            self.start_auto_sync(auto_sync_interval, database_state, app_handle)
                .await?;
        }

        Ok(SyncResult {
            success: true,
            message: "初始化完成".to_string(),
        })
    }

    /// 启动自动同步
    pub async fn start_auto_sync<T: Runtime>(
        &mut self,
        interval_minutes: u64,
        database_state: &DatabaseState,
        app_handle: &AppHandle<T>,
    ) -> Result<SyncResult, String> {
        let auto_sync_manager = self.auto_sync_manager.clone();
        let mut manager = auto_sync_manager.lock().await;

        // 从 SyncCore 获取同步参数
        let config = {
            let core = self.sync_core.lock().await;
            core.get_config().await
        };
        let only_favorites = config.as_ref().map(|c| c.only_favorites).unwrap_or(false);
        let include_files = config.as_ref().map(|c| c.include_files).unwrap_or(false);

        // 设置自动同步回调
        let sync_engine_clone = self.clone();
        let database_state_clone = database_state.clone();
        let app_handle_clone = app_handle.clone();
        manager.set_sync_callback(Box::new(move || {
            let mut engine = sync_engine_clone.clone();
            let database_state = database_state_clone.clone();
            let app_handle = app_handle_clone.clone();
            tauri::async_runtime::spawn(async move {
                // 使用 sync_with_database 执行完整同步流程（包含书签同步和事件通知）
                let _ = engine
                    .sync_with_database(&database_state, only_favorites, include_files, &app_handle)
                    .await;
            });
        }));

        if let Err(e) = manager.start(interval_minutes).await {
            return Err(e);
        }

        // 释放锁后再执行同步，避免死锁
        drop(manager);

        // 立即执行一次同步
        let mut sync_engine_clone = self.clone();
        let database_state_clone = database_state.clone();
        let app_handle_clone = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let _ = sync_engine_clone
                .sync_with_database(
                    &database_state_clone,
                    only_favorites,
                    include_files,
                    &app_handle_clone,
                )
                .await;
        });

        Ok(SyncResult {
            success: true,
            message: format!("自动同步已启动 ({}分钟)", interval_minutes),
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
            message: "自动同步已停止".to_string(),
        })
    }

    /// 更新自动同步间隔
    pub async fn update_auto_sync_interval(
        &mut self,
        interval_minutes: u64,
    ) -> Result<SyncResult, String> {
        let auto_sync_manager = self.auto_sync_manager.clone();
        let mut manager = auto_sync_manager.lock().await;

        if let Err(e) = manager.update_interval(interval_minutes).await {
            return Err(e);
        }

        Ok(SyncResult {
            success: true,
            message: format!("同步间隔: {}分钟", interval_minutes),
        })
    }

    /// 获取自动同步状态
    pub async fn get_auto_sync_status(&self) -> AutoSyncStatus {
        let manager = self.auto_sync_manager.lock().await;
        manager.get_status()
    }

    /// 获取状态
    pub fn get_status(&self) -> &SyncStatus {
        &self.status
    }

    /// 获取配置（委托给 SyncCore）
    pub async fn get_config(&self) -> Option<SyncConfig> {
        let core = self.sync_core.lock().await;
        core.get_config().await
    }

    /// 使用数据库状态执行同步
    /// 从数据库直接读取数据并执行同步流程
    pub async fn sync_with_database<T: Runtime>(
        &mut self,
        database_state: &DatabaseState,
        only_favorites: bool,
        include_files: bool,
        app_handle: &AppHandle<T>,
    ) -> Result<SyncProcessResult, String> {
        // 从 SyncCore 获取配置
        let config = {
            let core = self.sync_core.lock().await;
            core.get_config().await
        };
        let config = match config {
            Some(cfg) => cfg,
            None => {
                return Err("同步引擎未初始化，请先调用 init()".to_string());
            }
        };

        let sync_core = self.sync_core.clone();
        let mut core = sync_core.lock().await;

        self.status = SyncStatus::Syncing;

        // 构建模式配置
        let mode_config = SyncModeConfig {
            auto_sync: config.auto_sync,
            auto_sync_interval_minutes: config.auto_sync_interval_minutes,
            only_favorites,
            include_images: include_files, // 图片使用 include_files 配置
            include_files,
        };

        log::info!(
            "[Sync] 开始执行同步: only_favorites={}, include_files={}",
            only_favorites,
            include_files
        );

        // 直接执行同步，让 perform_sync 负责所有数据库操作
        let result = core
            .perform_sync(mode_config, database_state, app_handle)
            .await;

        // 执行书签同步（只在主同步成功时）
        if result.is_ok() {
            log::info!("[Bookmark] 开始同步...");

            // 先加载本地书签数据
            match load_bookmark_data_local().await {
                Ok(bookmark_data) => {
                    let bookmark_sync_data = BookmarkSyncData {
                        groups: bookmark_data.groups,
                        time: bookmark_data.last_modified,
                    };
                    self.set_bookmark_sync_data(bookmark_sync_data).await;
                }
                Err(e) => {
                    log::warn!("[Bookmark] 加载本地数据失败: {}", e);
                }
            }

            // 再执行同步检查
            let bookmark_sync_manager = self.bookmark_sync_manager.clone();
            let manager = bookmark_sync_manager.lock().await;

            // 检查是否有书签数据需要同步
            if manager.has_bookmark_data() {
                drop(manager); // 释放锁，避免死锁
                match self.sync_bookmarks().await {
                    Ok(sync_result) => {
                        if sync_result.success {
                            log::info!("[Bookmark] 同步完成");
                        } else {
                            log::warn!("[Bookmark] 同步失败");
                        }
                    }
                    Err(e) => {
                        log::warn!("[Bookmark] 同步失败: {}", e);
                    }
                }
            } else {
                log::info!("[Bookmark] 本地无数据，跳过同步");
            }
        }

        self.status = SyncStatus::Idle;

        // 同步完成后更新最后同步时间
        let auto_sync_manager = self.auto_sync_manager.clone();
        let mut manager = auto_sync_manager.lock().await;
        manager.update_sync_time();

        // 持久化同步时间到缓存
        if result.is_ok() {
            if let Some(last_sync_time) = manager.get_last_sync_time() {
                tauri::async_runtime::spawn(async move {
                    update_last_sync_time(last_sync_time);
                });
            }
        }

        match &result {
            Ok(_) => log::info!("[Sync] 执行完成"),
            Err(e) => log::error!("[Sync] 执行失败: {}", e),
        }

        result
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
    pub async fn set_bookmark_sync_data(
        &mut self,
        bookmark_data: crate::bookmark_sync_manager::BookmarkSyncData,
    ) {
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
pub fn create_shared_engine<R: tauri::Runtime>(
    webdav_client: WebDAVClientState,
    auto_sync_manager: AutoSyncManagerState,
    app_handle: &AppHandle<R>,
) -> Arc<Mutex<CloudSyncEngine>> {
    Arc::new(Mutex::new(CloudSyncEngine::new(
        webdav_client,
        auto_sync_manager,
        app_handle,
    )))
}
