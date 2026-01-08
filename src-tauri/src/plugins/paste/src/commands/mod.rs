#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(target_os = "macos"))]
pub fn wait(millis: u64) {
    use std::{thread, time};

    thread::sleep(time::Duration::from_millis(millis));
}

use std::sync::Arc;

use tauri::{command, AppHandle, Manager, Runtime};
use tauri_plugin_eco_database::{DatabaseState, HistoryItem, QueryOptions};
use tokio::sync::Mutex;

/// 用于防止快速粘贴重复触发的锁
static QUICK_PASTE_LOCK: Mutex<Vec<u32>> = Mutex::const_new(Vec::new());

/// RAII 锁守卫器，确保函数结束时移除锁
struct QuickPasteLockGuard(u32);

impl QuickPasteLockGuard {
    fn new(index: u32) -> Self {
        Self(index)
    }
}

impl Drop for QuickPasteLockGuard {
    fn drop(&mut self) {
        let index = self.0;
        tokio::spawn(async move {
            let mut lock = QUICK_PASTE_LOCK.lock().await;
            lock.retain(|&i| i != index);
        });
    }
}

/// 快速粘贴命令 - 从数据库读取第 N 个条目，粘贴到剪贴板并执行粘贴
#[command]
pub async fn quick_paste<R: Runtime>(app_handle: AppHandle<R>, index: u32) -> Result<(), String> {
    log::info!("[Paste] quick_paste 命令被调用, index={}", index);

    // 防重复触发：如果同一个索引的快速粘贴正在进行中，忽略新的请求
    let mut lock = QUICK_PASTE_LOCK.lock().await;
    if lock.contains(&index) {
        log::warn!("[Paste] 快速粘贴 index={} 正在进行中，忽略重复请求", index);
        return Ok(());
    }
    lock.push(index);
    drop(lock);

    // 创建锁守卫器，函数结束时自动移除锁
    let _guard = QuickPasteLockGuard::new(index);

    // 1. 从数据库查询第 index 个条目
    let db_state = match app_handle.try_state::<DatabaseState>() {
        Some(state) => state,
        None => {
            log::error!("[Paste] 数据库插件未初始化");
            return Err("数据库插件未初始化".to_string());
        }
    };

    log::info!("[Paste] 正在查询数据库, offset={}", index - 1);

    // 在阻塞线程池中执行数据库查询
    let db_state_arc = Arc::clone(&db_state);
    let query_index = index;
    let items: Vec<HistoryItem> = tokio::task::spawn_blocking(move || {
        let db = db_state_arc.blocking_lock();
        let options = QueryOptions {
            only_favorites: false,
            exclude_deleted: true,
            limit: Some(1),
            offset: Some((query_index - 1) as i32),
            order_by: Some("time DESC".to_string()),
            where_clause: None,
            params: None,
        };
        db.query_history(options)
    })
    .await
    .map_err(|e| {
        log::error!("[Paste] 数据库查询任务失败: {:?}", e);
        "数据库查询任务失败".to_string()
    })?
    .map_err(|e| {
        log::error!("[Paste] 查询数据库失败: {:?}", e);
        format!("查询数据库失败: {}", e)
    })?;

    log::info!("[Paste] 查询到 {} 条数据", items.len());

    if items.is_empty() {
        log::warn!("[Paste] 快速粘贴: 第 {} 个位置没有数据", index);
        return Ok(());
    }

    let item = &items[0];
    let item_type = item.item_type.as_deref().unwrap_or("text");
    let value = item.value.clone().unwrap_or_default();
    let search = item.search.clone().unwrap_or_default();

    let id = item.id.clone();

    log::info!(
        "[Paste] 快速粘贴: index={}, id={}, type={}",
        index,
        id,
        item_type
    );

    // 2. 根据类型写入剪贴板
    log::info!("[Paste] 正在写入剪贴板, type={}", item_type);
    let write_result = write_to_clipboard(item_type, &value, &search);

    match write_result {
        Ok(_) => {
            log::info!("[Paste] 剪贴板写入成功, 等待粘贴...");
            // 写入成功，延迟后执行粘贴（增加延迟确保剪贴板同步）
            // 使用多次短延迟，确保剪贴板完全更新
            for _ in 0..10 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }

            // 3. 执行粘贴操作
            log::info!("[Paste] 执行粘贴操作");
            paste().await;

            log::info!("[Paste] 快速粘贴成功: id={}", id);
            Ok(())
        }
        Err(e) => {
            log::error!("[Paste] 写入剪贴板失败: {}", e);
            Err(e)
        }
    }
}

/// 根据类型写入剪贴板（直接使用 clipboard-rs）
fn write_to_clipboard(item_type: &str, value: &str, search: &str) -> Result<(), String> {
    use clipboard_rs::{
        common::RustImage, Clipboard, ClipboardContent, ClipboardContext, RustImageData,
    };

    let text = if search.is_empty() { value } else { search };
    let context = ClipboardContext::new().map_err(|e| e.to_string())?;

    match item_type {
        // 图片类型
        "image" => {
            if !value.is_empty() {
                log::info!("[Paste] 写入图片到剪贴板");
                let image = RustImageData::from_path(value).map_err(|e| e.to_string())?;
                context.set_image(image).map_err(|e| e.to_string())
            } else {
                Ok(())
            }
        }
        // HTML 富文本
        "formatted" | "html" => {
            if !value.is_empty() {
                log::info!("[Paste] 写入 HTML 到剪贴板");
                let contents = vec![
                    ClipboardContent::Text(text.to_string()),
                    ClipboardContent::Html(value.to_string()),
                ];
                context.set(contents).map_err(|e| e.to_string())
            } else {
                context
                    .set_text(text.to_string())
                    .map_err(|e| e.to_string())
            }
        }
        // RTF 富文本
        "rtf" => {
            log::info!("[Paste] 写入 RTF 到剪贴板");
            let mut contents = vec![ClipboardContent::Rtf(value.to_string())];
            if !cfg!(target_os = "macos") {
                contents.push(ClipboardContent::Text(text.to_string()));
            }
            context.set(contents).map_err(|e| e.to_string())
        }
        // 其他所有类型（包括文本、代码等）都写入纯文本
        _ => {
            log::info!("[Paste] 写入文本到剪贴板");
            context
                .set_text(text.to_string())
                .map_err(|e| e.to_string())
        }
    }
}
