use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::command;
use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use base64::Engine;

// 配置文件路径
const CONFIG_FILE_NAME: &str = "webdav_config.json";

// 获取配置文件路径 - 使用临时目录方案
fn get_config_file_path() -> Result<PathBuf> {
    // 获取当前用户目录
    let home_dir = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("无法获取用户目录"))?;

    let config_dir = home_dir.join(".ecopaste");

    // 确保配置目录存在
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|_e| anyhow::anyhow!("无法创建配置目录"))?;
    }

    Ok(config_dir.join(CONFIG_FILE_NAME))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebDAVConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub path: String,
    pub timeout: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub status_code: Option<u16>,
    pub error_message: Option<String>,
    pub server_info: Option<String>,
}


fn build_auth_header(username: &str, password: &str) -> String {
    let credentials = format!("{}:{}", username, password);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
    format!("Basic {}", encoded)
}

/// 确保指定路径的目录存在（递归创建）
async fn ensure_directory_exists_for_path(config: &WebDAVConfig, dir_path: &str) -> Result<()> {
    let base_url = config.url.trim_end_matches('/');
    let full_path = if dir_path.starts_with('/') {
        format!("{}{}", base_url, dir_path)
    } else {
        format!("{}/{}", base_url, dir_path)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 首先检查目录是否已存在
    if test_directory_exists_internal(config, &full_path, &auth_header).await.is_ok() {
        return Ok(());
    }

    // 尝试创建目录
    let response = client
        .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &full_path)
        .header("Authorization", &auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let status = response.status();

    if status.as_u16() == 201 {
        Ok(())
    } else if status.as_u16() == 405 || status.as_u16() == 409 {
        // 405或409可能表示目录已存在，再次验证
        if test_directory_exists_internal(config, &full_path, &auth_header).await.is_ok() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("无法创建或访问目录 {}: HTTP {}", dir_path, status.as_u16()))
        }
    } else {
        Err(anyhow::anyhow!("创建目录失败 {}: HTTP {} {}", dir_path, status.as_u16(), status.canonical_reason().unwrap_or("Unknown")))
    }
}

async fn ensure_directory_exists(config: &WebDAVConfig) -> Result<()> {
    let base_url = config.url.trim_end_matches('/');
    let path = config.path.trim_matches('/');

    // 如果是根路径，不需要创建目录
    if path.is_empty() || path == "/" {
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 构建目录URL
    let dir_url = if path.starts_with('/') {
        format!("{}{}", base_url, path)
    } else {
        format!("{}/{}", base_url, path)
    };

    // 首先检查目录是否已存在
    match test_directory_exists_internal(config, &dir_url, &auth_header).await {
        Ok(_) => {
            // 目录已存在，直接返回成功
            return Ok(());
        },
        Err(_) => {
            // 目录不存在，尝试创建
        }
    }

    // 尝试创建目录（MKCOL是WebDAV创建目录的标准方法）
    let response = client
        .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &dir_url)
        .header("Authorization", &auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let status = response.status();

    // 201表示创建成功，其他状态码表示创建失败
    if status.as_u16() == 201 {
        Ok(())
    } else if status.as_u16() == 405 {
        // 405可能表示目录已存在，再次验证
        test_directory_exists_internal(config, &dir_url, &auth_header).await
    } else {
        Err(anyhow::anyhow!("无法创建目录，HTTP {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown")))
    }
}

async fn test_directory_exists_internal(config: &WebDAVConfig, dir_url: &str, auth_header: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    // 使用PROPFIND检查目录是否存在
    let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
    <D:prop>
        <D:resourcetype/>
        <D:displayname/>
    </D:prop>
</D:propfind>"#;

    let response = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), dir_url)
        .header("Authorization", auth_header)
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Depth", "0")
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .body(propfind_body)
        .send()
        .await?;

    if response.status().is_success() || response.status().as_u16() == 207 {
        Ok(())
    } else {
        Err(anyhow::anyhow!("目录不存在: {}", response.status()))
    }
}

pub async fn test_http_connection(config: &WebDAVConfig) -> Result<ConnectionTestResult> {
    let start_time = Instant::now();

    // 首先确保目录存在
    if let Err(e) = ensure_directory_exists(config).await {
        return Ok(ConnectionTestResult {
            success: false,
            latency_ms: start_time.elapsed().as_millis() as u64,
            status_code: Some(404),
            error_message: Some(format!("无法创建或访问同步目录: {}", e)),
            server_info: None,
        });
    }

    // 构建测试URL
    let test_url = if config.url.ends_with('/') {
        format!("{}{}", config.url, config.path.trim_start_matches('/'))
    } else {
        format!("{}/{}", config.url, config.path.trim_start_matches('/'))
    };

    // 如果路径为空或根路径，直接使用base URL
    let test_url = if config.path.trim_matches('/').is_empty() || config.path == "/" {
        config.url.clone()
    } else {
        test_url
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    let response = client
        .head(&test_url)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let latency = start_time.elapsed().as_millis() as u64;
    let status_code = response.status().as_u16();

    // 获取服务器信息
    let server_info = response.headers()
        .get("Server")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let success = response.status().is_success() ||
                 response.status() == 401 || // 401表示连接成功但认证失败，这是正常的
                 response.status() == 405;   // 405表示方法不支持，但服务器存在

    Ok(ConnectionTestResult {
        success,
        latency_ms: latency,
        status_code: Some(status_code),
        error_message: if !success {
            Some(format!("HTTP {}: {}", status_code, response.status().canonical_reason().unwrap_or("Unknown")))
        } else {
            None
        },
        server_info,
    })
}





#[command]
pub async fn set_server_config(config: WebDAVConfig) -> Result<(), String> {
    let config_path = get_config_file_path()
        .map_err(|e| e.to_string())?;

    // 序列化配置为JSON字符串
    let config_json = serde_json::to_string(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    // 写入配置文件
    fs::write(&config_path, config_json)
        .map_err(|e| format!("保存配置文件失败: {}", e))?;

    Ok(())
}

#[command]
pub async fn get_server_config() -> Result<Option<WebDAVConfig>, String> {
    let config_path = get_config_file_path()
        .map_err(|e| e.to_string())?;

    // 检查配置文件是否存在
    if !config_path.exists() {
        return Ok(None);
    }

    // 读取配置文件内容
    let config_content = fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    // 反序列化配置
    let config: WebDAVConfig = serde_json::from_str(&config_content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(Some(config))
}

#[command]
pub async fn test_connection(config: WebDAVConfig) -> Result<ConnectionTestResult, String> {
    test_http_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileUploadResult {
    pub success: bool,
    pub path: String,
    pub size: u64,
    pub duration_ms: u64,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDownloadResult {
    pub success: bool,
    pub path: String,
    pub size: u64,
    pub duration_ms: u64,
    pub data: Option<String>,
    pub error_message: Option<String>,
}

async fn upload_file_with_retry(config: &WebDAVConfig, file_path: &str, content: String, max_retries: u32) -> Result<FileUploadResult> {
    let start_time = Instant::now();
    let mut last_error = None;

    // 增加超时时间，特别是对于大文件
    let enhanced_timeout = if file_path.ends_with(".zip") {
        std::cmp::max(config.timeout, 120000) // ZIP文件最少2分钟超时
    } else if file_path.contains("sync-data.json") {
        std::cmp::max(config.timeout, 90000) // 同步数据最少90秒超时
    } else {
        std::cmp::max(config.timeout, 60000) // 其他文件最少60秒超时
    };

    for attempt in 1..=max_retries {
        match upload_file_single_attempt(config, file_path, &content, enhanced_timeout).await {
            Ok(mut result) => {
                if result.success {
                    let total_duration = start_time.elapsed().as_millis() as u64;
                    result.duration_ms = total_duration;
                    return Ok(result);
                } else {
                    // 检查是否是可重试的错误
                    let error_msg = result.error_message.as_ref().map(|s| s.as_str()).unwrap_or("");
                    let is_retryable = error_msg.contains("timeout") ||
                                     error_msg.contains("超时") ||
                                     error_msg.contains("connection") ||
                                     error_msg.contains("连接") ||
                                     result.error_message.as_ref().map_or(false, |msg| msg.contains("502")) ||
                                     result.error_message.as_ref().map_or(false, |msg| msg.contains("503")) ||
                                     result.error_message.as_ref().map_or(false, |msg| msg.contains("504"));

                    if is_retryable && attempt < max_retries {
                        last_error = Some(result.error_message.clone());

                        // 指数退避策略
                        let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        continue;
                    } else {
                        let total_duration = start_time.elapsed().as_millis() as u64;
                        result.duration_ms = total_duration;
                        return Ok(result);
                    }
                }
            },
            Err(e) => {
                if attempt < max_retries {
                    last_error = Some(Some(format!("尝试{}失败: {}", attempt, e)));

                    // 指数退避策略
                    let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                } else {
                    let total_duration = start_time.elapsed().as_millis() as u64;
                    return Ok(FileUploadResult {
                        success: false,
                        path: file_path.to_string(),
                        size: 0,
                        duration_ms: total_duration,
                        error_message: Some(format!("所有重试均失败: {}", e)),
                    });
                }
            }
        }
    }

    let total_duration = start_time.elapsed().as_millis() as u64;
    Ok(FileUploadResult {
        success: false,
        path: file_path.to_string(),
        size: 0,
        duration_ms: total_duration,
        error_message: last_error.flatten().or(Some(String::from("未知错误"))),
    })
}

async fn upload_file_single_attempt(config: &WebDAVConfig, file_path: &str, content: &str, timeout_ms: u64) -> Result<FileUploadResult> {
    let start_time = Instant::now();
    let base_url = config.url.trim_end_matches('/');

    let full_path = if file_path.starts_with('/') {
        format!("{}{}", base_url, file_path)
    } else {
        format!("{}/{}", base_url, file_path)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 根据文件扩展名设置适当的Content-Type
    let content_type = if file_path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if file_path.ends_with(".seg") {
        "application/octet-stream"
    } else if file_path.ends_with(".zip") {
        "application/zip"
    } else {
        "application/octet-stream"
    };

    let response = match client
        .put(&full_path)
        .header("Authorization", auth_header)
        .header("Content-Type", content_type)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .header("Overwrite", "T") // 允许覆盖现有文件
        .body(content.to_string())
        .send()
        .await {
            Ok(resp) => resp,
            Err(e) => {
                let duration = start_time.elapsed().as_millis() as u64;
                return Ok(FileUploadResult {
                    success: false,
                    path: file_path.to_string(),
                    size: 0,
                    duration_ms: duration,
                    error_message: Some(format!("请求失败: {}", e)),
                });
            }
        };

    let duration = start_time.elapsed().as_millis() as u64;
    let status = response.status();

    if status.is_success() || status.as_u16() == 201 || status.as_u16() == 204 {
        Ok(FileUploadResult {
            success: true,
            path: file_path.to_string(),
            size: content.len() as u64,
            duration_ms: duration,
            error_message: None,
        })
    } else {
        Ok(FileUploadResult {
            success: false,
            path: file_path.to_string(),
            size: 0,
            duration_ms: duration,
            error_message: Some(format!("HTTP {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"))),
        })
    }
}

async fn upload_sync_data_file(config: &WebDAVConfig, file_path: &str, content: String) -> Result<FileUploadResult> {
    // 默认重试3次
    upload_file_with_retry(config, file_path, content, 3).await
}

async fn download_file_with_retry(config: &WebDAVConfig, file_path: &str, max_retries: u32) -> Result<FileDownloadResult> {
    let start_time = Instant::now();
    let mut last_error = None;

    // 增加超时时间，特别是对于指纹数据下载
    let enhanced_timeout = if file_path.contains("fingerprints.json") {
        std::cmp::max(config.timeout, 60000) // 指纹数据最少60秒超时
    } else {
        std::cmp::max(config.timeout, 45000) // 其他文件最少45秒超时
    };

    for attempt in 1..=max_retries {
        match download_file_single_attempt(config, file_path, enhanced_timeout).await {
            Ok(mut result) => {
                if result.success {
                    let total_duration = start_time.elapsed().as_millis() as u64;
                    result.duration_ms = total_duration;
                    return Ok(result);
                } else {
                    // 检查是否是可重试的错误
                    let error_msg = result.error_message.as_ref().map(|s| s.as_str()).unwrap_or("");
                    let is_retryable = error_msg.contains("timeout") ||
                                     error_msg.contains("超时") ||
                                     error_msg.contains("connection") ||
                                     error_msg.contains("连接") ||
                                     result.error_message.as_ref().map_or(false, |msg| msg.contains("502")) ||
                                     result.error_message.as_ref().map_or(false, |msg| msg.contains("503")) ||
                                     result.error_message.as_ref().map_or(false, |msg| msg.contains("504"));

                    if is_retryable && attempt < max_retries {
                        last_error = Some(result.error_message.clone());

                        // 指数退避策略
                        let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        continue;
                    } else {
                        let total_duration = start_time.elapsed().as_millis() as u64;
                        result.duration_ms = total_duration;
                        return Ok(result);
                    }
                }
            },
            Err(e) => {
                if attempt < max_retries {
                    last_error = Some(Some(format!("尝试{}失败: {}", attempt, e)));

                    // 指数退避策略
                    let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                } else {
                    let total_duration = start_time.elapsed().as_millis() as u64;
                    return Ok(FileDownloadResult {
                        success: false,
                        path: file_path.to_string(),
                        size: 0,
                        duration_ms: total_duration,
                        data: None,
                        error_message: Some(format!("所有重试均失败: {}", e)),
                    });
                }
            }
        }
    }

    let total_duration = start_time.elapsed().as_millis() as u64;
    Ok(FileDownloadResult {
        success: false,
        path: file_path.to_string(),
        size: 0,
        duration_ms: total_duration,
        data: None,
        error_message: last_error.flatten().or(Some(String::from("未知错误"))),
    })
}

async fn download_file_single_attempt(config: &WebDAVConfig, file_path: &str, timeout_ms: u64) -> Result<FileDownloadResult> {
    let start_time = Instant::now();
    let base_url = config.url.trim_end_matches('/');

    let full_path = if file_path.starts_with('/') {
        format!("{}{}", base_url, file_path)
    } else {
        format!("{}/{}", base_url, file_path)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    let response = match client
        .get(&full_path)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await {
            Ok(resp) => resp,
            Err(e) => {
                let duration = start_time.elapsed().as_millis() as u64;
                return Ok(FileDownloadResult {
                    success: false,
                    path: file_path.to_string(),
                    size: 0,
                    duration_ms: duration,
                    data: None,
                    error_message: Some(format!("请求失败: {}", e)),
                });
            }
        };

    let duration = start_time.elapsed().as_millis() as u64;
    let status = response.status();

    if status.is_success() {
        let content = match response.text().await {
            Ok(text) => text,
            Err(e) => {
                return Ok(FileDownloadResult {
                    success: false,
                    path: file_path.to_string(),
                    size: 0,
                    duration_ms: duration,
                    data: None,
                    error_message: Some(format!("读取响应内容失败: {}", e)),
                });
            }
        };

        Ok(FileDownloadResult {
            success: true,
            path: file_path.to_string(),
            size: content.len() as u64,
            duration_ms: duration,
            data: Some(content),
            error_message: None,
        })
    } else {
        Ok(FileDownloadResult {
            success: false,
            path: file_path.to_string(),
            size: 0,
            duration_ms: duration,
            data: None,
            error_message: Some(format!("HTTP {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"))),
        })
    }
}

async fn download_sync_data_file(config: &WebDAVConfig, file_path: &str) -> Result<FileDownloadResult> {
    // 默认重试3次
    download_file_with_retry(config, file_path, 3).await
}


#[command]
pub async fn upload_sync_data(config: WebDAVConfig, file_path: String, content: String) -> Result<FileUploadResult, String> {
    upload_sync_data_file(&config, &file_path, content)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn download_sync_data(config: WebDAVConfig, file_path: String) -> Result<FileDownloadResult, String> {
    download_sync_data_file(&config, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn create_directory(config: WebDAVConfig, dir_path: String) -> Result<bool, String> {
    create_webdav_directory(&config, &dir_path)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_file(config: WebDAVConfig, file_path: String) -> Result<bool, String> {
    delete_webdav_file(&config, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn upload_file(config: WebDAVConfig, local_path: String, remote_path: String) -> Result<bool, String> {
    use std::fs;

    // 读取本地文件
    let file_data = match fs::read(&local_path) {
        Ok(data) => data,
        Err(e) => return Err(format!("读取文件失败 {}: {}", local_path, e)),
    };

    // 上传到WebDAV
    upload_webdav_file(&config, &remote_path, &file_data)
        .await
        .map_err(|e| format!("WebDAV上传失败 {}: {}", e, remote_path))
}

#[command]
pub async fn download_file(config: WebDAVConfig, remote_path: String, local_path: String) -> Result<bool, String> {
    use std::fs;
    use std::path::Path;

    // 确保目录存在
    if let Some(parent) = Path::new(&local_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }

    // 从WebDAV下载文件
    let file_data = download_webdav_file(&config, &remote_path)
        .await
        .map_err(|e| e.to_string())?;

    // 写入本地文件
    fs::write(&local_path, file_data)
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(true)
}

async fn upload_webdav_file(config: &WebDAVConfig, file_path: &str, file_data: &[u8]) -> Result<bool> {
    let base_url = config.url.trim_end_matches('/');
    let full_path = if file_path.starts_with('/') {
        format!("{}{}", base_url, file_path)
    } else {
        format!("{}/{}", base_url, file_path)
    };

    // 确保父目录存在 - 这是解决HTTP 409的关键
    if let Some(parent_path) = std::path::Path::new(file_path).parent() {
        let parent_path_str = parent_path.to_string_lossy();
        if !parent_path_str.is_empty() && parent_path_str != "/" {
            // 静默尝试创建目录，失败不阻止上传
            let _ = ensure_directory_exists_for_path(config, &parent_path_str).await;
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 方法1：标准WebDAV PUT上传
    let response = client
        .put(&full_path)
        .header("Authorization", &auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", file_data.len().to_string())
        .body(file_data.to_vec())
        .send()
        .await?;

    let status = response.status();

    if status.is_success() || status.as_u16() == 201 || status.as_u16() == 204 {
        return Ok(true);
    }

    // 如果PUT失败，检查具体原因并尝试恢复
    match status.as_u16() {
        409 => {
            // 尝试使用PUT with Overwrite:F (强制覆盖)
            let overwrite_response = client
                .put(&full_path)
                .header("Authorization", &auth_header)
                .header("User-Agent", "EcoPaste-WebDAV/1.0")
                .header("Content-Type", "application/octet-stream")
                .header("Content-Length", file_data.len().to_string())
                .header("Overwrite", "F") // 强制覆盖
                .body(file_data.to_vec())
                .send()
                .await?;

            let overwrite_status = overwrite_response.status();

            if overwrite_status.is_success() || overwrite_status.as_u16() == 201 || overwrite_status.as_u16() == 204 {
                return Ok(true);
            }

            // 尝试删除文件后重新上传
            let _ = client
                .delete(&full_path)
                .header("Authorization", &auth_header)
                .header("User-Agent", "EcoPaste-WebDAV/1.0")
                .send()
                .await;

            // 短暂延迟
            tokio::time::sleep(Duration::from_millis(200)).await;

            let retry_response = client
                .put(&full_path)
                .header("Authorization", &auth_header)
                .header("User-Agent", "EcoPaste-WebDAV/1.0")
                .header("Content-Type", "application/octet-stream")
                .header("Content-Length", file_data.len().to_string())
                .body(file_data.to_vec())
                .send()
                .await?;

            let retry_status = retry_response.status();

            if retry_status.is_success() || retry_status.as_u16() == 201 || retry_status.as_u16() == 204 {
                return Ok(true);
            }

            Err(anyhow::anyhow!("文件上传失败，所有PUT方法都失败 - HTTP: {}", status.as_u16()))
        },
        404 => {
            Err(anyhow::anyhow!("文件路径不存在: {} - HTTP 404", file_path))
        },
        401 | 403 => {
            Err(anyhow::anyhow!("认证或权限不足: HTTP {}", status.as_u16()))
        },
        _ => {
            Err(anyhow::anyhow!("上传失败 - HTTP {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown")))
        }
    }
}

async fn download_webdav_file(config: &WebDAVConfig, file_path: &str) -> Result<Vec<u8>> {
    let base_url = config.url.trim_end_matches('/');
    let full_path = if file_path.starts_with('/') {
        format!("{}{}", base_url, file_path)
    } else {
        format!("{}/{}", base_url, file_path)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    let response = client
        .get(&full_path)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let status = response.status();
    if status.is_success() {
        let file_data = response.bytes().await?;
        Ok(file_data.to_vec())
    } else {
        Err(anyhow::anyhow!("下载文件失败: HTTP {}", status))
    }
}

async fn delete_webdav_file(config: &WebDAVConfig, file_path: &str) -> Result<bool> {
    let base_url = config.url.trim_end_matches('/');
    let full_path = if file_path.starts_with('/') {
        format!("{}{}", base_url, file_path)
    } else {
        format!("{}/{}", base_url, file_path)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    let response = client
        .delete(&full_path)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let status = response.status();

    // 200 OK 或 204 No Content 表示成功删除
    // 404 Not Found 表示文件不存在（也算成功）
    if status.is_success() || status.as_u16() == 204 || status.as_u16() == 404 {
        Ok(true)
    } else {
        let error_msg = format!("删除文件失败: HTTP {} {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"));
        Err(anyhow::anyhow!(error_msg))
    }
}

async fn create_webdav_directory(config: &WebDAVConfig, dir_path: &str) -> Result<bool> {
    let base_url = config.url.trim_end_matches('/');
    let full_path = if dir_path.starts_with('/') {
        format!("{}{}", base_url, dir_path)
    } else {
        format!("{}/{}", base_url, dir_path)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    let response = client
        .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &full_path)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let status = response.status();

    // 201 Created 表示成功创建
    // 405 Method Not Allowed 表示目录已存在（某些服务器返回）
    // 409 Conflict 表示父目录不存在或冲突
    if status.as_u16() == 201 || status.as_u16() == 405 {
        Ok(true)
    } else {
        Err(anyhow::anyhow!("创建目录失败: HTTP {}", status))
    }
}