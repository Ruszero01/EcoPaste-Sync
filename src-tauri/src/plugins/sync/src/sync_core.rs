//! 同步核心模块
//! 基于前端云同步引擎的经验教训，设计更robust的同步架构

use crate::data_manager::DataManager;
use crate::file_sync_manager::FileSyncManager;
use crate::types::*;
use crate::webdav::WebDAVClientState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri_plugin_eco_database::{DatabaseState, DeleteManager};
use tokio::sync::Mutex;

/// 类型别名：本地数据使用数据库模型
pub type LocalSyncDataItem = tauri_plugin_eco_database::SyncDataItem;

/// 重新导出类型别名，方便使用
pub use LocalSyncDataItem as SyncDataItem;

/// 同步模式配置
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
}

/// 同步结果
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
    /// 错误信息
    pub errors: Vec<String>,
    /// 耗时（毫秒）
    pub duration_ms: u64,
    /// 时间戳
    pub timestamp: i64,
}

/// 同步核心引擎
/// 专注于核心同步逻辑
pub struct SyncCore {
    /// WebDAV 客户端
    webdav_client: WebDAVClientState,
    /// 数据管理器
    pub data_manager: Arc<Mutex<DataManager>>,
    /// 文件同步管理器
    file_sync_manager: Arc<Mutex<FileSyncManager>>,
    /// 同步配置（统一配置入口）
    pub config: Arc<Mutex<Option<SyncConfig>>>,
    /// 是否正在同步
    sync_in_progress: bool,
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
            config: Arc::new(Mutex::new(None)),
            sync_in_progress: false,
        }
    }

    /// 更新配置
    pub async fn update_config(&self, config: SyncConfig) {
        let mut guard = self.config.lock().await;
        *guard = Some(config);
    }

    /// 获取配置
    pub async fn get_config(&self) -> Option<SyncConfig> {
        self.config.lock().await.clone()
    }

    /// 执行同步操作（优化后流程）
    /// 流程：获取云端索引 -> 处理索引删除 -> 获取本地数据 -> 双向同步 -> 处理文件
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

        log::info!("[Sync] 开始同步");

        let mut result = SyncProcessResult {
            success: false,
            uploaded_items: vec![],
            downloaded_items: vec![],
            deleted_items: vec![],
            errors: vec![],
            duration_ms: 0,
            timestamp: start_time,
        };

        // 获取云端索引
        let mut cloud_data = self.load_cloud_data().await.map_err(|e| {
            log::error!("获取云端索引失败: {}", e);
            e
        })?;

        // 处理索引删除
        let items_to_delete = self.calculate_items_to_delete(database_state).await;
        let mut files_to_delete = Vec::new();

        if !items_to_delete.is_empty() {
            match self
                .process_deletions(&items_to_delete, &cloud_data, database_state)
                .await
            {
                Ok((deleted_ids, deleted_files, updated_cloud)) => {
                    result.deleted_items.extend(deleted_ids.iter().cloned());
                    files_to_delete = deleted_files;
                    cloud_data = updated_cloud;
                    log::info!("[Sync] 删除 {} 项", deleted_ids.len());
                }
                Err(e) => {
                    result.errors.push(format!("删除失败: {}", e));
                    log::error!("[Sync] 删除失败: {}", e);
                }
            }
        }

        // 获取本地数据
        let local_data = self
            .load_local_data(database_state, &mode_config)
            .await
            .map_err(|e| {
                log::error!("获取本地数据失败: {}", e);
                e
            })?;

        // 数据比对
        let filtered_cloud = self.filter_cloud_data(&cloud_data, &mode_config);
        let local_ids: std::collections::HashSet<&str> =
            local_data.iter().map(|item| item.id.as_str()).collect();

        let items_to_download: Vec<String> = filtered_cloud
            .iter()
            .filter(|item| !local_ids.contains(item.id.as_str()))
            .map(|item| item.id.clone())
            .collect();

        // 上传本地数据
        if !local_data.is_empty() {
            match self
                .upload_local_changes(
                    &local_data.iter().map(|i| i.id.clone()).collect::<Vec<_>>(),
                    &cloud_data,
                    database_state,
                )
                .await
            {
                Ok(uploaded) => {
                    result.uploaded_items.extend(uploaded.iter().cloned());
                    log::info!("[Sync] 上传 {} 项", uploaded.len());
                }
                Err(e) => {
                    result.errors.push(format!("上传失败: {}", e));
                    log::error!("[Sync] 上传失败: {}", e);
                }
            }
        }

        // 下载云端数据
        if !items_to_download.is_empty() {
            match self
                .download_cloud_changes(&items_to_download, &cloud_data, database_state)
                .await
            {
                Ok(downloaded) => {
                    result.downloaded_items.extend(downloaded.iter().cloned());
                    log::info!("[Sync] 下载 {} 项", downloaded.len());
                }
                Err(e) => {
                    result.errors.push(format!("下载失败: {}", e));
                    log::error!("[Sync] 下载失败: {}", e);
                }
            }
        }

        // 更新本地同步状态
        {
            let db = database_state.lock().await;
            let tracker = db.get_change_tracker();
            let all_synced_items: Vec<String> = result
                .uploaded_items
                .iter()
                .chain(result.downloaded_items.iter())
                .cloned()
                .collect();
            let conn = db.get_connection()?;
            let _ = tracker.mark_items_synced(&conn, &all_synced_items);
        }

        // 处理文件同步
        self.process_file_sync(&local_data, database_state).await?;

        // 处理文件删除
        if !files_to_delete.is_empty() {
            self.process_file_deletions(&files_to_delete).await;
        }

        // 完成
        let end_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        result.success = result.errors.is_empty();
        result.duration_ms = (end_time - start_time) as u64;

        if result.success {
            if !result.uploaded_items.is_empty()
                || !result.downloaded_items.is_empty()
                || !result.deleted_items.is_empty()
            {
                log::info!(
                    "[Sync] 完成: 上传 {}，下载 {}，删除 {} ({}ms)",
                    result.uploaded_items.len(),
                    result.downloaded_items.len(),
                    result.deleted_items.len(),
                    result.duration_ms
                );
            } else {
                log::info!("[Sync] 完成，无变更 ({}ms)", result.duration_ms);
            }
        } else {
            log::error!("[Sync] 完成，有 {} 个错误", result.errors.len());
        }

        self.sync_in_progress = false;
        Ok(result)
    }

    /// 严格检查项目是否真的已同步（简化版）
    /// 移除冗余字段：直接比较核心字段
    fn is_item_actually_synced(
        &self,
        local_item: &SyncDataItem,
        cloud_item: &SyncDataItem,
    ) -> bool {
        // 只比较时间戳和核心元数据字段
        // 注意：不比较 value 字段，因为：
        // 1. 文件上传时，value 是原始路径（如 "G:/path/to/image.png"）
        // 2. 文件下载后，value 是缓存路径（如 "C:/Users/.../images/xxx.png"）
        // 3. 路径不同但内容相同，不应该重复上传
        // 4. 时间戳相同时，说明数据已经同步过

        // 基础字段匹配检查
        if local_item.item_type != cloud_item.item_type
            || local_item.favorite != cloud_item.favorite
            || local_item.note != cloud_item.note
        {
            return false;
        }

        // 时间戳检查（核心判断依据）
        if local_item.time != cloud_item.time {
            return false;
        }

        // 对于文件类型，可以额外比较 checksum（如果有的话）
        // 但对于简单同步，时间戳已经足够
        true
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

    /// 加载本地待同步数据
    async fn load_local_data(
        &self,
        database_state: &DatabaseState,
        mode_config: &SyncModeConfig,
    ) -> Result<Vec<SyncDataItem>, String> {
        let db = database_state.lock().await;

        let content_types = tauri_plugin_eco_database::ContentTypeFilter {
            include_text: true,
            include_html: true,
            include_rtf: true,
            include_images: mode_config.include_images,
            include_files: mode_config.include_files,
        };
        let sync_status_filter = None;

        let sync_items = match db.query_for_sync(
            mode_config.only_favorites,
            mode_config.include_images,
            mode_config.include_files,
            content_types,
            sync_status_filter,
        ) {
            Ok(items) => items,
            Err(e) => {
                log::error!("[Sync] 查询待同步数据失败: {}", e);
                let mut manager = self.data_manager.lock().await;
                manager.load_local_data(vec![]).await;
                return Err(e);
            }
        };

        let mut manager = self.data_manager.lock().await;
        manager.load_local_data(sync_items.clone()).await;

        log::info!("[Sync] 待同步: {} 项", sync_items.len());
        Ok(sync_items)
    }

    /// 加载云端数据
    async fn load_cloud_data(&self) -> Result<Vec<SyncDataItem>, String> {
        let webdav_client = self.webdav_client.clone();
        let data_manager = self.data_manager.clone();

        let client = webdav_client.lock().await;
        match client.download_sync_data("sync-data.json").await {
            Ok(result) => {
                let cloud_data = if let Some(data) = result.data {
                    let cloud_items: Vec<SyncDataItem> = serde_json::from_str(&data)
                        .map_err(|e| format!("解析云端数据失败: {}", e))?;

                    let mut manager = data_manager.lock().await;
                    manager.load_cloud_data(cloud_items.clone()).await;

                    log::info!("[Sync] 云端: {} 项", cloud_items.len());
                    cloud_items
                } else {
                    let mut manager = data_manager.lock().await;
                    manager.load_cloud_data(vec![]).await;
                    vec![]
                };

                Ok(cloud_data)
            }
            Err(e) => {
                log::error!("[Sync] 下载云端数据失败: {}", e);
                Err(format!("下载云端数据失败: {}", e))
            }
        }
    }

    /// 根据同步模式筛选云端数据
    /// 用于数据比对时减少遍历量
    fn filter_cloud_data(
        &self,
        data: &[SyncDataItem],
        mode_config: &SyncModeConfig,
    ) -> Vec<SyncDataItem> {
        data.iter()
            .filter(|item| {
                // 收藏模式检查
                if mode_config.only_favorites && !item.favorite {
                    return false;
                }

                // 内容类型检查（默认包含所有文本类型）
                match item.item_type.as_str() {
                    "text" => true,
                    "formatted" => true,
                    "markdown" => true,
                    "image" => mode_config.include_images,
                    "files" => mode_config.include_files,
                    _ => true,
                }
            })
            .cloned()
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
            params: None,
        };

        match db.query_history(options) {
            Ok(items) => {
                log::info!("[Sync] 本地软删除: {} 项", items.len());
                items.into_iter().map(|item| item.id).collect()
            }
            Err(e) => {
                log::error!("[Sync] 查询软删除项目失败: {}", e);
                vec![]
            }
        }
    }

    /// 处理文件同步
    async fn process_file_sync(
        &self,
        local_data: &[SyncDataItem],
        database_state: &DatabaseState,
    ) -> Result<(), String> {
        let file_items: Vec<_> = local_data
            .iter()
            .filter(|item| item.item_type == "image" || item.item_type == "files")
            .collect();

        if file_items.is_empty() {
            return Ok(());
        }

        let file_sync_manager = self.file_sync_manager.clone();
        let file_manager = file_sync_manager.lock().await;

        let cache_dir = file_manager
            .get_cache_dir()
            .await
            .map_err(|e| format!("获取缓存目录失败: {}", e))?;

        let images_cache_dir = cache_dir.join("images");
        let files_cache_dir = cache_dir.join("files");

        tokio::fs::create_dir_all(&images_cache_dir)
            .await
            .map_err(|e| format!("创建图片缓存目录失败: {}", e))?;
        tokio::fs::create_dir_all(&files_cache_dir)
            .await
            .map_err(|e| format!("创建文件缓存目录失败: {}", e))?;

        let mut upload_tasks = Vec::new();
        let mut download_tasks: Vec<(
            String,
            crate::file_sync_manager::FileDownloadTask,
            std::path::PathBuf,
        )> = Vec::new();

        for item in &file_items {
            if let Some(value) = &item.value {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                    if parsed.get("checksum").is_some() {
                        let remote_path = parsed
                            .get("remotePath")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        let file_name_with_id =
                            remote_path.rsplitn(2, '/').next().unwrap_or("unknown");

                        let original_file_name = file_name_with_id
                            .strip_prefix(&item.id)
                            .map(|s| s.strip_prefix('_').unwrap_or(s))
                            .unwrap_or(file_name_with_id);

                        let checksum = parsed
                            .get("checksum")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        if !remote_path.is_empty() {
                            let cache_subdir = if item.item_type == "image" {
                                &images_cache_dir
                            } else {
                                &files_cache_dir
                            };

                            let local_path = cache_subdir.join(original_file_name);

                            let metadata = crate::file_sync_manager::FileMetadata {
                                id: item.id.clone(),
                                file_name: original_file_name.to_string(),
                                original_path: None,
                                remote_path: remote_path.to_string(),
                                size: parsed.get("fileSize").and_then(|v| v.as_u64()).unwrap_or(0),
                                time: item.time,
                                checksum: Some(checksum.to_string()),
                                mime_type: None,
                                width: parsed
                                    .get("width")
                                    .and_then(|v| v.as_u64())
                                    .map(|v| v as u32),
                                height: parsed
                                    .get("height")
                                    .and_then(|v| v.as_u64())
                                    .map(|v| v as u32),
                            };

                            let task = crate::file_sync_manager::FileDownloadTask {
                                metadata,
                                local_path: local_path.clone(),
                                remote_path: remote_path.to_string(),
                            };

                            download_tasks.push((item.id.clone(), task, local_path.clone()));
                        }
                    }
                } else {
                    let file_paths = crate::file_sync_manager::parse_file_paths_from_value(value);
                    for file_path in file_paths {
                        if file_path.exists() {
                            let file_name = file_path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("unknown");

                            let file_checksum =
                                match crate::file_sync_manager::calculate_file_checksum(&file_path)
                                    .await
                                {
                                    Ok(hash) => Some(hash),
                                    Err(e) => {
                                        log::warn!("[File] 计算哈希失败: {} ({})", file_name, e);
                                        None
                                    }
                                };

                            let remote_path = format!("files/{}_{}", item.id, file_name);
                            let metadata = crate::file_sync_manager::build_metadata_for_upload(
                                &item.id,
                                item.time,
                                &file_path,
                                file_checksum.clone(),
                            );

                            upload_tasks.push(crate::file_sync_manager::FileUploadTask {
                                metadata,
                                local_path: file_path.clone(),
                                remote_path,
                            });
                        }
                    }
                }
            }
        }

        // 执行上传任务
        for task in upload_tasks {
            if let Err(e) = file_manager.upload_file(task).await {
                log::error!("[File] 上传失败: {}", e);
            }
        }

        // 执行下载任务
        for (item_id, task, local_path) in download_tasks {
            match file_manager.download_file(task).await {
                Ok(result) => {
                    if result.success {
                        let db = database_state.lock().await;
                        if let Err(e) = db
                            .update_item_value(&item_id, &local_path.to_string_lossy().to_string())
                        {
                            log::error!("[File] 更新路径失败: {}", e);
                        }
                    } else {
                        log::error!("[File] 下载失败: {:?}", result.errors);
                    }
                }
                Err(e) => {
                    log::error!("[File] 下载异常: {}", e);
                }
            }
        }

        Ok(())
    }

    /// 处理文件删除
    async fn process_file_deletions(&self, remote_paths: &[String]) {
        if remote_paths.is_empty() {
            return;
        }

        let file_sync_manager = self.file_sync_manager.clone();
        let manager = file_sync_manager.lock().await;

        for remote_path in remote_paths {
            let _ = manager
                .delete_file(String::new(), remote_path.clone())
                .await;
        }
    }

    /// 上传本地变更
    async fn upload_local_changes(
        &self,
        items: &[String],
        cloud_data: &[SyncDataItem],
        database_state: &DatabaseState,
    ) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        let webdav_client = self.webdav_client.clone();
        let data_manager = self.data_manager.clone();
        let file_sync_manager = self.file_sync_manager.clone();

        let local_data = {
            let manager = data_manager.lock().await;
            manager.get_local_data().to_vec()
        };

        let mut merged_items = cloud_data.to_vec();
        let mut actually_uploaded = Vec::new();
        let mut file_items_to_upload = Vec::new();

        for item_id in items {
            if let Some(local_item) = local_data.iter().find(|i| i.id == *item_id) {
                let cloud_item = cloud_data.iter().find(|i| i.id == *item_id);

                let needs_upload = if let Some(cloud) = cloud_item {
                    !self.is_item_actually_synced(local_item, cloud)
                } else {
                    true
                };

                if needs_upload {
                    if let Some(pos) = merged_items.iter().position(|i| i.id == *item_id) {
                        merged_items[pos] = local_item.clone();
                    } else {
                        merged_items.push(local_item.clone());
                    }
                    actually_uploaded.push(item_id.clone());

                    if local_item.item_type == "image" || local_item.item_type == "files" {
                        file_items_to_upload.push(local_item.clone());
                    }
                }
            }
        }

        if actually_uploaded.is_empty() {
            return Ok(vec![]);
        }

        // 上传文件/图片到云端
        if !file_items_to_upload.is_empty() {
            let file_sync_manager_locked = file_sync_manager.lock().await;
            let mut uploaded_file_metadata: Vec<(String, serde_json::Value)> = Vec::new();

            for file_item in &file_items_to_upload {
                if let Some(value) = &file_item.value {
                    let Some(file_path_buf) =
                        crate::file_sync_manager::extract_first_file_path(value)
                    else {
                        continue;
                    };

                    if !file_path_buf.exists() {
                        continue;
                    }

                    let file_name = file_path_buf
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown");

                    let file_checksum =
                        match crate::file_sync_manager::calculate_file_checksum(&file_path_buf)
                            .await
                        {
                            Ok(hash) => Some(hash),
                            Err(e) => {
                                log::warn!("[File] 计算哈希失败: {} ({})", file_name, e);
                                None
                            }
                        };

                    let _remote_path = format!("files/{}_{}", file_item.id, file_name);
                    let metadata = crate::file_sync_manager::build_metadata_for_upload(
                        &file_item.id,
                        file_item.time,
                        &file_path_buf,
                        file_checksum.clone(),
                    );

                    let upload_task = crate::file_sync_manager::FileUploadTask {
                        metadata,
                        local_path: file_path_buf.clone(),
                        remote_path: format!("files/{}_{}", file_item.id, file_name),
                    };

                    match file_sync_manager_locked.upload_file(upload_task).await {
                        Ok(result) => {
                            if result.success {
                                let mut metadata_map = serde_json::Map::new();
                                metadata_map.insert(
                                    "remotePath".to_string(),
                                    serde_json::Value::String(format!(
                                        "files/{}_{}",
                                        file_item.id, file_name
                                    )),
                                );

                                if let Some(ref checksum) = &file_checksum {
                                    metadata_map.insert(
                                        "checksum".to_string(),
                                        serde_json::Value::String(checksum.clone()),
                                    );
                                }

                                if let Ok(metadata) = std::fs::metadata(&file_path_buf) {
                                    if let Ok(file_size_val) = u32::try_from(metadata.len()) {
                                        metadata_map.insert(
                                            "fileSize".to_string(),
                                            serde_json::Value::Number(file_size_val.into()),
                                        );
                                    }
                                }

                                if file_item.item_type == "image" {
                                    let db = database_state.lock().await;
                                    let conn = db.get_connection().ok();
                                    if let Some(ref conn) = conn {
                                        let query = format!(
                                            "SELECT width, height FROM history WHERE id = '{}'",
                                            file_item.id.replace("'", "''")
                                        );
                                        if let Ok(mut rows) = conn.prepare(&query) {
                                            if let Ok(row_iter) = rows.query_map([], |row| {
                                                Ok((
                                                    row.get::<usize, i32>(0)?,
                                                    row.get::<usize, i32>(1)?,
                                                ))
                                            }) {
                                                for result in row_iter {
                                                    if let Ok((width, height)) = result {
                                                        metadata_map.insert(
                                                            "width".to_string(),
                                                            serde_json::Value::Number(
                                                                serde_json::Number::from(width),
                                                            ),
                                                        );
                                                        metadata_map.insert(
                                                            "height".to_string(),
                                                            serde_json::Value::Number(
                                                                serde_json::Number::from(height),
                                                            ),
                                                        );
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                let file_metadata = serde_json::Value::Object(metadata_map);
                                uploaded_file_metadata.push((file_item.id.clone(), file_metadata));
                            }
                        }
                        Err(e) => {
                            log::error!("[File] 上传失败: {}", e);
                        }
                    }
                }
            }

            for (item_id, metadata) in uploaded_file_metadata {
                if let Some(item) = merged_items.iter_mut().find(|i| i.id == item_id) {
                    item.value =
                        Some(serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string()));
                }
            }
        }

        let sync_json = serde_json::to_string(&merged_items)
            .map_err(|e| format!("序列化同步数据失败: {}", e))?;

        let client = webdav_client.lock().await;
        match client.upload_sync_data("sync-data.json", &sync_json).await {
            Ok(_) => {
                let db = database_state.lock().await;
                let tracker = db.get_change_tracker();
                let conn = db.get_connection()?;
                if let Err(e) = tracker.mark_items_synced(&conn, &actually_uploaded) {
                    log::error!("[Sync] 标记同步状态失败: {}", e);
                }
                Ok(actually_uploaded)
            }
            Err(e) => {
                log::error!("[Sync] 上传同步数据失败: {}", e);
                let db = database_state.lock().await;
                let tracker = db.get_change_tracker();
                let conn = db.get_connection()?;
                for item_id in items {
                    if let Err(err) = tracker.mark_item_changed(&conn, item_id, "upload_failed") {
                        log::error!("[Sync] 标记变更失败: {}", err);
                    }
                }
                Err(e)
            }
        }
    }

    /// 下载云端变更
    async fn download_cloud_changes(
        &self,
        items: &[String],
        cloud_data: &[SyncDataItem],
        database_state: &DatabaseState,
    ) -> Result<Vec<String>, String> {
        if items.is_empty() {
            return Ok(vec![]);
        }

        let mut downloaded_items = Vec::new();
        let data_manager = self.data_manager.clone();

        let mut items_to_sync: Vec<SyncDataItem> = Vec::new();

        for item_id in items {
            if let Some(cloud_item) = cloud_data.iter().find(|i| i.id == *item_id) {
                let mut db_item = cloud_item.clone();
                db_item.time = chrono::Utc::now().timestamp_millis();

                let db = database_state.lock().await;
                if let Err(e) = db.upsert_from_cloud(&db_item) {
                    log::error!("[Sync] 保存云端数据失败: {}", e);
                }
                drop(db);

                items_to_sync.push(db_item);
                downloaded_items.push(item_id.clone());
            }
        }

        {
            let mut manager = data_manager.lock().await;
            manager.load_cloud_data(cloud_data.to_vec()).await;
        }

        if !items_to_sync.is_empty() {
            if let Err(e) = self.process_file_sync(&items_to_sync, database_state).await {
                log::error!("[File] 同步失败: {}", e);
            }
        }

        Ok(downloaded_items)
    }

    /// 处理删除操作
    async fn process_deletions(
        &self,
        items: &[String],
        cloud_data: &[SyncDataItem],
        database_state: &DatabaseState,
    ) -> Result<(Vec<String>, Vec<String>, Vec<SyncDataItem>), String> {
        if items.is_empty() {
            return Ok((vec![], vec![], cloud_data.to_vec()));
        }

        let mut deleted_ids = Vec::new();
        let mut files_to_delete: Vec<String> = Vec::new();
        let mut updated_cloud_data = cloud_data.to_vec();

        let synced_deleted_items = items.to_vec();

        if !synced_deleted_items.is_empty() {
            for item in cloud_data.iter() {
                if synced_deleted_items.contains(&item.id) {
                    if item.item_type == "image" || item.item_type == "files" {
                        if let Some(ref value) = item.value {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                                if let Some(remote_path) =
                                    parsed.get("remotePath").and_then(|v| v.as_str())
                                {
                                    files_to_delete.push(remote_path.to_string());
                                }
                            }
                        }
                    }
                }
            }

            let webdav_client = self.webdav_client.clone();
            let client = webdav_client.lock().await;

            let original_count = updated_cloud_data.len();
            updated_cloud_data.retain(|item| !synced_deleted_items.contains(&item.id));

            if updated_cloud_data.len() < original_count {
                let updated_json = serde_json::to_string(&updated_cloud_data)
                    .map_err(|e| format!("序列化删除数据失败: {}", e))?;

                if let Err(e) = client
                    .upload_sync_data("sync-data.json", &updated_json)
                    .await
                {
                    return Err(format!("更新云端索引失败: {}", e));
                }
            }
            drop(client);
        }

        let mut db = database_state.lock().await;
        match DeleteManager::batch_hard_delete(&mut *db, &synced_deleted_items) {
            Ok(_) => {
                deleted_ids = synced_deleted_items.clone();
            }
            Err(e) => {
                log::error!("本地硬删除失败: {}", e);
            }
        }
        drop(db);

        {
            let mut data_manager = self.data_manager.lock().await;
            data_manager.remove_deleted_items(&synced_deleted_items);
        }

        Ok((deleted_ids, files_to_delete, updated_cloud_data))
    }
}
