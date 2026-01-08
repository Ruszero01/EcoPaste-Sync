//! 文件同步管理器模块
//! 负责图片、文件等大数据的同步，包括上传、下载、删除操作
//! 基于前端经验教训，设计更robust的文件同步策略
//!
//! 前端踩坑经验总结及解决方案：
//! 1. 重复上传 - 使用固定文件路径，基于item_id生成唯一路径避免重复上传
//! 2. 文件丢失 - 统一使用缓存目录，确保文件可恢复
//! 3. 路径无效 - 原始路径无效时自动切换到缓存目录
//! 4. 批量操作混乱 - 统一文件包处理逻辑，避免分散处理
//! 5. 删除遗漏 - 完整的删除流程，确保云端文件被正确删除

use crate::webdav::WebDAVClientState;
use md5;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

/// 文件元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    /// 文件ID
    pub id: String,
    /// 文件名
    pub file_name: String,
    /// 原始路径
    pub original_path: Option<PathBuf>,
    /// 远程路径
    pub remote_path: String,
    /// 文件大小（字节）
    pub size: u64,
    /// 时间戳
    pub time: i64,
    /// 文件校验和
    pub checksum: Option<String>,
    /// MIME类型
    pub mime_type: Option<String>,
    /// 图片宽度（仅图片类型）
    pub width: Option<u32>,
    /// 图片高度（仅图片类型）
    pub height: Option<u32>,
}

/// 计算文件的MD5哈希值
/// 用于文件去重和变更检测
pub async fn calculate_file_checksum(file_path: &PathBuf) -> Result<String, String> {
    let mut file = tokio::fs::File::open(file_path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;

    let mut context = md5::Context::new();
    let mut buffer = vec![0u8; 8192]; // 8KB buffer

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("读取文件失败: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        context.consume(&buffer[..bytes_read]);
    }

    let result = context.compute();
    Ok(format!("{:x}", result))
}

/// 从 sync item 的 value 字段解析文件路径
/// 支持 JSON 数组格式 ["path1", "path2"] 和直接字符串格式 "path"
pub fn parse_file_paths_from_value(value: &str) -> Vec<std::path::PathBuf> {
    if value.starts_with('[') {
        if let Ok(paths) = serde_json::from_str::<Vec<String>>(value) {
            return paths
                .into_iter()
                .map(std::path::PathBuf::from)
                .filter(|p| !p.to_string_lossy().is_empty())
                .collect();
        }
    }
    vec![std::path::PathBuf::from(value)]
}

/// 从 value 字段提取第一个文件路径（用于上传）
pub fn extract_first_file_path(value: &str) -> Option<std::path::PathBuf> {
    let paths = parse_file_paths_from_value(value);
    paths
        .into_iter()
        .next()
        .filter(|p| !p.to_string_lossy().is_empty())
}

/// 从本地文件路径构建上传任务的元数据
pub fn build_metadata_for_upload(
    item_id: &str,
    time: i64,
    local_path: &std::path::PathBuf,
    file_checksum: Option<String>,
) -> FileMetadata {
    let file_name = local_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let remote_path = format!("files/{}_{}", item_id, file_name);

    FileMetadata {
        id: item_id.to_string(),
        file_name: file_name.to_string(),
        original_path: Some(local_path.clone()),
        remote_path,
        size: 0,
        time,
        checksum: file_checksum,
        mime_type: None,
        width: None,
        height: None,
    }
}

/// 文件上传任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileUploadTask {
    /// 文件元数据
    pub metadata: FileMetadata,
    /// 本地文件路径
    pub local_path: PathBuf,
    /// 远程目标路径
    pub remote_path: String,
}

/// 文件下载任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDownloadTask {
    /// 文件元数据
    pub metadata: FileMetadata,
    /// 本地目标路径
    pub local_path: PathBuf,
    /// 远程源路径
    pub remote_path: String,
}

/// 文件操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOperationResult {
    /// 是否成功
    pub success: bool,
    /// 涉及的文件ID列表
    pub file_ids: Vec<String>,
    /// 成功的文件数
    pub success_count: usize,
    /// 失败的文件数
    pub failed_count: usize,
    /// 总传输大小（字节）
    pub total_bytes: u64,
    /// 耗时（毫秒）
    pub duration_ms: u64,
    /// 错误信息
    pub errors: Vec<String>,
}

/// 文件同步配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSyncConfig {
    /// 最大文件大小（字节）
    pub max_file_size: u64,
    /// 超时时间（毫秒）
    pub timeout_ms: u64,
}

/// 文件同步管理器
/// 负责文件的上传、下载、删除等操作
pub struct FileSyncManager {
    /// WebDAV 客户端
    webdav_client: WebDAVClientState,
    /// 文件同步配置
    config: FileSyncConfig,
}

impl FileSyncManager {
    /// 创建新的文件同步管理器实例
    /// # Arguments
    /// * `webdav_client` - WebDAV 客户端
    /// * `config` - 文件同步配置
    pub fn new(webdav_client: WebDAVClientState, config: FileSyncConfig) -> Self {
        Self {
            webdav_client,
            config,
        }
    }

    /// 上传单个文件
    /// # Arguments
    /// * `task` - 文件上传任务
    pub async fn upload_file(&self, task: FileUploadTask) -> Result<FileOperationResult, String> {
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // 1. 验证文件
        if !task.local_path.exists() {
            return Ok(FileOperationResult {
                success: false,
                file_ids: vec![task.metadata.id],
                success_count: 0,
                failed_count: 1,
                total_bytes: 0,
                duration_ms: 0,
                errors: vec!["文件不存在".to_string()],
            });
        }

        // 检查文件大小
        if task.metadata.size > self.config.max_file_size {
            return Ok(FileOperationResult {
                success: false,
                file_ids: vec![task.metadata.id],
                success_count: 0,
                failed_count: 1,
                total_bytes: 0,
                duration_ms: 0,
                errors: vec!["文件大小超过限制".to_string()],
            });
        }

        // 简化：跳过 MIME 类型检查（配置已移除）
        // 2. 读取文件内容
        match tokio::fs::read(&task.local_path).await {
            Ok(file_data) => {
                log::info!("📤 上传文件: id={}, name={}, remote={}, local_size={}, metadata_size={}, checksum={}",
                    task.metadata.id, task.metadata.file_name, task.remote_path, file_data.len(),
                    task.metadata.size, task.metadata.checksum.as_deref().unwrap_or("none"));

                // 3. 上传到WebDAV
                let client = self.webdav_client.lock().await;
                match client.upload_file(&task.remote_path, &file_data).await {
                    Ok(upload_result) => {
                        let end_time = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis();

                        log::info!(
                            "📤 上传结果: id={}, success={}, response_size={}, local_size={}",
                            task.metadata.id,
                            upload_result.success,
                            upload_result.size,
                            file_data.len()
                        );

                        // 使用本地文件大小，更准确
                        Ok(FileOperationResult {
                            success: upload_result.success,
                            file_ids: vec![task.metadata.id],
                            success_count: if upload_result.success { 1 } else { 0 },
                            failed_count: if upload_result.success { 0 } else { 1 },
                            total_bytes: file_data.len() as u64,
                            duration_ms: (end_time - start_time) as u64,
                            errors: if let Some(error) = upload_result.error_message {
                                vec![error]
                            } else {
                                vec![]
                            },
                        })
                    }
                    Err(e) => Ok(FileOperationResult {
                        success: false,
                        file_ids: vec![task.metadata.id],
                        success_count: 0,
                        failed_count: 1,
                        total_bytes: 0,
                        duration_ms: 0,
                        errors: vec![e],
                    }),
                }
            }
            Err(e) => Ok(FileOperationResult {
                success: false,
                file_ids: vec![task.metadata.id],
                success_count: 0,
                failed_count: 1,
                total_bytes: 0,
                duration_ms: 0,
                errors: vec![format!("读取文件失败: {}", e)],
            }),
        }
    }

    /// 下载单个文件
    /// # Arguments
    /// * `task` - 文件下载任务
    pub async fn download_file(
        &self,
        task: FileDownloadTask,
    ) -> Result<FileOperationResult, String> {
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // 1. 从WebDAV下载文件
        let client = self.webdav_client.lock().await;
        log::info!(
            "📥 下载文件: id={}, name={}, remote={}, metadata_size={}, checksum={}",
            task.metadata.id,
            task.metadata.file_name,
            task.remote_path,
            task.metadata.size,
            task.metadata.checksum.as_deref().unwrap_or("none")
        );

        match client.download_file(&task.remote_path).await {
            Ok(download_result) => {
                if !download_result.success {
                    let end_time = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis();

                    return Ok(FileOperationResult {
                        success: false,
                        file_ids: vec![task.metadata.id],
                        success_count: 0,
                        failed_count: 1,
                        total_bytes: 0,
                        duration_ms: (end_time - start_time) as u64,
                        errors: download_result.error_message.into_iter().collect(),
                    });
                }

                // 2. 保存到本地路径
                if let Some(file_data) = download_result.binary_data {
                    log::info!(
                        "📄 下载数据: actual_size={}, metadata_size={}",
                        file_data.len(),
                        task.metadata.size
                    );

                    // 确保父目录存在
                    if let Some(parent) = task.local_path.parent() {
                        if let Err(e) = tokio::fs::create_dir_all(parent).await {
                            let end_time = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis();

                            return Ok(FileOperationResult {
                                success: false,
                                file_ids: vec![task.metadata.id],
                                success_count: 0,
                                failed_count: 1,
                                total_bytes: 0,
                                duration_ms: (end_time - start_time) as u64,
                                errors: vec![format!("创建目录失败: {}", e)],
                            });
                        }
                    }

                    // 写入文件
                    match tokio::fs::write(&task.local_path, &file_data).await {
                        Ok(_) => {
                            // 3. 验证文件完整性（如果提供了校验和）
                            let mut validation_error = None;
                            if let Some(expected_checksum) = &task.metadata.checksum {
                                match calculate_file_checksum(&task.local_path).await {
                                    Ok(actual_checksum) => {
                                        if actual_checksum != *expected_checksum {
                                            log::error!("❌ 文件校验和不匹配: expected={}, actual={}, file={}",
                                                expected_checksum, actual_checksum, task.local_path.display());
                                            validation_error = Some("文件校验和不匹配".to_string());
                                        } else {
                                            log::info!(
                                                "✅ 文件校验和验证通过: {}",
                                                task.local_path.display()
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        validation_error = Some(format!("校验和验证失败: {}", e));
                                    }
                                }
                            }

                            let end_time = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis();

                            // 4. 返回结果（使用 metadata.size 更准确）
                            Ok(FileOperationResult {
                                success: validation_error.is_none(),
                                file_ids: vec![task.metadata.id],
                                success_count: if validation_error.is_none() { 1 } else { 0 },
                                failed_count: if validation_error.is_some() { 1 } else { 0 },
                                total_bytes: task.metadata.size,
                                duration_ms: (end_time - start_time) as u64,
                                errors: if let Some(error) = validation_error {
                                    vec![error]
                                } else {
                                    vec![]
                                },
                            })
                        }
                        Err(e) => {
                            let end_time = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis();

                            Ok(FileOperationResult {
                                success: false,
                                file_ids: vec![task.metadata.id],
                                success_count: 0,
                                failed_count: 1,
                                total_bytes: 0,
                                duration_ms: (end_time - start_time) as u64,
                                errors: vec![format!("写入文件失败: {}", e)],
                            })
                        }
                    }
                } else {
                    let end_time = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis();

                    Ok(FileOperationResult {
                        success: false,
                        file_ids: vec![task.metadata.id],
                        success_count: 0,
                        failed_count: 1,
                        total_bytes: 0,
                        duration_ms: (end_time - start_time) as u64,
                        errors: vec!["下载的文件数据为空".to_string()],
                    })
                }
            }
            Err(e) => {
                let end_time = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis();

                Ok(FileOperationResult {
                    success: false,
                    file_ids: vec![task.metadata.id],
                    success_count: 0,
                    failed_count: 1,
                    total_bytes: 0,
                    duration_ms: (end_time - start_time) as u64,
                    errors: vec![e],
                })
            }
        }
    }

    /// 删除单个文件
    /// # Arguments
    /// * `file_id` - 文件ID
    /// * `remote_path` - 远程文件路径
    pub async fn delete_file(
        &self,
        file_id: String,
        remote_path: String,
    ) -> Result<FileOperationResult, String> {
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // 1. 从WebDAV删除文件
        let client = self.webdav_client.lock().await;
        match client.delete_file(&remote_path).await {
            Ok(success) => {
                let end_time = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis();

                // 2. 验证删除结果
                if success {
                    Ok(FileOperationResult {
                        success: true,
                        file_ids: vec![file_id],
                        success_count: 1,
                        failed_count: 0,
                        total_bytes: 0,
                        duration_ms: (end_time - start_time) as u64,
                        errors: vec![],
                    })
                } else {
                    Ok(FileOperationResult {
                        success: false,
                        file_ids: vec![file_id],
                        success_count: 0,
                        failed_count: 1,
                        total_bytes: 0,
                        duration_ms: (end_time - start_time) as u64,
                        errors: vec!["删除文件失败".to_string()],
                    })
                }
            }
            Err(e) => {
                let end_time = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis();

                Ok(FileOperationResult {
                    success: false,
                    file_ids: vec![file_id],
                    success_count: 0,
                    failed_count: 1,
                    total_bytes: 0,
                    duration_ms: (end_time - start_time) as u64,
                    errors: vec![e],
                })
            }
        }
    }

    /// 批量删除文件
    /// # Arguments
    /// * `file_ids` - 文件ID列表
    /// * `remote_paths` - 远程路径列表
    pub async fn delete_files(
        &self,
        file_ids: Vec<String>,
        remote_paths: Vec<String>,
    ) -> Result<FileOperationResult, String> {
        if file_ids.len() != remote_paths.len() {
            return Err("文件ID和路径数量不匹配".to_string());
        }

        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let mut result = FileOperationResult {
            success: false,
            file_ids: vec![],
            success_count: 0,
            failed_count: 0,
            total_bytes: 0,
            duration_ms: 0,
            errors: vec![],
        };

        // 1. 并发删除多个文件
        let mut handles = Vec::new();

        for (file_id, remote_path) in file_ids.iter().zip(remote_paths.iter()) {
            let file_id = file_id.clone();
            let remote_path = remote_path.clone();
            let client_clone = self.webdav_client.clone();

            let handle = tokio::spawn(async move {
                let client = client_clone.lock().await;
                let delete_result = client.delete_file(&remote_path).await;
                (file_id, delete_result)
            });

            handles.push(handle);
        }

        // 2. 收集删除结果
        for handle in handles {
            match handle.await {
                Ok((file_id, delete_result)) => {
                    result.file_ids.push(file_id.clone());
                    match delete_result {
                        Ok(success) => {
                            if success {
                                result.success_count += 1;
                            } else {
                                result.failed_count += 1;
                                result.errors.push(format!("删除文件失败: {}", file_id));
                            }
                        }
                        Err(e) => {
                            result.failed_count += 1;
                            result
                                .errors
                                .push(format!("删除文件出错 {}: {}", file_id, e));
                        }
                    }
                }
                Err(e) => {
                    result.failed_count += 1;
                    result.errors.push(format!("等待删除任务完成失败: {}", e));
                }
            }
        }

        let end_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // 3. 返回汇总结果
        result.success = result.failed_count == 0;
        result.duration_ms = (end_time - start_time) as u64;

        Ok(result)
    }

    /// 获取缓存目录路径
    pub async fn get_cache_dir(&self) -> Result<std::path::PathBuf, String> {
        // 使用临时目录作为缓存目录
        let mut cache_dir = std::env::temp_dir();
        cache_dir.push("eco-paste-files");

        // 创建目录（如果不存在）
        if let Err(e) = std::fs::create_dir_all(&cache_dir) {
            return Err(format!("创建缓存目录失败: {}", e));
        }

        Ok(cache_dir)
    }

    /// 清理孤儿缓存文件
    /// 递归扫描缓存目录，删除不在数据库中的文件（这些是已删除项目的缓存）
    pub async fn cleanup_stale_cache_files(
        &self,
        database_state: &tauri_plugin_eco_database::DatabaseState,
    ) {
        log::info!("🔄 开始清理孤儿缓存文件...");

        // 获取缓存目录
        let cache_dir = match self.get_cache_dir().await {
            Ok(path) => path,
            Err(e) => {
                log::warn!("⚠️ 无法获取缓存目录，跳过清理: {}", e);
                return;
            }
        };

        if !cache_dir.exists() {
            log::info!("✅ 缓存目录不存在，无需清理");
            return;
        }

        // 递归获取缓存目录中的所有文件（包括子目录）
        let mut cache_files = Vec::new();
        Self::collect_files_recursive(&cache_dir, &mut cache_files);

        if cache_files.is_empty() {
            log::info!("✅ 缓存目录为空，无需清理");
            return;
        }

        log::info!("📁 缓存目录中有 {} 个文件", cache_files.len());

        // 获取数据库中所有文件记录的本地路径
        let db = database_state.lock().await;
        let options = tauri_plugin_eco_database::QueryOptions {
            where_clause: None,
            order_by: None,
            limit: None,
            offset: None,
            only_favorites: false,
            exclude_deleted: false, // 包含已删除的数据
            params: None,
        };

        let cache_dir_str = cache_dir.to_string_lossy().to_string();
        let db_files: std::collections::HashSet<String> = match db.query_history(options) {
            Ok(items) => items
                .iter()
                .filter(|item| {
                    item.item_type.as_deref() == Some("files")
                        || item.item_type.as_deref() == Some("image")
                })
                .filter_map(|item| item.value.clone())
                .filter(|v| v.starts_with(&cache_dir_str))
                .collect(),
            Err(e) => {
                log::error!("❌ 查询数据库失败: {}", e);
                return;
            }
        };

        drop(db);

        // 找出不在数据库中的缓存文件（孤儿文件）
        let mut orphaned_count = 0;
        for cache_file in &cache_files {
            if !db_files.contains(cache_file) {
                match std::fs::remove_file(cache_file) {
                    Ok(_) => {
                        log::info!("🗑️ 已删除孤儿缓存: {}", cache_file);
                        orphaned_count += 1;
                    }
                    Err(e) => {
                        log::warn!("⚠️ 删除缓存文件失败: {} ({})", cache_file, e);
                    }
                }
            }
        }

        log::info!("✅ 缓存清理完成，共删除 {} 个孤儿文件", orphaned_count);
    }

    /// 递归收集目录中的所有文件
    fn collect_files_recursive(dir: &std::path::Path, files: &mut Vec<String>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(path_str) = path.to_str().map(|s| s.to_string()) {
                        files.push(path_str);
                    }
                } else if path.is_dir() {
                    Self::collect_files_recursive(&path, files);
                }
            }
        }
    }
}

/// 创建共享的文件同步管理器实例
pub fn create_shared_manager(webdav_client: WebDAVClientState) -> Arc<Mutex<FileSyncManager>> {
    let default_config = FileSyncConfig {
        max_file_size: 100 * 1024 * 1024, // 100MB
        timeout_ms: 60000,
    };

    Arc::new(Mutex::new(FileSyncManager::new(
        webdav_client,
        default_config,
    )))
}
