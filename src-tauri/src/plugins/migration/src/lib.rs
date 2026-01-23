//! 数据迁移插件
//!
//! 迁移策略：
//! 1. 读取旧数据库的所有字段（id、value、type、width、height、count、sourceAppName、sourceAppIcon）
//! 2. 根据旧 type 字段判断类型：
//!    - image: 保留类型，设置 width、height、count（元数据来自旧数据库）
//!    - files: 保留类型，设置 count（元数据来自旧数据库）
//!    - 其他: 调用 detector 插件检测子类型，count 设为字符数
//! 3. 构建 InsertItem
//! 4. 调用 database 插件插入

mod database_migrator;
mod models;

use crate::database_migrator::{delete_backup_db, read_backup_db};
use crate::models::{MigrationMarker, MigrationPhase, MigrationProgress};
use std::fs;
use std::path::PathBuf;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_eco_common::paths::get_data_path;

// 引入 database 插件类型
use tauri_plugin_eco_database::InsertItem;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-migration")
        .setup(|app_handle, _webview_manager| {
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_migration(&app_handle_clone).await {
                    log::error!("[Migration] 执行迁移失败: {}", e);
                }
            });
            Ok(())
        })
        .build()
}

/// 获取数据目录
fn get_data_dir<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    get_data_path().ok_or_else(|| "无法获取数据目录".to_string())
}

/// 获取备份数据库文件路径（.bak 后缀）
fn get_backup_database_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!("EcoPaste-Sync{}.db.bak", suffix))
}

/// 获取迁移标记文件路径
fn get_migration_marker_path(data_dir: &PathBuf, is_dev: bool) -> PathBuf {
    let suffix = if is_dev { ".dev" } else { "" };
    data_dir.join(format!(".migration{}", suffix))
}

/// 执行迁移
async fn run_migration<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let data_dir = get_data_dir(app)?;
    let is_dev = cfg!(debug_assertions);

    let backup_db_path = get_backup_database_path(&data_dir, is_dev);
    let marker_path = get_migration_marker_path(&data_dir, is_dev);

    // 检查迁移标记
    if !marker_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&marker_path)
        .map_err(|e| format!("读取迁移标记失败: {}", e))?;
    let marker: MigrationMarker = serde_json::from_str(&content)
        .map_err(|e| format!("解析迁移标记失败: {}", e))?;

    if marker.phase != Some(MigrationPhase::Phase1Completed) {
        return Ok(());
    }

    // 检查备份数据库是否存在
    if !backup_db_path.exists() {
        return Err("备份数据库不存在".to_string());
    }

    // 发送事件通知 UI 开始迁移
    let _ = app.emit("migration://started", ());

    // 读取备份数据库的 id 和 value
    let app_for_callback = app.clone();
    let items = read_backup_db(&backup_db_path, move |progress| {
        let _ = app_for_callback.emit("migration://progress", progress);
    }).await?;

    if items.is_empty() {
        delete_backup_db(&backup_db_path)?;
        finish_migration(&marker_path, 0)?;
        return Ok(());
    }

    log::info!("[Migration] 读取完成，共 {} 条记录，开始插入...", items.len());

    // 获取 database 插件状态
    let db_state = app.state::<tauri_plugin_eco_database::DatabaseState>();
    let db_manager = db_state.lock().await;

    // 获取 detector 插件状态
    let detector_state = app.state::<tauri_plugin_eco_detector::DetectorState>();

    let total = items.len();
    let mut inserted = 0;
    let mut failed = 0;
    let time = chrono::Utc::now().timestamp_millis();

    for item in &items {
        // 根据原始类型决定处理方式
        let (final_type, final_subtype, final_width, final_height, final_count, search) =
            if item.item_type == "image" {
                // 图片类型：使用原始类型和元数据
                (
                    "image".to_string(),
                    Some("image".to_string()),
                    item.width,
                    item.height,
                    item.count,
                    None,
                )
            } else if item.item_type == "files" {
                // 文件类型：使用原始类型
                ("files".to_string(), None, None, None, item.count, None)
            } else {
                // 文本类型：调用 detector 插件检测子类型
                let detection_result = detector_state
                    .detect_content(item.value.clone(), "text".to_string(), Default::default());

                let (detected_type, subtype, search) =
                    detect_content_type(&item.value, detection_result);

                // 对于文本类型，使用检测到的类型，count 设为字符数
                let count = Some(item.value.len() as i32);

                (
                    detected_type,
                    subtype,
                    None,
                    None,
                    count,
                    search,
                )
            };

        let insert_item = InsertItem {
            id: item.id.clone(),
            item_type: Some(final_type),
            group: None,
            value: Some(item.value.clone()),
            search,
            count: final_count,
            width: final_width,
            height: final_height,
            favorite: 0,
            time,
            note: None,
            subtype: final_subtype,
            deleted: Some(0),
            sync_status: Some("not_synced".to_string()),
            source_app_name: item.source_app_name.clone(),
            source_app_icon: item.source_app_icon.clone(),
            position: None,
        };

        match db_manager.insert_with_deduplication(&insert_item, app) {
            Ok(_) => {
                inserted += 1;
                log::debug!("[Migration] 插入成功: {}", item.id);
            }
            Err(e) => {
                failed += 1;
                log::error!("[Migration] 插入失败 ({}): {}", item.id, e);
            }
        }

        if inserted % 100 == 0 || inserted == total || failed % 100 == 0 {
            let percentage = ((inserted + failed) as f64 / total as f64) * 100.0;
            let progress = MigrationProgress {
                current_phase: "写入新数据库".to_string(),
                processed_items: inserted + failed,
                total_items: total,
                percentage,
                current_operation: format!("已处理 {}/{} 条 (成功: {}, 失败: {})", inserted + failed, total, inserted, failed),
                completed: inserted + failed == total,
                error: if failed > 0 { Some(format!("失败 {} 条", failed)) } else { None },
            };
            log::info!("[Migration] 写入进度: {}%", percentage as u32);
            let _ = app.emit("migration://progress", progress);
        }
    }

    log::info!("[Migration] 插入完成，成功: {}, 失败: {}", inserted, failed);

    // 删除备份数据库
    delete_backup_db(&backup_db_path)?;
    log::info!("[Migration] 已删除备份数据库");

    // 完成迁移
    finish_migration(&marker_path, inserted)?;

    // 发送完成事件
    let _ = app.emit("migration://completed", ());

    Ok(())
}

/// 为颜色获取搜索字段
fn search_for_color(s: &str) -> Option<String> {
    let s = s.trim();
    if s.starts_with('#') {
        let hex = s.trim_start_matches('#');
        let hex = if hex.len() == 3 {
            let mut expanded = String::new();
            for c in hex.chars() {
                expanded.push(c);
                expanded.push(c);
            }
            expanded
        } else {
            hex.to_string()
        };
        if hex.len() == 6 {
            if let Ok(r) = u8::from_str_radix(&hex[0..2], 16) {
                if let Ok(g) = u8::from_str_radix(&hex[2..4], 16) {
                    if let Ok(b) = u8::from_str_radix(&hex[4..6], 16) {
                        return Some(format!("{},{},{}", r, g, b));
                    }
                }
            }
        }
    }
    None
}

/// 检测内容类型（参考 clipboard 插件的逻辑）
/// 返回 (item_type, subtype, search)
fn detect_content_type(
    value: &str,
    detection_result: Result<tauri_plugin_eco_common::types::detection::TypeDetectionResult, String>,
) -> (String, Option<String>, Option<String>) {
    let trimmed = value.trim();

    // 1. 首先检测是否为 HTML 或 RTF（这些是格式文本）
    let is_html = trimmed.starts_with("<!DOCTYPE")
        || trimmed.starts_with("<html")
        || trimmed.starts_with("<div")
        || trimmed.starts_with("<table")
        || trimmed.starts_with("<p ")
        || (trimmed.starts_with("<") && trimmed.contains("</"));

    let is_rtf = trimmed.starts_with("{\\rtf")
        || trimmed.starts_with("\\rtf");

    if is_html {
        return ("formatted".to_string(), Some("html".to_string()), None);
    }
    if is_rtf {
        return ("formatted".to_string(), Some("rich_text".to_string()), None);
    }

    // 2. 使用 detector 检测其他类型
    match detection_result {
        Ok(result) => {
            let (item_type, subtype) = if result.is_code {
                // 代码类型
                let subtype = result.code_language.or(Some("code".to_string()));
                ("code".to_string(), subtype)
            } else if result.is_markdown {
                // Markdown 属于格式文本
                ("formatted".to_string(), Some("markdown".to_string()))
            } else {
                // 基础类型（text, url, email, path, color）或纯文本
                let item_type = "text".to_string();
                let subtype = result.subtype;
                (item_type, subtype)
            };

            let search = if subtype.as_deref() == Some("color") {
                result.color_normalized.or(search_for_color(value))
            } else {
                None
            };

            (item_type, subtype, search)
        }
        Err(_) => ("text".to_string(), None, None),
    }
}

/// 完成迁移，删除标记文件
fn finish_migration(marker_path: &PathBuf, migrated_items: usize) -> Result<(), String> {
    // 删除迁移标记文件（迁移已完成，使用新版数据库）
    if let Err(e) = fs::remove_file(marker_path) {
        log::warn!("[Migration] 删除迁移标记文件失败: {}", e);
    }

    log::info!("[Migration] 迁移完成，共迁移 {} 条记录", migrated_items);

    Ok(())
}
