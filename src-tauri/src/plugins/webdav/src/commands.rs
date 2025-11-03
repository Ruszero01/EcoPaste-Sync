use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::command;
use anyhow::Result;
use base64::Engine;
use std::fs;
use std::path::PathBuf;

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
            .map_err(|e| anyhow::anyhow!("无法创建配置目录: {}", e))?;
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

#[derive(Debug, Serialize, Deserialize)]
pub struct WebDAVTestResult {
    pub success: bool,
    pub operations: HashMap<String, OperationResult>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OperationResult {
    pub success: bool,
    pub duration_ms: u64,
    pub error_message: Option<String>,
}

fn build_auth_header(username: &str, password: &str) -> String {
    let credentials = format!("{}:{}", username, password);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
    format!("Basic {}", encoded)
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

pub async fn webdav_operations_test(config: &WebDAVConfig) -> Result<WebDAVTestResult> {
    let mut operations = HashMap::new();
    let mut overall_success = true;

    // 测试1: 检查服务器是否支持WebDAV
    let start_time = Instant::now();
    let dav_result = test_dav_support(config).await;
    let duration = start_time.elapsed().as_millis() as u64;

    match dav_result {
        Ok(_) => {
            operations.insert("dav_support".to_string(), OperationResult {
                success: true,
                duration_ms: duration,
                error_message: None,
            });
        },
        Err(e) => {
            operations.insert("dav_support".to_string(), OperationResult {
                success: false,
                duration_ms: duration,
                error_message: Some(e.to_string()),
            });
            overall_success = false;
        }
    }

    // 测试2: 测试目录操作
    let start_time = Instant::now();
    let dir_result = test_directory_operations(config).await;
    let duration = start_time.elapsed().as_millis() as u64;

    match dir_result {
        Ok(_) => {
            operations.insert("directory_operations".to_string(), OperationResult {
                success: true,
                duration_ms: duration,
                error_message: None,
            });
        },
        Err(e) => {
            operations.insert("directory_operations".to_string(), OperationResult {
                success: false,
                duration_ms: duration,
                error_message: Some(e.to_string()),
            });
            overall_success = false;
        }
    }

    // 测试3: 测试文件操作（如果目录操作成功）
    if operations.get("directory_operations").map_or(false, |op| op.success) {
        let start_time = Instant::now();
        let file_result = test_file_operations(config).await;
        let duration = start_time.elapsed().as_millis() as u64;

        match file_result {
            Ok(_) => {
                operations.insert("file_operations".to_string(), OperationResult {
                    success: true,
                    duration_ms: duration,
                    error_message: None,
                });
            },
            Err(e) => {
                operations.insert("file_operations".to_string(), OperationResult {
                    success: false,
                    duration_ms: duration,
                    error_message: Some(e.to_string()),
                });
                overall_success = false;
            }
        }
    }

    Ok(WebDAVTestResult {
        success: overall_success,
        operations,
        error_message: if !overall_success {
            Some("部分WebDAV操作测试失败".to_string())
        } else {
            None
        },
    })
}

async fn test_dav_support(config: &WebDAVConfig) -> Result<()> {
    let base_url = config.url.trim_end_matches('/');

    // 使用根路径测试WebDAV支持，因为根路径肯定存在
    let test_url = base_url.to_string();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 使用OPTIONS方法测试WebDAV支持
    let response = client
        .request(reqwest::Method::OPTIONS, test_url)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let status = response.status();
    let dav_header = response.headers().get("DAV")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none");

    // 检查DAV头
    if dav_header != "none" || status.is_success() || status == 401 || status == 405 {
        Ok(())
    } else {
        Err(anyhow::anyhow!("服务器不支持WebDAV协议，DAV头: {}, 状态: {}", dav_header, status))
    }
}

async fn test_directory_operations(config: &WebDAVConfig) -> Result<()> {
    let test_url = if config.url.ends_with('/') {
        format!("{}{}", config.url, config.path.trim_start_matches('/'))
    } else {
        format!("{}/{}", config.url, config.path.trim_start_matches('/'))
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 使用PROPFIND方法测试目录访问
    let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
    <D:prop>
        <D:resourcetype/>
        <D:displayname/>
    </D:prop>
</D:propfind>"#;

    let response = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &test_url)
        .header("Authorization", auth_header)
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Depth", "0")
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .body(propfind_body)
        .send()
        .await?;

    if response.status().is_success() || response.status() == 207 {
        Ok(())
    } else {
        Err(anyhow::anyhow!("目录访问测试失败: {}", response.status()))
    }
}

async fn test_file_operations(config: &WebDAVConfig) -> Result<()> {
    let test_url = if config.url.ends_with('/') {
        format!("{}{}/ecopaste_test_file.txt", config.url, config.path.trim_start_matches('/'))
    } else {
        format!("{}/{}/ecopaste_test_file.txt", config.url, config.path.trim_start_matches('/'))
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 测试文件上传
    let test_content = "EcoPaste WebDAV test file content";
    let response = client
        .put(&test_url)
        .header("Authorization", auth_header.clone())
        .header("Content-Type", "text/plain")
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .body(test_content)
        .send()
        .await?;

    if !response.status().is_success() && response.status() != 201 && response.status() != 204 {
        return Err(anyhow::anyhow!("文件上传测试失败: {}", response.status()));
    }

    // 测试文件下载
    let response = client
        .get(&test_url)
        .header("Authorization", auth_header.clone())
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("文件下载测试失败: {}", response.status()));
    }

    let downloaded_content = response.text().await?;
    if downloaded_content != test_content {
        return Err(anyhow::anyhow!("文件内容不一致"));
    }

    // 测试文件删除
    let response = client
        .delete(&test_url)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    if !response.status().is_success() && response.status() != 204 {
        return Err(anyhow::anyhow!("文件删除测试失败: {}", response.status()));
    }

    Ok(())
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
        let attempt_start = Instant::now();
        println!("[Rust] 🔄 尝试上传文件 (第{}次/共{}次): {}, 大小: {} 字节", attempt, max_retries, file_path, content.len());
        
        match upload_file_single_attempt(config, file_path, &content, enhanced_timeout).await {
            Ok(mut result) => {
                if result.success {
                    let total_duration = start_time.elapsed().as_millis() as u64;
                    result.duration_ms = total_duration;
                    println!("[Rust] ✅ 文件上传成功 (第{}次尝试): {}, 总耗时: {}ms", attempt, file_path, total_duration);
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
                        println!("[Rust] ⚠️ 可重试错误 (第{}次尝试): {}, 将进行重试", attempt, error_msg);
                        last_error = Some(result.error_message.clone());
                        
                        // 指数退避策略
                        let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                        println!("[Rust] ⏱️ 等待 {}ms 后重试...", delay_ms);
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        continue;
                    } else {
                        let total_duration = start_time.elapsed().as_millis() as u64;
                        result.duration_ms = total_duration;
                        println!("[Rust] ❌ 不可重试错误或已达最大重试次数: {}", error_msg);
                        return Ok(result);
                    }
                }
            },
            Err(e) => {
                let attempt_duration = attempt_start.elapsed().as_millis() as u64;
                println!("[Rust] ❌ 上传尝试失败 (第{}次), 耗时: {}ms, 错误: {}", attempt, attempt_duration, e);
                
                if attempt < max_retries {
                    last_error = Some(Some(format!("尝试{}失败: {}", attempt, e)));
                    
                    // 指数退避策略
                    let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                    println!("[Rust] ⏱️ 等待 {}ms 后重试...", delay_ms);
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

    println!("[Rust] 🔍 开始上传文件: {}", file_path);
    println!("[Rust] 📍 完整URL: {}", full_path);
    println!("[Rust] 📏 文件大小: {} 字节", content.len());
    println!("[Rust] ⏱️ 超时设置: {}ms (原配置: {}ms)", timeout_ms, config.timeout);

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

    // 添加请求开始时间日志
    let request_start = Instant::now();
    println!("[Rust] 📤 发送HTTP PUT请求...");

    let response = match client
        .put(&full_path)
        .header("Authorization", auth_header)
        .header("Content-Type", content_type)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .header("Overwrite", "T") // 允许覆盖现有文件
        .body(content.to_string())
        .send()
        .await {
            Ok(resp) => {
                let request_duration = request_start.elapsed().as_millis() as u64;
                println!("[Rust] 📥 HTTP请求完成，耗时: {}ms", request_duration);
                resp
            },
            Err(e) => {
                let request_duration = request_start.elapsed().as_millis() as u64;
                println!("[Rust] ❌ HTTP请求失败，耗时: {}ms, 错误: {}", request_duration, e);
                
                // 检查是否是超时错误
                if e.is_timeout() {
                    println!("[Rust] ⏰ 检测到超时错误！当前超时设置: {}ms", timeout_ms);
                }
                
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
    
    println!("[Rust] 📋 HTTP响应状态: {} {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"));
    println!("[Rust] ⏱️ 本次上传耗时: {}ms", duration);

    if status.is_success() || status.as_u16() == 201 || status.as_u16() == 204 {
        println!("[Rust] ✅ 文件上传成功");
        Ok(FileUploadResult {
            success: true,
            path: file_path.to_string(),
            size: content.len() as u64,
            duration_ms: duration,
            error_message: None,
        })
    } else {
        println!("[Rust] ❌ 上传失败，HTTP状态: {}", status);
        Ok(FileUploadResult {
            success: false,
            path: file_path.to_string(),
            size: 0,
            duration_ms: duration,
            error_message: Some(format!("HTTP {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"))),
        })
    }
}

async fn upload_file(config: &WebDAVConfig, file_path: &str, content: String) -> Result<FileUploadResult> {
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
        let attempt_start = Instant::now();
        println!("[Rust] 🔄 尝试下载文件 (第{}次/共{}次): {}", attempt, max_retries, file_path);
        
        match download_file_single_attempt(config, file_path, enhanced_timeout).await {
            Ok(mut result) => {
                if result.success {
                    let total_duration = start_time.elapsed().as_millis() as u64;
                    result.duration_ms = total_duration;
                    println!("[Rust] ✅ 文件下载成功 (第{}次尝试): {}, 总耗时: {}ms", attempt, file_path, total_duration);
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
                        println!("[Rust] ⚠️ 可重试错误 (第{}次尝试): {}, 将进行重试", attempt, error_msg);
                        last_error = Some(result.error_message.clone());
                        
                        // 指数退避策略
                        let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                        println!("[Rust] ⏱️ 等待 {}ms 后重试...", delay_ms);
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        continue;
                    } else {
                        let total_duration = start_time.elapsed().as_millis() as u64;
                        result.duration_ms = total_duration;
                        println!("[Rust] ❌ 不可重试错误或已达最大重试次数: {}", error_msg);
                        return Ok(result);
                    }
                }
            },
            Err(e) => {
                let attempt_duration = attempt_start.elapsed().as_millis() as u64;
                println!("[Rust] ❌ 下载尝试失败 (第{}次), 耗时: {}ms, 错误: {}", attempt, attempt_duration, e);
                
                if attempt < max_retries {
                    last_error = Some(Some(format!("尝试{}失败: {}", attempt, e)));
                    
                    // 指数退避策略
                    let delay_ms = 1000 * (2_u64.pow(attempt - 1));
                    println!("[Rust] ⏱️ 等待 {}ms 后重试...", delay_ms);
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

    // 添加详细的调试日志
    println!("[Rust] 🔍 开始下载文件: {}", file_path);
    println!("[Rust] 📍 完整URL: {}", full_path);
    println!("[Rust] ⏱️ 超时设置: {}ms (原配置: {}ms)", timeout_ms, config.timeout);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()?;

    let auth_header = build_auth_header(&config.username, &config.password);

    // 添加请求开始时间日志
    let request_start = Instant::now();
    println!("[Rust] 📤 发送HTTP GET请求...");

    let response = match client
        .get(&full_path)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await {
            Ok(resp) => {
                let request_duration = request_start.elapsed().as_millis() as u64;
                println!("[Rust] 📥 HTTP请求完成，耗时: {}ms", request_duration);
                resp
            },
            Err(e) => {
                let request_duration = request_start.elapsed().as_millis() as u64;
                println!("[Rust] ❌ HTTP请求失败，耗时: {}ms, 错误: {}", request_duration, e);
                
                // 检查是否是超时错误
                if e.is_timeout() {
                    println!("[Rust] ⏰ 检测到超时错误！当前超时设置: {}ms", timeout_ms);
                }
                
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
    
    println!("[Rust] 📋 HTTP响应状态: {} {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"));
    println!("[Rust] ⏱️ 本次下载耗时: {}ms", duration);

    if status.is_success() {
        let content = match response.text().await {
            Ok(text) => {
                println!("[Rust] ✅ 文件内容读取成功，大小: {} 字节", text.len());
                text
            },
            Err(e) => {
                println!("[Rust] ❌ 读取响应内容失败: {}", e);
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
        println!("[Rust] ❌ 下载失败，HTTP状态: {}", status);
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

async fn download_file(config: &WebDAVConfig, file_path: &str) -> Result<FileDownloadResult> {
    // 默认重试3次
    download_file_with_retry(config, file_path, 3).await
}

#[command]
pub async fn test_webdav_operations(config: WebDAVConfig) -> Result<WebDAVTestResult, String> {
    webdav_operations_test(&config)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn upload_sync_data(config: WebDAVConfig, file_path: String, content: String) -> Result<FileUploadResult, String> {
    upload_file(&config, &file_path, content)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn download_sync_data(config: WebDAVConfig, file_path: String) -> Result<FileDownloadResult, String> {
    download_file(&config, &file_path)
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

    // 添加详细的调试日志
    println!("[Rust] 🗑️ 开始删除WebDAV文件: {}", file_path);
    println!("[Rust] 📍 完整URL: {}", full_path);
    println!("[Rust] 🔧 基础URL: {}", base_url);
    println!("[Rust] 👤 用户名: {}", config.username);

    let response = client
        .delete(&full_path)
        .header("Authorization", auth_header)
        .header("User-Agent", "EcoPaste-WebDAV/1.0")
        .send()
        .await?;

    let status = response.status();
    println!("[Rust] 📋 HTTP响应状态: {} {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"));

    // 200 OK 或 204 No Content 表示成功删除
    // 404 Not Found 表示文件不存在（也算成功）
    if status.is_success() || status.as_u16() == 204 || status.as_u16() == 404 {
        println!("[Rust] ✅ 文件删除成功: {}", file_path);
        Ok(true)
    } else {
        let error_msg = format!("删除文件失败: HTTP {} {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown"));
        println!("[Rust] ❌ {}", error_msg);
        
        // 尝试获取响应体以获取更多错误信息
        match response.text().await {
            Ok(body) => {
                if !body.is_empty() {
                    println!("[Rust] 📄 错误响应体: {}", body);
                }
            }
            Err(e) => {
                println!("[Rust] ⚠️ 无法读取错误响应体: {}", e);
            }
        }
        
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