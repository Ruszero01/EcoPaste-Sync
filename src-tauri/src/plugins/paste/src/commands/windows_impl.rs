use super::wait;
use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use std::sync::Arc;
use tauri::{command, AppHandle, Manager, Runtime};
use tauri_plugin_eco_database::{DatabaseState, HistoryItem, QueryOptions};
use tokio::sync::Mutex;

use tauri_plugin_eco_common::active_window::{get_last_valid_window_info, restore_focus_to_window};

use winapi::um::winuser::{GetAsyncKeyState, VK_CONTROL, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RSHIFT, VK_RWIN};

// ==================== 锁机制 ====================

static QUICK_PASTE_LOCK: Mutex<Vec<u32>> = Mutex::const_new(Vec::new());

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

// ==================== 剪贴板写入 ====================

fn write_to_clipboard(item_type: &str, value: &str, search: &str) -> Result<(), String> {
    use clipboard_rs::{
        common::RustImage, Clipboard, ClipboardContent, ClipboardContext, RustImageData,
    };

    let text = if search.is_empty() { value } else { search };
    let context = ClipboardContext::new().map_err(|e| e.to_string())?;

    match item_type {
        "image" => {
            if !value.is_empty() {
                log::debug!("[Paste] 写入图片到剪贴板");
                let image = RustImageData::from_path(value).map_err(|e| e.to_string())?;
                context.set_image(image).map_err(|e| e.to_string())
            } else {
                Ok(())
            }
        }
        "formatted" | "html" => {
            if !value.is_empty() {
                log::debug!("[Paste] 写入 HTML 到剪贴板");
                let contents = vec![
                    ClipboardContent::Text(text.to_string()),
                    ClipboardContent::Html(value.to_string()),
                ];
                context.set(contents).map_err(|e| e.to_string())
            } else {
                context.set_text(text.to_string()).map_err(|e| e.to_string())
            }
        }
        "rtf" => {
            log::debug!("[Paste] 写入 RTF 到剪贴板");
            let mut contents = vec![ClipboardContent::Rtf(value.to_string())];
            if !cfg!(target_os = "macos") {
                contents.push(ClipboardContent::Text(text.to_string()));
            }
            context.set(contents).map_err(|e| e.to_string())
        }
        _ => {
            log::debug!("[Paste] 写入文本到剪贴板");
            context.set_text(text.to_string()).map_err(|e| e.to_string())
        }
    }
}

// ==================== 内容大小计算 ====================

/// 计算内容大小（字节）
/// - 文本：字符长度（UTF-8 编码）
/// - 图片/文件：文件大小
fn get_content_size(item_type: &str, value: &str) -> usize {
    match item_type {
        "image" | "files" => {
            // 对于文件路径，尝试获取文件大小
            if !value.is_empty() {
                std::fs::metadata(value)
                    .map(|meta| meta.len() as usize)
                    .unwrap_or_else(|_| value.len())
            } else {
                value.len()
            }
        }
        _ => value.len(), // 文本类型使用字符串长度
    }
}

// ==================== 动态延迟计算 ====================

/// 根据内容类型和大小计算写入后等待时间（毫秒）
fn get_write_delay_ms(item_type: &str, size_bytes: usize) -> u64 {
    match item_type {
        "text" | "code" | "color" | "markdown" | "link" | "path" => {
            if size_bytes < 100 {
                15 // 短文本快速就绪
            } else if size_bytes < 1000 {
                25 // 中等文本
            } else {
                40 // 长文本
            }
        }
        "image" => {
            if size_bytes < 1_000_000 {
                40 // 小图片 < 1MB
            } else if size_bytes < 5_000_000 {
                75 // 中等图片 1-5MB
            } else {
                150 // 大图片 > 5MB
            }
        }
        "formatted" | "html" | "rtf" => {
            if size_bytes < 1000 {
                25
            } else if size_bytes < 5000 {
                35
            } else {
                50
            }
        }
        "files" => 40,
        _ => 30,
    }
}

/// 根据内容类型和大小计算粘贴后等待时间（毫秒）
fn get_paste_delay_ms(item_type: &str, size_bytes: usize) -> u64 {
    match item_type {
        "text" | "code" | "color" | "markdown" | "link" | "path" => {
            if size_bytes < 100 {
                20
            } else if size_bytes < 1000 {
                25
            } else {
                30
            }
        }
        "image" => {
            if size_bytes < 1_000_000 {
                40 // 小图片
            } else if size_bytes < 5_000_000 {
                50 // 中等图片
            } else {
                60 // 大图片
            }
        }
        "formatted" | "html" | "rtf" => 40,
        "files" => 40,
        _ => 30,
    }
}

/// 获取换行符等待时间（毫秒）
const NEWLINE_WRITE_DELAY_MS: u64 = 15;
const NEWLINE_PASTE_DELAY_MS: u64 = 40;

// ==================== 修饰键处理 ====================

fn release_all_modifier_keys(enigo: &mut Enigo) {
    let modifier_keys = [
        (VK_LSHIFT, Key::Shift),
        (VK_RSHIFT, Key::Shift),
        (VK_CONTROL, Key::Control),
        (VK_MENU, Key::Alt),
        (VK_LWIN, Key::LWin),
        (VK_RWIN, Key::RWin),
    ];

    for (vk_code, enigo_key) in modifier_keys.iter() {
        let state = unsafe { GetAsyncKeyState(*vk_code) };
        if (state & 0x8000u16 as i16) != 0 {
            let _ = enigo.key(*enigo_key, Release);
        }
    }
}

// ==================== 粘贴命令 ====================

#[command]
pub async fn paste() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();

    release_all_modifier_keys(&mut enigo);

    enigo.key(Key::LShift, Press).unwrap();
    enigo.key(Key::Insert, Click).unwrap();
    enigo.key(Key::LShift, Release).unwrap();

    wait(5);
}

#[command]
pub async fn paste_with_focus() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();

    if let Some(info) = get_last_valid_window_info() {
        let result = restore_focus_to_window(info.hwnd);
        if result as u32 == 0 {
            log::warn!("[Paste] 无法聚焦到上一个窗口");
        }
    } else {
        log::warn!("[Paste] 没有记录的上一个窗口");
    }

    wait(50);
    release_all_modifier_keys(&mut enigo);
    wait(10);

    enigo.key(Key::LShift, Press).unwrap();
    wait(5);
    enigo.key(Key::Insert, Click).unwrap();
    wait(5);
    enigo.key(Key::LShift, Release).unwrap();

    wait(20);
}

#[command]
pub async fn quick_paste<R: Runtime>(app_handle: AppHandle<R>, index: u32) -> Result<(), String> {
    log::info!("[Paste] quick_paste 命令被调用, index={}", index);

    let mut lock = QUICK_PASTE_LOCK.lock().await;
    if lock.contains(&index) {
        log::warn!("[Paste] 快速粘贴 index={} 正在进行中，忽略重复请求", index);
        return Ok(());
    }
    lock.push(index);
    drop(lock);

    let _guard = QuickPasteLockGuard::new(index);

    let db_state = match app_handle.try_state::<DatabaseState>() {
        Some(state) => state,
        None => {
            log::error!("[Paste] 数据库插件未初始化");
            return Err("数据库插件未初始化".to_string());
        }
    };

    log::debug!("[Paste] 正在查询数据库, offset={}", index - 1);

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

    log::debug!("[Paste] 正在写入剪贴板, type={}", item_type);
    let write_result = write_to_clipboard(item_type, &value, &search);

    match write_result {
        Ok(_) => {
            log::debug!("[Paste] 剪贴板写入成功, 等待粘贴...");
            for _ in 0..10 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }

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

// ==================== 批量粘贴命令 ====================

#[command]
pub async fn batch_paste<R: Runtime>(
    app_handle: AppHandle<R>,
    ids: Vec<String>,
    plain: bool,
) -> Result<(), String> {
    log::info!("[Paste] batch_paste 命令被调用, ids={:?}, plain={}", ids, plain);

    if ids.is_empty() {
        log::warn!("[Paste] 批量粘贴: 空 ID 列表");
        return Ok(());
    }

    let db_state = match app_handle.try_state::<DatabaseState>() {
        Some(state) => state,
        None => {
            log::error!("[Paste] 数据库插件未初始化");
            return Err("数据库插件未初始化".to_string());
        }
    };

    let db_state_arc = Arc::clone(&db_state);

    // 查询所有指定 ID 的项目
    let items: Vec<HistoryItem> = tokio::task::spawn_blocking(move || {
        let db = db_state_arc.blocking_lock();
        let mut all_items = Vec::new();

        for id in &ids {
            // 使用 query_history 查询单个 ID
            let options = QueryOptions {
                only_favorites: false,
                exclude_deleted: true,
                limit: Some(1),
                offset: None,
                order_by: None,
                where_clause: Some("id = ?".to_string()),
                params: Some(vec![id.clone()]),
            };

            match db.query_history(options) {
                Ok(mut items) => {
                    if let Some(item) = items.pop() {
                        all_items.push(item);
                    } else {
                        log::warn!("[Paste] 批量粘贴: 未找到 id={}", id);
                    }
                }
                Err(e) => {
                    log::error!("[Paste] 批量粘贴: 查询 id={} 失败: {}", id, e);
                }
            }
        }

        all_items
    })
    .await
    .map_err(|e| {
        log::error!("[Paste] 数据库查询任务失败: {:?}", e);
        "数据库查询任务失败".to_string()
    })?;

    log::info!("[Paste] 批量粘贴: 查询到 {} 条数据", items.len());

    if items.is_empty() {
        log::warn!("[Paste] 批量粘贴: 没有有效数据");
        return Ok(());
    }

    // 逐个粘贴
    for (i, item) in items.iter().enumerate() {
        let item_type = item.item_type.as_deref().unwrap_or("text");
        let value = item.value.clone().unwrap_or_default();
        let search = item.search.clone().unwrap_or_default();

        // 计算内容大小用于动态延迟
        let content_size = if plain { search.len() } else { get_content_size(item_type, &value) };
        let write_delay = get_write_delay_ms(item_type, content_size);
        let paste_delay = get_paste_delay_ms(item_type, content_size);

        log::debug!(
            "[Paste] 批量粘贴: 第 {}/{} 项, id={}, type={}, size={}",
            i + 1,
            items.len(),
            item.id,
            item_type,
            content_size
        );

        // 写入剪贴板
        let write_result = if plain {
            // 纯文本模式：始终使用 search 字段
            write_to_clipboard("text", &search, &search)
        } else {
            write_to_clipboard(item_type, &value, &search)
        };

        match write_result {
            Ok(_) => {
                // 写入后动态等待
                tokio::time::sleep(std::time::Duration::from_millis(write_delay)).await;

                // 执行粘贴
                paste_with_focus().await;

                // 粘贴后动态等待（给目标应用更多处理时间）
                tokio::time::sleep(std::time::Duration::from_millis(paste_delay)).await;

                // 如果不是最后一项，添加换行粘贴
                if i < items.len() - 1 {
                    // 写入换行符
                    let newline_result = {
                        use clipboard_rs::{Clipboard, ClipboardContext};
                        let context = ClipboardContext::new().map_err(|e| e.to_string())?;
                        context.set_text("\n".to_string()).map_err(|e| e.to_string())
                    };

                    match newline_result {
                        Ok(_) => {
                            // 换行符写入后等待
                            tokio::time::sleep(std::time::Duration::from_millis(NEWLINE_WRITE_DELAY_MS)).await;

                            paste_with_focus().await;

                            // 换行后等待
                            tokio::time::sleep(std::time::Duration::from_millis(NEWLINE_PASTE_DELAY_MS)).await;
                        }
                        Err(e) => {
                            log::warn!("[Paste] 批量粘贴: 换行符写入失败: {}", e);
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("[Paste] 批量粘贴: 第 {} 项写入失败: {}", i + 1, e);
            }
        }
    }

    log::info!("[Paste] 批量粘贴完成，共 {} 项", items.len());
    Ok(())
}
