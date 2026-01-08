//! WebDAV 客户端模块
//! 为云同步引擎提供 WebDAV 操作接口

use base64::Engine;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// WebDAV 客户端状态
pub type WebDAVClientState = Arc<Mutex<WebDAVClient>>;

/// WebDAV 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDAVConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub path: String,
    pub timeout: u64,
}

/// 文件上传结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileUploadResult {
    pub success: bool,
    pub path: String,
    pub size: u64,
    pub duration_ms: u64,
    pub error_message: Option<String>,
}

/// 文件下载结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDownloadResult {
    pub success: bool,
    pub path: String,
    pub size: u64,
    pub duration_ms: u64,
    pub data: Option<String>,
    pub binary_data: Option<Vec<u8>>,
    pub error_message: Option<String>,
}

/// 连接测试结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub status_code: Option<u16>,
    pub error_message: Option<String>,
    pub server_info: Option<String>,
}

/// 重试配置
struct RetryConfig {
    max_retries: u32,
    base_delay_ms: u64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_ms: 1000,
        }
    }
}

/// WebDAV 客户端
pub struct WebDAVClient {
    config: Option<WebDAVConfig>,
    http_client: Option<reqwest::Client>,
}

impl WebDAVClient {
    /// 创建新的 WebDAV 客户端实例
    pub fn new() -> Self {
        Self {
            config: None,
            http_client: None,
        }
    }

    /// 初始化客户端
    pub async fn initialize(&mut self, config: WebDAVConfig) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(config.timeout))
            .pool_max_idle_per_host(5)
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        self.config = Some(config);
        self.http_client = Some(client);

        // 降级处理：目录检查失败只记录警告，不阻塞初始化
        // 网络不稳定时应用仍可启动，后续同步时会自动创建目录
        if let Err(e) = self.ensure_sync_directory().await {
            log::warn!("[Sync] 初始化时检查同步目录失败: {}，应用将继续运行", e);
        }

        Ok(())
    }

    /// 检查是否已初始化
    pub fn is_initialized(&self) -> bool {
        self.config.is_some() && self.http_client.is_some()
    }

    /// 获取配置
    fn config(&self) -> Result<&WebDAVConfig, String> {
        self.config
            .as_ref()
            .ok_or_else(|| "WebDAV 客户端未初始化".to_string())
    }

    /// 获取 HTTP 客户端
    fn client(&self) -> Result<&reqwest::Client, String> {
        self.http_client
            .as_ref()
            .ok_or_else(|| "WebDAV 客户端未初始化".to_string())
    }

    /// 构建认证头
    fn build_auth_header(&self) -> Result<String, String> {
        let config = self.config()?;
        let credentials = format!("{}:{}", config.username, config.password);
        let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
        Ok(format!("Basic {}", encoded))
    }

    /// 构建完整的远程路径
    fn build_full_url(&self, relative_path: &str) -> Result<String, String> {
        let config = self.config()?;
        let base_url = config.url.trim_end_matches('/');

        if relative_path.starts_with('/') {
            Ok(format!("{}{}", base_url, relative_path))
        } else {
            Ok(format!("{}/{}", base_url, relative_path))
        }
    }

    /// 构建同步目录下的路径
    fn build_sync_path(&self, file_name: &str) -> Result<String, String> {
        let config = self.config()?;
        let sync_path = config.path.trim_matches('/');

        if sync_path.is_empty() {
            self.build_full_url(file_name)
        } else {
            self.build_full_url(&format!(
                "{}/{}",
                sync_path,
                file_name.trim_start_matches('/')
            ))
        }
    }

    /// 确保同步目录存在
    async fn ensure_sync_directory(&self) -> Result<(), String> {
        let config = self.config()?;
        let sync_path = config.path.trim_matches('/');

        if sync_path.is_empty() {
            return Ok(());
        }

        // 检查目录是否存在
        if self.check_resource_exists(sync_path).await? {
            return Ok(());
        }

        // 创建目录
        self.create_directory_internal(sync_path).await
    }

    /// 检查资源是否存在 (使用 PROPFIND)
    pub async fn check_resource_exists(&self, path: &str) -> Result<bool, String> {
        let client = self.client()?;
        let auth_header = self.build_auth_header()?;
        let full_url = self.build_full_url(path)?;

        let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
    <D:prop>
        <D:resourcetype/>
    </D:prop>
</D:propfind>"#;

        let response = client
            .request(Method::from_bytes(b"PROPFIND").unwrap(), &full_url)
            .header("Authorization", &auth_header)
            .header("Content-Type", "application/xml; charset=utf-8")
            .header("Depth", "0")
            .header("User-Agent", "EcoPaste-CloudSync/1.0")
            .body(propfind_body)
            .send()
            .await
            .map_err(|e| format!("检查资源存在性失败: {}", e))?;

        let status = response.status().as_u16();
        Ok(status == 200 || status == 207)
    }

    /// 内部创建目录方法
    async fn create_directory_internal(&self, dir_path: &str) -> Result<(), String> {
        let client = self.client()?;
        let auth_header = self.build_auth_header()?;
        let full_url = self.build_full_url(dir_path)?;

        let response = client
            .request(Method::from_bytes(b"MKCOL").unwrap(), &full_url)
            .header("Authorization", &auth_header)
            .header("User-Agent", "EcoPaste-CloudSync/1.0")
            .send()
            .await
            .map_err(|e| format!("创建目录请求失败: {}", e))?;

        let status = response.status().as_u16();

        match status {
            201 => Ok(()),
            405 => {
                // 目录可能已存在
                if self.check_resource_exists(dir_path).await? {
                    Ok(())
                } else {
                    Err(format!("创建目录失败: HTTP {}", status))
                }
            }
            _ => Err(format!("创建目录失败: HTTP {}", status)),
        }
    }

    /// 测试连接（带重试机制）
    pub async fn test_connection(&self) -> Result<ConnectionTestResult, String> {
        let retry_config = RetryConfig::default();
        let mut last_result = None;

        for attempt in 1..=retry_config.max_retries {
            match self.attempt_connection().await {
                Ok(result) => {
                    if result.success {
                        return Ok(result);
                    }
                    // 失败且不可重试，直接返回
                    if !Self::is_retryable_error(result.error_message.as_deref()) {
                        return Ok(result);
                    }
                    last_result = Some(result);
                }
                Err(e) => {
                    last_result = Some(ConnectionTestResult {
                        success: false,
                        latency_ms: 0,
                        status_code: None,
                        error_message: Some(format!("连接失败: {}", e)),
                        server_info: None,
                    });
                }
            }

            // 如果不是最后一次尝试，等待后重试
            if attempt < retry_config.max_retries {
                let delay = retry_config.base_delay_ms * 2_u64.pow(attempt - 1);
                log::debug!(
                    "[WebDAV] 连接测试第 {} 次失败，{}ms 后重试...",
                    attempt,
                    delay
                );
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }

        // 所有重试都失败，返回最后一次的结果
        Ok(last_result.unwrap_or_else(|| ConnectionTestResult {
            success: false,
            latency_ms: 0,
            status_code: None,
            error_message: Some("所有重试均失败".to_string()),
            server_info: None,
        }))
    }

    /// 尝试一次连接测试（内部方法）
    async fn attempt_connection(&self) -> Result<ConnectionTestResult, String> {
        let start_time = Instant::now();
        let client = self.client()?;
        let auth_header = self.build_auth_header()?;

        // 直接测试连接，不检查目录（避免 TLS 握手不稳定导致误判）
        let test_url = self.build_sync_path("")?;

        let response = client
            .head(&test_url)
            .header("Authorization", &auth_header)
            .header("User-Agent", "EcoPaste-CloudSync/1.0")
            .send()
            .await;

        let latency = start_time.elapsed().as_millis() as u64;

        match response {
            Ok(resp) => {
                let status_code = resp.status().as_u16();
                let server_info = resp
                    .headers()
                    .get("Server")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                let success =
                    resp.status().is_success() || status_code == 405 || status_code == 207;

                Ok(ConnectionTestResult {
                    success,
                    latency_ms: latency,
                    status_code: Some(status_code),
                    error_message: if !success {
                        Some(format!("HTTP {}", status_code))
                    } else {
                        None
                    },
                    server_info,
                })
            }
            Err(e) => Ok(ConnectionTestResult {
                success: false,
                latency_ms: latency,
                status_code: None,
                error_message: Some(format!("连接失败: {}", e)),
                server_info: None,
            }),
        }
    }

    /// 上传同步数据 (JSON 文本)
    pub async fn upload_sync_data(
        &self,
        file_path: &str,
        content: &str,
    ) -> Result<FileUploadResult, String> {
        self.upload_with_retry(
            file_path,
            content.as_bytes(),
            "application/json; charset=utf-8",
        )
        .await
    }

    /// 下载同步数据 (JSON 文本)
    pub async fn download_sync_data(&self, file_path: &str) -> Result<FileDownloadResult, String> {
        let result = self.download_with_retry(file_path).await?;

        // 将二进制数据转换为文本
        if result.success {
            if let Some(binary) = &result.binary_data {
                let text = String::from_utf8_lossy(binary).to_string();
                return Ok(FileDownloadResult {
                    data: Some(text),
                    binary_data: None,
                    ..result
                });
            }
        }

        Ok(result)
    }

    /// 上传二进制文件
    pub async fn upload_file(
        &self,
        remote_path: &str,
        file_data: &[u8],
    ) -> Result<FileUploadResult, String> {
        self.upload_with_retry(remote_path, file_data, "application/octet-stream")
            .await
    }

    /// 下载二进制文件
    pub async fn download_file(&self, remote_path: &str) -> Result<FileDownloadResult, String> {
        self.download_with_retry(remote_path).await
    }

    /// 删除文件
    pub async fn delete_file(&self, remote_path: &str) -> Result<bool, String> {
        let client = self.client()?;
        let auth_header = self.build_auth_header()?;
        let full_url = self.build_sync_path(remote_path)?;

        let response = client
            .delete(&full_url)
            .header("Authorization", &auth_header)
            .header("User-Agent", "EcoPaste-CloudSync/1.0")
            .send()
            .await
            .map_err(|e| format!("删除文件请求失败: {}", e))?;

        let status = response.status().as_u16();

        // 200, 204 表示成功删除; 404 表示文件不存在（也算成功）
        Ok(status == 200 || status == 204 || status == 404)
    }

    /// 创建目录
    pub async fn create_directory(&self, dir_path: &str) -> Result<bool, String> {
        let full_path = if self.config()?.path.trim_matches('/').is_empty() {
            dir_path.to_string()
        } else {
            format!(
                "{}/{}",
                self.config()?.path.trim_matches('/'),
                dir_path.trim_start_matches('/')
            )
        };

        self.create_directory_internal(&full_path).await?;
        Ok(true)
    }

    /// 批量删除文件
    pub async fn delete_files(&self, file_paths: &[String]) -> Result<Vec<String>, String> {
        let mut failed_paths = Vec::new();

        for path in file_paths {
            if !self.delete_file(path).await.unwrap_or(false) {
                failed_paths.push(path.clone());
            }
        }

        Ok(failed_paths)
    }

    /// 带重试的上传
    async fn upload_with_retry(
        &self,
        file_path: &str,
        data: &[u8],
        content_type: &str,
    ) -> Result<FileUploadResult, String> {
        let retry_config = RetryConfig::default();
        let start_time = Instant::now();
        let mut last_error = None;

        for attempt in 1..=retry_config.max_retries {
            match self
                .upload_single_attempt(file_path, data, content_type)
                .await
            {
                Ok(result) if result.success => {
                    return Ok(FileUploadResult {
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        ..result
                    });
                }
                Ok(result) => {
                    if Self::is_retryable_error(result.error_message.as_deref())
                        && attempt < retry_config.max_retries
                    {
                        last_error = result.error_message;
                        let delay = retry_config.base_delay_ms * 2_u64.pow(attempt - 1);
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        continue;
                    }
                    return Ok(FileUploadResult {
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        ..result
                    });
                }
                Err(e) => {
                    if attempt < retry_config.max_retries {
                        last_error = Some(e);
                        let delay = retry_config.base_delay_ms * 2_u64.pow(attempt - 1);
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                    } else {
                        return Ok(FileUploadResult {
                            success: false,
                            path: file_path.to_string(),
                            size: 0,
                            duration_ms: start_time.elapsed().as_millis() as u64,
                            error_message: Some(format!("所有重试均失败: {}", e)),
                        });
                    }
                }
            }
        }

        Ok(FileUploadResult {
            success: false,
            path: file_path.to_string(),
            size: 0,
            duration_ms: start_time.elapsed().as_millis() as u64,
            error_message: last_error.or(Some("未知错误".to_string())),
        })
    }

    /// 单次上传尝试
    async fn upload_single_attempt(
        &self,
        file_path: &str,
        data: &[u8],
        content_type: &str,
    ) -> Result<FileUploadResult, String> {
        let client = self.client()?;
        let auth_header = self.build_auth_header()?;
        let full_url = self.build_sync_path(file_path)?;

        // 确保父目录存在
        if let Some(parent) = std::path::Path::new(file_path).parent() {
            let parent_str = parent.to_string_lossy();
            if !parent_str.is_empty() && parent_str != "/" && parent_str != "." {
                let _ = self.create_directory(&parent_str).await;
            }
        }

        let response = client
            .put(&full_url)
            .header("Authorization", &auth_header)
            .header("Content-Type", content_type)
            .header("Content-Length", data.len().to_string())
            .header("Overwrite", "T")
            .header("User-Agent", "EcoPaste-CloudSync/1.0")
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| format!("上传请求失败: {}", e))?;

        let status = response.status().as_u16();

        if status == 200 || status == 201 || status == 204 {
            Ok(FileUploadResult {
                success: true,
                path: file_path.to_string(),
                size: data.len() as u64,
                duration_ms: 0,
                error_message: None,
            })
        } else {
            Ok(FileUploadResult {
                success: false,
                path: file_path.to_string(),
                size: 0,
                duration_ms: 0,
                error_message: Some(format!("HTTP {}", status)),
            })
        }
    }

    /// 带重试的下载
    async fn download_with_retry(&self, file_path: &str) -> Result<FileDownloadResult, String> {
        let retry_config = RetryConfig::default();
        let start_time = Instant::now();
        let mut last_error = None;

        for attempt in 1..=retry_config.max_retries {
            match self.download_single_attempt(file_path).await {
                Ok(result) if result.success => {
                    return Ok(FileDownloadResult {
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        ..result
                    });
                }
                Ok(result) => {
                    if Self::is_retryable_error(result.error_message.as_deref())
                        && attempt < retry_config.max_retries
                    {
                        last_error = result.error_message;
                        let delay = retry_config.base_delay_ms * 2_u64.pow(attempt - 1);
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        continue;
                    }
                    return Ok(FileDownloadResult {
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        ..result
                    });
                }
                Err(e) => {
                    if attempt < retry_config.max_retries {
                        last_error = Some(e);
                        let delay = retry_config.base_delay_ms * 2_u64.pow(attempt - 1);
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                    } else {
                        return Ok(FileDownloadResult {
                            success: false,
                            path: file_path.to_string(),
                            size: 0,
                            duration_ms: start_time.elapsed().as_millis() as u64,
                            data: None,
                            binary_data: None,
                            error_message: Some(format!("所有重试均失败: {}", e)),
                        });
                    }
                }
            }
        }

        Ok(FileDownloadResult {
            success: false,
            path: file_path.to_string(),
            size: 0,
            duration_ms: start_time.elapsed().as_millis() as u64,
            data: None,
            binary_data: None,
            error_message: last_error.or(Some("未知错误".to_string())),
        })
    }

    /// 单次下载尝试
    async fn download_single_attempt(&self, file_path: &str) -> Result<FileDownloadResult, String> {
        let client = self.client()?;
        let auth_header = self.build_auth_header()?;
        let full_url = self.build_sync_path(file_path)?;

        let response = client
            .get(&full_url)
            .header("Authorization", &auth_header)
            .header("User-Agent", "EcoPaste-CloudSync/1.0")
            .send()
            .await
            .map_err(|e| format!("下载请求失败: {}", e))?;

        let status = response.status().as_u16();

        if response.status().is_success() {
            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("读取响应数据失败: {}", e))?;

            Ok(FileDownloadResult {
                success: true,
                path: file_path.to_string(),
                size: bytes.len() as u64,
                duration_ms: 0,
                data: None,
                binary_data: Some(bytes.to_vec()),
                error_message: None,
            })
        } else {
            Ok(FileDownloadResult {
                success: false,
                path: file_path.to_string(),
                size: 0,
                duration_ms: 0,
                data: None,
                binary_data: None,
                error_message: Some(format!("HTTP {}", status)),
            })
        }
    }

    /// 判断是否是可重试的错误
    fn is_retryable_error(error_msg: Option<&str>) -> bool {
        if let Some(msg) = error_msg {
            msg.contains("timeout")
                || msg.contains("超时")
                || msg.contains("connection")
                || msg.contains("连接")
                || msg.contains("502")
                || msg.contains("503")
                || msg.contains("504")
                || msg.contains("handshake")
                || msg.contains("unexpected EOF")
        } else {
            false
        }
    }
}

/// 创建共享的 WebDAV 客户端实例
pub fn create_shared_client() -> WebDAVClientState {
    Arc::new(Mutex::new(WebDAVClient::new()))
}
