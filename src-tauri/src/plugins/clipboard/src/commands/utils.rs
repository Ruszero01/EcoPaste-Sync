use std::path::PathBuf;

use clipboard_rs::common::{RustImage, RustImageData};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use tauri_plugin_eco_common::{file::get_file_size, id::generate_id};

/// 检查OCR配置是否开启
pub fn should_enable_ocr<R: Runtime>(app_handle: &AppHandle<R>) -> bool {
    let config = match tauri_plugin_eco_common::config::get_cached_config(app_handle) {
        Ok(config) => config,
        Err(_) => return false,
    };

    tauri_plugin_eco_common::config::get_nested(&config, &["clipboardStore", "content", "ocr"])
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// 获取OCR sidecar可执行文件路径
fn get_ocr_sidecar_path<R: Runtime>(app_handle: &AppHandle<R>) -> Option<PathBuf> {
    // 根据平台确定 sidecar 名称
    let sidecar_name = if cfg!(target_os = "windows") {
        "ocr.exe"
    } else if cfg!(target_os = "macos") {
        "ocr"
    } else {
        return None; // Linux 使用 tesseract，不需要 sidecar
    };

    // 尝试获取 sidecar 路径
    // Tauri sidecar 通常位于 resources 目录或与可执行文件同目录
    let resource_dir = app_handle.path().resource_dir().ok()?;
    let sidecar_path = resource_dir.join(sidecar_name);

    if sidecar_path.exists() {
        Some(sidecar_path)
    } else {
        // 备选方案：尝试从当前可执行文件目录获取
        let exe_path = std::env::current_exe().ok()?;
        let exe_dir = exe_path.parent()?;
        let alt_path = exe_dir.join(sidecar_name);
        if alt_path.exists() {
            Some(alt_path)
        } else {
            None
        }
    }
}

/// 执行OCR识别
pub async fn perform_ocr<R: Runtime>(app_handle: &AppHandle<R>, image_path: &str) -> Option<String> {
    #[cfg(not(target_os = "linux"))]
    {
        // Windows/macOS: 使用 sidecar 可执行文件
        let sidecar_path = match get_ocr_sidecar_path(app_handle) {
            Some(path) => path,
            None => {
                log::error!("[Clipboard] 未找到 OCR sidecar 可执行文件");
                return None;
            }
        };

        let mut cmd = std::process::Command::new(&sidecar_path);
        cmd.arg(image_path);

        // Windows: 避免显示控制台窗口
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW = 0x08000000
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd
            .output()
            .map_err(|e| {
                log::error!("[Clipboard] OCR sidecar 执行失败: {}", e);
            })
            .ok()?;

        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if !text.is_empty() {
                // 尝试解析JSON格式，提取content字段
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(content) = json.get("content").and_then(|v| v.as_str()) {
                        if !content.is_empty() {
                            return Some(content.to_string());
                        }
                    }
                }
                // 非JSON格式，直接返回原文本
                Some(text)
            } else {
                None
            }
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("[Clipboard] OCR sidecar 错误: {}", stderr);
            None
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 tesseract
        let output = std::process::Command::new("tesseract")
            .arg(image_path)
            .arg("stdout")
            .args(["-l", "eng+chi_sim+jpn"])
            .output()
            .map_err(|e| {
                log::error!("[Clipboard] tesseract 执行失败: {:?}", e);
            })
            .ok()?;

        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if !text.is_empty() {
                Some(text)
            } else {
                None
            }
        } else {
            let content = String::from_utf8_lossy(&output.stderr);
            log::error!("[Clipboard] tesseract 错误: {:?}", content);
            None
        }
    }
}

/// 异步执行OCR并更新数据库
pub async fn perform_ocr_and_update<R: Runtime>(
    app_handle: &AppHandle<R>,
    image_path: &str,
    _item_id: &str, // 不再使用这个参数，因为去重可能导致ID变化
) {
    let ocr_result = perform_ocr(app_handle, image_path).await;

    if let Some(ocr_text) = ocr_result {
        log::info!("[Clipboard] OCR 识别成功，文本长度: {}", ocr_text.len());

        // 直接操作数据库并更新 change_tracker
        if let Some(db_state) = app_handle.try_state::<tauri_plugin_eco_database::DatabaseState>() {
            let db = db_state.lock().await;

            // 通过文件路径查找正确的 item_id（因为去重可能导致ID变化）
            let actual_item_id = {
                let conn = match db.get_connection() {
                    Ok(c) => c,
                    Err(e) => {
                        log::error!("[Clipboard] 获取数据库连接失败: {}", e);
                        return;
                    }
                };
                let mut stmt = match conn.prepare_cached("SELECT id FROM history WHERE value = ?1 AND [group] = 'image'") {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!("[Clipboard] 准备查找查询失败: {}", e);
                        return;
                    }
                };

                match stmt.query_row([image_path], |row| row.get::<_, String>(0)) {
                    Ok(id) => id,
                    Err(e) => {
                        log::error!("[Clipboard] 通过路径查找 item_id 失败: {}", e);
                        return;
                    }
                }
            };

            // 更新 search 字段
            if let Err(e) = db.update_field(&actual_item_id, "search", &ocr_text) {
                log::error!("[Clipboard] 更新 OCR search 字段失败: {}", e);
                return;
            }

            let current_time = chrono::Utc::now().timestamp_millis();

            // 更新时间戳
            if let Err(e) = db.update_field(&actual_item_id, "time", &current_time.to_string()) {
                log::error!("[Clipboard] 更新时间戳失败: {}", e);
            }

            // 标记 change_tracker
            if let Ok(conn) = db.get_connection() {
                if let Err(e) = db.get_change_tracker().mark_item_changed(&conn, &actual_item_id, "search") {
                    log::error!("[Clipboard] 标记 change_tracker 失败: {}", e);
                }
            }

            // 发送事件通知前端刷新数据
            let payload = serde_json::json!({ "duplicate_id": null });
            let _ = app_handle
                .emit("plugin:eco-clipboard://database_updated", payload)
                .map_err(|err| log::error!("[Clipboard] 发送OCR更新事件失败: {}", err));
        }
    } else {
        log::trace!("[Clipboard] OCR 识别无结果或失败");
    }
}

/// 为图片安排OCR任务（如果OCR功能开启）
pub fn schedule_ocr_task<R: Runtime>(
    app_handle: &AppHandle<R>,
    image_path: &PathBuf,
    item_id: &str,
) {
    if !should_enable_ocr(app_handle) {
        return;
    }

    let app_handle_clone = app_handle.clone();
    let image_path_str = image_path.to_string_lossy().to_string();
    let item_id_str = item_id.to_string();

    tauri::async_runtime::spawn(async move {
        perform_ocr_and_update(&app_handle_clone, &image_path_str, &item_id_str).await;
    });
}

/// 保存剪贴板图片到应用数据目录
/// copy_from: 如果指定，则从该路径复制图片；否则保存 RustImageData
pub fn save_clipboard_image<R: Runtime>(
    app_handle: &AppHandle<R>,
    image: Option<&RustImageData>,
    copy_from: Option<&String>,
) -> Result<(PathBuf, i32, u32, u32), String> {
    let id = generate_id();
    let app_data_dir = app_handle
        .path()
        .data_dir()
        .unwrap_or_else(|_| PathBuf::from("./data"));
    let images_dir = app_data_dir.join("images");
    let _ = std::fs::create_dir_all(&images_dir);

    let image_path = images_dir.join(format!("{}.png", id));

    // 保存或复制图片
    if let Some(from_path) = copy_from {
        std::fs::copy(from_path, &image_path).map_err(|e| e.to_string())?;
    } else if let Some(img) = image {
        if let Some(path_str) = image_path.to_str() {
            img.save_to_path(path_str).map_err(|e| e.to_string())?;
        }
    }

    let (width, height) = if let Some(path_str) = image_path.to_str() {
        RustImageData::from_path(path_str)
            .map(|img| img.get_size())
            .unwrap_or((0, 0))
    } else {
        (0, 0)
    };

    let file_size = get_file_size(&image_path);

    Ok((image_path, file_size, width, height))
}
