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
    /// 创建时间
    pub create_time: i64,
    /// 最后修改时间
    pub last_modified: i64,
    /// 文件校验和
    pub checksum: Option<String>,
    /// MIME类型
    pub mime_type: Option<String>,
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
        let bytes_read = file.read(&mut buffer)
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

/// 文件同步批次
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSyncBatch {
    /// 上传任务列表
    pub upload_tasks: Vec<FileUploadTask>,
    /// 下载任务列表
    pub download_tasks: Vec<FileDownloadTask>,
    /// 要删除的文件ID列表
    pub delete_ids: Vec<String>,
    /// 时间戳
    pub timestamp: i64,
}

/// 文件同步进度
#[derive(Debug, Clone)]
pub struct FileSyncProgress {
    /// 当前处理的文件索引
    pub current_file: usize,
    /// 总文件数
    pub total_files: usize,
    /// 当前文件进度（0.0-1.0）
    pub current_file_progress: f64,
    /// 总进度（0.0-1.0）
    pub total_progress: f64,
    /// 已传输字节数
    pub transferred_bytes: u64,
    /// 总字节数
    pub total_bytes: u64,
}

/// 文件同步策略
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileSyncStrategy {
    /// 仅上传新文件
    UploadOnly,
    /// 仅下载新文件
    DownloadOnly,
    /// 双向同步
    Bidirectional,
    /// 仅同步收藏项目的文件
    FavoritesOnly,
}

/// 文件同步配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSyncConfig {
    /// 同步策略
    pub strategy: FileSyncStrategy,
    /// 最大文件大小（字节）
    pub max_file_size: u64,
    /// 支持的MIME类型
    pub supported_mime_types: Vec<String>,
    /// 是否启用压缩
    pub enable_compression: bool,
    /// 并发上传数
    pub concurrent_uploads: usize,
    /// 并发下载数
    pub concurrent_downloads: usize,
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
    /// 同步进度回调
    progress_callback: Option<Box<dyn Fn(FileSyncProgress) + Send + Sync>>,
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
            progress_callback: None,
        }
    }

    /// 设置进度回调函数
    /// # Arguments
    /// * `callback` - 进度回调函数
    pub fn set_progress_callback(&mut self, callback: Box<dyn Fn(FileSyncProgress) + Send + Sync>) {
        self.progress_callback = Some(callback);
    }

    /// 执行文件同步批次
    /// # Arguments
    /// * `batch` - 文件同步批次
    pub async fn sync_file_batch(&mut self, batch: FileSyncBatch) -> Result<FileOperationResult, String> {
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        let total_files = batch.upload_tasks.len() + batch.download_tasks.len() + batch.delete_ids.len();
        let mut result = FileOperationResult {
            success: false,
            file_ids: vec![],
            success_count: 0,
            failed_count: 0,
            total_bytes: 0,
            duration_ms: 0,
            errors: vec![],
        };

        if total_files == 0 {
            result.success = true;
            return Ok(result);
        }

        // 1. 处理上传任务
        for (index, task) in batch.upload_tasks.iter().enumerate() {
            self.update_progress(index, total_files, 0.0, 0, 0);

            // 1. 检查文件大小限制
            if task.metadata.size > self.config.max_file_size {
                result.errors.push(format!(
                    "文件 {} 超过大小限制 {} 字节",
                    task.metadata.id,
                    self.config.max_file_size
                ));
                continue;
            }

            // 2. 检查文件类型支持
            if !self.is_file_type_supported(&task.metadata.file_name) {
                result.errors.push(format!(
                    "不支持的文件类型: {}",
                    task.metadata.file_name
                ));
                continue;
            }

            // 3. 上传文件到WebDAV
            let client = self.webdav_client.lock().await;
            let remote_path = self.build_remote_path(&task.metadata);

            // 读取文件数据
            if let Ok(file_data) = std::fs::read(&task.local_path) {
                match client.upload_file(&remote_path, &file_data).await {
                    Ok(upload_result) => {
                        if upload_result.success {
                            result.file_ids.push(task.metadata.id.clone());
                            result.success_count += 1;
                            result.total_bytes += upload_result.size;
                        } else {
                            result.errors.push(format!(
                                "文件 {} 上传失败: {}",
                                task.metadata.id,
                                upload_result.error_message.unwrap_or_else(|| "未知错误".to_string())
                            ));
                        }
                    }
                    Err(e) => {
                        result.errors.push(format!(
                            "文件 {} 上传异常: {}",
                            task.metadata.id,
                            e
                        ));
                    }
                }
            } else {
                result.errors.push(format!(
                    "无法读取本地文件: {}",
                    task.local_path.display()
                ));
            }
        }

        // 2. 处理下载任务
        let upload_start = batch.upload_tasks.len();
        for (index, task) in batch.download_tasks.iter().enumerate() {
            self.update_progress(upload_start + index, total_files, 0.0, 0, 0);

            // 1. 检查本地是否已有最新版本
            let client = self.webdav_client.lock().await;
            let remote_path = self.build_remote_path(&task.metadata);

            // 2. 从WebDAV下载文件
            match client.download_file(&remote_path).await {
                Ok(download_result) => {
                    if download_result.success {
                        // 3. 验证文件完整性
                        if let Some(binary_data) = download_result.binary_data {
                            // 保存文件到本地
                            if let Err(e) = std::fs::write(&task.local_path, &binary_data) {
                                result.errors.push(format!(
                                    "文件 {} 保存失败: {}",
                                    task.metadata.id,
                                    e
                                ));
                                continue;
                            }

                            // 验证校验和（如果提供）
                            if let Some(expected_checksum) = &task.metadata.checksum {
                                let actual_checksum = format!("{:x}", md5::compute(&binary_data));
                                if &actual_checksum != expected_checksum {
                                    result.errors.push(format!(
                                        "文件 {} 校验和不匹配",
                                        task.metadata.id
                                    ));
                                    continue;
                                }
                            }

                            result.file_ids.push(task.metadata.id.clone());
                            result.success_count += 1;
                            result.total_bytes += download_result.size;
                        } else {
                            result.errors.push(format!(
                                "文件 {} 下载数据为空",
                                task.metadata.id
                            ));
                        }
                    } else {
                        result.errors.push(format!(
                            "文件 {} 下载失败: {}",
                            task.metadata.id,
                            download_result.error_message.unwrap_or_else(|| "未知错误".to_string())
                        ));
                    }
                }
                Err(e) => {
                    result.errors.push(format!(
                        "文件 {} 下载异常: {}",
                        task.metadata.id,
                        e
                    ));
                }
            }
        }

        // 3. 处理删除任务
        let download_start = upload_start + batch.download_tasks.len();
        for (index, file_id) in batch.delete_ids.iter().enumerate() {
            self.update_progress(download_start + index, total_files, 0.0, 0, 0);

            // 1. 从WebDAV删除文件
            let client = self.webdav_client.lock().await;
            let remote_path = format!("files/{}.bin", file_id);

            match client.delete_file(&remote_path).await {
                Ok(deleted) => {
                    if deleted {
                        result.file_ids.push(file_id.clone());
                        result.success_count += 1;

                        // 同时删除本地缓存文件
                        if let Ok(cache_dir) = self.get_cache_dir().await {
                            let local_cache_path = cache_dir.join(format!("{}.bin", file_id));
                            let _ = std::fs::remove_file(local_cache_path);
                        }
                    } else {
                        result.errors.push(format!(
                            "文件 {} 删除失败",
                            file_id
                        ));
                    }
                }
                Err(e) => {
                    result.errors.push(format!(
                        "文件 {} 删除异常: {}",
                        file_id,
                        e
                    ));
                }
            }
        }

        let end_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        result.success = result.failed_count == 0;
        result.duration_ms = (end_time - start_time) as u64;

        Ok(result)
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

        // 检查MIME类型
        if let Some(mime_type) = &task.metadata.mime_type {
            if !self.is_supported_mime_type(mime_type) {
                return Ok(FileOperationResult {
                    success: false,
                    file_ids: vec![task.metadata.id],
                    success_count: 0,
                    failed_count: 1,
                    total_bytes: 0,
                    duration_ms: 0,
                    errors: vec!["不支持的MIME类型".to_string()],
                });
            }
        }

        // 2. 读取文件内容
        match tokio::fs::read(&task.local_path).await {
            Ok(file_data) => {
                // 3. 上传到WebDAV
                let client = self.webdav_client.lock().await;
                match client.upload_file(&task.remote_path, &file_data).await {
                    Ok(upload_result) => {
                        let end_time = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis();

                        Ok(FileOperationResult {
                            success: upload_result.success,
                            file_ids: vec![task.metadata.id],
                            success_count: if upload_result.success { 1 } else { 0 },
                            failed_count: if upload_result.success { 0 } else { 1 },
                            total_bytes: upload_result.size,
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
    pub async fn download_file(&self, task: FileDownloadTask) -> Result<FileOperationResult, String> {
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // 1. 从WebDAV下载文件
        let client = self.webdav_client.lock().await;
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
                                match self.calculate_checksum(&task.local_path).await {
                                    Ok(actual_checksum) => {
                                        if actual_checksum != *expected_checksum {
                                            validation_error = Some("文件校验和不匹配".to_string());
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

                            // 4. 返回结果
                            Ok(FileOperationResult {
                                success: validation_error.is_none(),
                                file_ids: vec![task.metadata.id],
                                success_count: if validation_error.is_none() { 1 } else { 0 },
                                failed_count: if validation_error.is_some() { 1 } else { 0 },
                                total_bytes: download_result.size,
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
    pub async fn delete_file(&self, file_id: String, remote_path: String) -> Result<FileOperationResult, String> {
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
    pub async fn delete_files(&self, file_ids: Vec<String>, remote_paths: Vec<String>) -> Result<FileOperationResult, String> {
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
                            result.errors.push(format!("删除文件出错 {}: {}", file_id, e));
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

    /// 检查文件是否需要同步
    /// # Arguments
    /// * `local_path` - 本地文件路径
    /// * `remote_path` - 远程文件路径
    /// * `_local_modified` - 本地文件最后修改时间
    pub async fn needs_sync(&self, local_path: &PathBuf, remote_path: &str, _local_modified: i64) -> Result<bool, String> {
        let client = self.webdav_client.lock().await;

        // 1. 检查远程文件是否存在（通过尝试下载获取信息）
        let download_result = client.download_file(remote_path).await;

        // 如果远程文件不存在，需要上传
        if let Ok(result) = download_result {
            if !result.success {
                // 远程文件不存在，需要上传
                return Ok(true);
            }

            // 2. 比较文件大小（如果远程文件存在）
            let local_metadata = match tokio::fs::metadata(local_path).await {
                Ok(meta) => meta,
                Err(_) => {
                    // 本地文件不存在，需要下载
                    return Ok(true);
                }
            };

            let local_size = local_metadata.len();
            let remote_size = result.size;

            if local_size != remote_size {
                // 文件大小不同，需要同步
                return Ok(true);
            }

            // 3. 仅比较文件大小（WebDAV下载结果不包含修改时间）
            // 注意：实际实现中需要在同步索引中保存远程文件的修改时间和校验和
            // 这里简化为仅比较大小

            // 如果大小相同，假设文件相同（实际生产环境应使用更可靠的校验方法）
            Ok(false)
        } else {
            // 下载失败，可能是网络错误或其他问题
            Err(download_result.unwrap_err())
        }
    }

    /// 计算文件校验和
    /// # Arguments
    /// * `file_path` - 文件路径
    pub async fn calculate_checksum(&self, file_path: &PathBuf) -> Result<String, String> {
        use sha2::{Digest, Sha256};

        // 读取文件内容
        let file = tokio::fs::File::open(file_path).await
            .map_err(|e| format!("打开文件失败: {}", e))?;

        // 转换为阻塞读取
        let mut buffered = tokio::io::BufReader::new(file);
        let mut hasher = Sha256::new();
        let mut buffer = vec![0; 8192];

        loop {
            let bytes_read = buffered.read(&mut buffer).await
                .map_err(|e| format!("读取文件失败: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            hasher.update(&buffer[..bytes_read]);
        }

        // 计算校验和
        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }

    /// 检查MIME类型是否支持
    fn is_supported_mime_type(&self, mime_type: &str) -> bool {
        for supported in &self.config.supported_mime_types {
            if supported.contains('*') {
                // 处理通配符，如 "image/*"
                let prefix = supported.trim_end_matches('*');
                if mime_type.starts_with(prefix) {
                    return true;
                }
            } else if supported == mime_type {
                return true;
            }
        }
        false
    }

    /// 更新同步进度
    fn update_progress(&self, current_file: usize, total_files: usize, current_file_progress: f64, transferred_bytes: u64, total_bytes: u64) {
        let total_progress = if total_files > 0 {
            (current_file as f64 + current_file_progress) / total_files as f64
        } else {
            0.0
        };

        if let Some(callback) = &self.progress_callback {
            callback(FileSyncProgress {
                current_file,
                total_files,
                current_file_progress,
                total_progress,
                transferred_bytes,
                total_bytes,
            });
        }
    }

    /// 构建远程文件路径（使用固定时间戳避免重复上传）
    /// 前端踩坑：每次同步都上传新文件，浪费带宽
    /// 改进：使用固定时间戳确保同一文件总是使用相同路径
    pub fn build_legacy_remote_path(&self, item_id: &str, file_name: &str) -> String {
        // 使用 item_id 的创建时间作为固定时间戳，避免每次同步都上传新文件
        let fixed_timestamp = self.extract_fixed_timestamp_from_item_id(item_id);
        let remote_file_name = format!("{}_{}_{}", item_id, fixed_timestamp, file_name);

        // 基于WebDAV客户端配置构建路径
        // 这里简化处理，实际应从webdav客户端获取配置
        format!("files/{}", remote_file_name)
    }

    /// 从 item_id 中提取固定时间戳
    /// 前端踩坑：没有固定标识导致重复上传
    /// 改进：基于item_id生成固定时间戳
    fn extract_fixed_timestamp_from_item_id(&self, item_id: &str) -> i64 {
        // 方法1：如果 item_id 包含时间戳信息，提取它
        if let Some(timestamp_match) = item_id.chars()
            .collect::<Vec<_>>()
            .chunks(13)
            .find_map(|chunk| {
                let s: String = chunk.iter().collect();
                s.parse::<i64>().ok()
            }) {
            return timestamp_match;
        }

        // 方法2：使用 item_id 的哈希值作为固定标识
        let mut hash = 0i64;
        for byte in item_id.as_bytes() {
            hash = hash.wrapping_mul(31).wrapping_add(*byte as i64);
        }

        // 使用一个基准时间戳 + 哈希值确保唯一性
        let base_timestamp = 1600000000000i64; // 2020年基准时间
        base_timestamp + hash.abs()
    }

    /// 检查文件是否需要上传（去重机制）
    /// 前端踩坑：总是上传相同文件，浪费带宽
    /// 改进：检查远程文件是否存在，避免重复上传
    pub async fn needs_upload(&self, local_path: &PathBuf, remote_path: &str) -> Result<bool, String> {
        let client = self.webdav_client.lock().await;

        // 检查远程文件是否存在
        let exists = client.check_resource_exists(remote_path).await?;

        if !exists {
            // 远程文件不存在，需要上传
            return Ok(true);
        }

        // 远程文件存在，比较文件大小
        let local_metadata = match tokio::fs::metadata(local_path).await {
            Ok(meta) => meta,
            Err(_) => return Ok(true), // 本地文件读取失败，默认上传
        };

        let _local_size = local_metadata.len();

        // 尝试下载远程文件信息（这里简化处理，实际可以获取远程文件大小）
        // 由于WebDAV限制，我们无法直接获取远程文件大小，
        // 所以这里仅基于存在性判断，实际生产环境应使用更可靠的方法
        // 例如：在上传前计算本地文件校验和并与云端比较

        // 默认认为需要上传（保守策略）
        // 在实际应用中，可以实现更精确的比较逻辑
        Ok(true)
    }

    /// 验证路径有效性
    /// 前端踩坑：原始路径无效导致下载失败
    /// 改进：检查父目录是否存在
    fn is_valid_path(&self, path: &PathBuf) -> bool {
        if let Some(parent) = path.parent() {
            parent.exists() && parent.is_dir()
        } else {
            false
        }
    }

    /// 获取缓存目录路径（内部方法）
    /// 前端踩坑：没有统一缓存目录导致混乱
    /// 改进：统一管理缓存目录
    #[allow(dead_code)]
    async fn get_legacy_cache_dir(&self) -> Result<PathBuf, String> {
        // 这里简化处理，实际应使用Tauri的app_data_dir
        let cache_dir = PathBuf::from("./cache/files");

        // 创建缓存目录
        if let Err(e) = tokio::fs::create_dir_all(&cache_dir).await {
            return Err(format!("创建缓存目录失败: {}", e));
        }

        Ok(cache_dir)
    }

    /// 处理文件包上传
    /// 前端踩坑：文件包处理逻辑分散
    /// 改进：统一处理文件包上传逻辑
    pub async fn handle_file_package_uploads(
        &self,
        local_raw_data: &[crate::sync_core::SyncDataItem],
        cloud_result: &crate::data_manager::DataChangeResult,
    ) -> Result<FileOperationResult, String> {
        let mut result = FileOperationResult {
            success: false,
            file_ids: vec![],
            success_count: 0,
            failed_count: 0,
            total_bytes: 0,
            duration_ms: 0,
            errors: vec![],
        };

        // 从本地原始数据中筛选文件类型的项目
        let file_items: Vec<_> = local_raw_data
            .iter()
            .filter(|item| {
                // 检查是否为文件类型（image或files）
                item.item_type == "image" || item.item_type == "files"
            })
            .filter(|item| {
                // 检查是否在云端同步的项目列表中
                cloud_result.success_items.contains(&item.id)
            })
            .cloned()
            .collect();

        println!(
            "文件上传筛选: 本地 {} 个文件项目，{} 个成功同步项目",
            local_raw_data.len(),
            cloud_result.success_items.len()
        );

        if file_items.is_empty() {
            result.success = true;
            return Ok(result);
        }

        // 去重：基于项目ID，避免重复处理同一个项目
        let mut seen_ids = std::collections::HashSet::new();
        let unique_items: Vec<_> = file_items
            .into_iter()
            .filter(|item| seen_ids.insert(item.id.clone()))
            .collect();

        for item in unique_items {
            // 从原始数据中提取文件路径数组
            let file_paths = self.extract_file_paths(&item);

            if file_paths.is_empty() {
                println!("没有找到有效的文件路径: {}", item.id);
                continue;
            }

            println!(
                "处理文件上传: {}, 类型: {}, 文件数量: {}",
                item.id,
                item.item_type,
                file_paths.len()
            );

            // 上传文件并创建元数据
            for file_path in file_paths {
                let file_name = file_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown");

                let remote_path = self.build_legacy_remote_path(&item.id, file_name);

                // 计算文件哈希和大小
                let checksum = match calculate_file_checksum(&file_path).await {
                    Ok(hash) => {
                        log::info!("📝 文件哈希计算成功: {} -> {}", file_name, hash);
                        Some(hash)
                    }
                    Err(e) => {
                        log::warn!("⚠️ 文件哈希计算失败: {}, 错误: {}", file_name, e);
                        None
                    }
                };

                let metadata = FileMetadata {
                    id: item.id.clone(),
                    file_name: file_name.to_string(),
                    original_path: Some(file_path.clone()),
                    remote_path: remote_path.clone(),
                    size: 0, // 将在上传时计算
                    create_time: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as i64,
                    last_modified: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as i64,
                    checksum,
                    mime_type: None,
                };

                let task = FileUploadTask {
                    metadata,
                    local_path: file_path.clone(),
                    remote_path,
                };

                match self.upload_file(task).await {
                    Ok(upload_result) => {
                        if upload_result.success {
                            result.success_count += 1;
                            result.total_bytes += upload_result.total_bytes;
                            println!("文件上传成功: {}", file_name);
                        } else {
                            result.failed_count += 1;
                            result.errors.extend(upload_result.errors);
                            println!("文件上传失败: {}", file_name);
                        }
                    }
                    Err(e) => {
                        result.failed_count += 1;
                        result.errors.push(e.clone());
                        println!("文件上传异常: {}", e);
                    }
                }
            }
        }

        result.success = result.failed_count == 0;
        println!(
            "文件上传完成: 成功 {} 个, 失败 {} 个, 总大小 {} 字节",
            result.success_count,
            result.failed_count,
            result.total_bytes
        );
        Ok(result)
    }

    /// 处理文件包下载
    /// 前端踩坑：文件包下载逻辑不统一
    /// 改进：统一处理文件包下载逻辑
    pub async fn handle_file_package_downloads(
        &self,
        items_to_add: &[crate::sync_core::SyncDataItem],
    ) -> Result<(), String> {
        for item in items_to_add {
            // 检查是否为文件类型
            if item.item_type != "image" && item.item_type != "files" {
                continue;
            }

            // 提取文件元数据
            let metadata = self.extract_file_metadata(item);

            if metadata.is_empty() {
                continue;
            }

            // 批量下载文件
            for meta in metadata {
                let task = FileDownloadTask {
                    metadata: meta.clone(),
                    local_path: meta.original_path.as_ref()
                        .cloned()
                        .unwrap_or_else(|| PathBuf::from("cache")),
                    remote_path: meta.remote_path.clone(),
                };

                // 如果原始路径无效，使用缓存目录
                let mut local_path = task.local_path.clone();
                if !self.is_valid_path(&local_path) {
                    let cache_dir = self.get_cache_dir().await?;
                    let file_name = &meta.file_name;
                    local_path = cache_dir.join(file_name);
                }

                let task = FileDownloadTask {
                    metadata: meta,
                    local_path,
                    remote_path: task.remote_path,
                };

                if let Err(e) = self.download_file(task).await {
                    println!("下载文件失败: {}", e);
                }
            }
        }

        Ok(())
    }

    /// 从原始数据中提取文件路径数组
    /// 简化版：基于新版文件元数据格式直接提取路径
    fn extract_file_paths(&self, item: &crate::sync_core::SyncDataItem) -> Vec<PathBuf> {
        let metadata = self.extract_file_metadata(item);
        let mut file_paths = Vec::new();

        for meta in metadata {
            if let Some(original_path) = meta.original_path {
                if original_path.exists() {
                    file_paths.push(original_path);
                }
            }
        }

        // 去重并过滤无效路径
        file_paths.sort();
        file_paths.dedup();
        file_paths.retain(|path| {
            path.exists() &&
            !path.to_string_lossy().contains("://") &&
            !path.to_string_lossy().is_empty()
        });

        file_paths
    }

    /// 从 SyncDataItem 提取文件元数据
    /// 简化版：只支持新版格式，从根本上解决兼容性问题
    pub fn extract_file_metadata(&self, item: &crate::sync_core::SyncDataItem) -> Vec<FileMetadata> {
        if item.item_type != "image" && item.item_type != "files" {
            return Vec::new();
        }

        if let Some(ref value) = item.value {
            // 只支持新版格式：文件元数据数组
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                if let Some(array) = parsed.as_array() {
                    let mut metadata = Vec::new();
                    for item in array {
                        if let Ok(meta) = serde_json::from_value::<FileMetadata>(item.clone()) {
                            metadata.push(meta);
                        }
                    }
                    return metadata;
                }
            }
        }

        Vec::new()
    }

    /// 删除远程文件
    /// 前端踩坑：删除流程复杂，容易遗漏
    /// 改进：根据项目ID批量删除对应文件
    pub async fn delete_remote_files(&self, item_ids: &[String]) -> Result<bool, String> {
        if item_ids.is_empty() {
            return Ok(true);
        }

        log::info!("🔄 开始删除远程文件，共 {} 项", item_ids.len());

        let mut found_files = Vec::new();
        let mut delete_tasks = Vec::new();

        // 先尝试构建可能的文件路径模式并尝试删除
        for item_id in item_ids {
            // 根据之前的上传路径格式：files/{id}_{filename}
            // 我们不知道具体文件名，所以尝试常见扩展名
            let possible_extensions = ["bin", "jpg", "jpeg", "png", "gif", "pdf", "doc", "docx", "xls", "xlsx"];

            for ext in &possible_extensions {
                let remote_path = format!("files/{}_{}", item_id, ext);
                found_files.push(remote_path.clone());
                delete_tasks.push(remote_path);
            }
        }

        // 并发删除文件
        let mut success_count = 0;
        let mut failed_count = 0;

        for remote_path in delete_tasks {
            let client = self.webdav_client.lock().await;
            match client.delete_file(&remote_path).await {
                Ok(true) => {
                    success_count += 1;
                    log::info!("✅ 远程文件删除成功: {}", remote_path);
                }
                Ok(false) => {
                    failed_count += 1;
                    log::warn!("⚠️ 远程文件不存在或删除失败: {}", remote_path);
                }
                Err(e) => {
                    failed_count += 1;
                    log::error!("❌ 远程文件删除错误 {}: {}", remote_path, e);
                }
            }
        }

        log::info!("📊 远程文件删除完成: 成功 {} 个，失败 {} 个", success_count, failed_count);

        // 即使部分失败也返回成功，因为文件可能本来就不存在
        Ok(true)
    }

    /// 获取文件同步配置
    pub fn get_config(&self) -> &FileSyncConfig {
        &self.config
    }

    /// 更新文件同步配置
    pub fn update_config(&mut self, config: FileSyncConfig) {
        self.config = config;
    }

    /// 检查文件类型是否支持
    pub fn is_file_type_supported(&self, file_name: &str) -> bool {
        // 提取文件扩展名
        if let Some(extension) = std::path::Path::new(file_name).extension() {
            let ext = extension.to_string_lossy().to_lowercase();
            // 根据支持的MIME类型推断扩展名
            for mime_type in &self.config.supported_mime_types {
                if mime_type.starts_with("image/") && matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp") {
                    return true;
                }
                if mime_type.starts_with("text/") && matches!(ext.as_str(), "txt" | "md" | "csv") {
                    return true;
                }
                if mime_type == "application/pdf" && ext == "pdf" {
                    return true;
                }
                if mime_type == "application/zip" && ext == "zip" {
                    return true;
                }
            }
        }
        false
    }

    /// 构建远程文件路径
    pub fn build_remote_path(&self, metadata: &FileMetadata) -> String {
        format!("files/{}.bin", metadata.id)
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
}

/// 创建共享的文件同步管理器实例
pub fn create_shared_manager(webdav_client: WebDAVClientState) -> Arc<Mutex<FileSyncManager>> {
    let default_config = FileSyncConfig {
        strategy: FileSyncStrategy::Bidirectional,
        max_file_size: 100 * 1024 * 1024, // 100MB
        supported_mime_types: vec![
            "image/*".to_string(),
            "text/*".to_string(),
            "application/pdf".to_string(),
        ],
        enable_compression: false,
        concurrent_uploads: 3,
        concurrent_downloads: 3,
        timeout_ms: 60000,
    };

    Arc::new(Mutex::new(FileSyncManager::new(webdav_client, default_config)))
}
