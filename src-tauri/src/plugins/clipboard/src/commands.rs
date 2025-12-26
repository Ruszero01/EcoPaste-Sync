use clipboard_rs::{
    common::RustImage, Clipboard, ClipboardContent, ClipboardContext, ClipboardHandler,
    ClipboardWatcher, ClipboardWatcherContext, ContentFormat, RustImageData, WatcherShutdown,
};
use std::{
    fs::create_dir_all,
    hash::{DefaultHasher, Hash, Hasher},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::spawn,
};
use tauri::{command, AppHandle, Emitter, Manager, Runtime, State};

// 引入 database 插件
use tauri_plugin_eco_database::{DatabaseState, InsertItem};

// 用于生成唯一 ID
fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp)
}

pub struct ClipboardManager {
    context: Arc<Mutex<ClipboardContext>>,
    watcher_shutdown: Arc<Mutex<Option<WatcherShutdown>>>,
}

struct ClipboardListen<R>
where
    R: Runtime,
{
    app_handle: AppHandle<R>,
}

impl ClipboardManager {
    pub fn new() -> Self {
        ClipboardManager {
            context: Arc::new(Mutex::new(ClipboardContext::new().unwrap())),
            watcher_shutdown: Arc::default(),
        }
    }

    fn has(&self, format: ContentFormat) -> bool {
        self.context.lock().unwrap().has(format)
    }
}

impl<R> ClipboardListen<R>
where
    R: Runtime,
{
    fn new(app_handle: AppHandle<R>) -> Self {
        Self { app_handle }
    }
}

impl<R> ClipboardHandler for ClipboardListen<R>
where
    R: Runtime,
{
    fn on_clipboard_change(&mut self) {
        let app_handle = self.app_handle.clone();
        let manager = app_handle.state::<ClipboardManager>();

        // 获取数据库状态
        let db_state = match app_handle.try_state::<DatabaseState>() {
            Some(db) => db,
            None => return,
        };

        // 读取剪贴板内容
        let (item_type, group, value, search, count, subtype, file_size) = {
            let context = manager.context.lock().unwrap();

            if context.has(ContentFormat::Image) {
                // 图片 - 暂时跳过
                return;
            } else if context.has(ContentFormat::Files) {
                match context.get_files() {
                    Ok(files) => (
                        "files".to_string(),
                        "files".to_string(),
                        serde_json::to_string(&files).ok(),
                        Some(files.join(" ")),
                        Some(files.len() as i32),
                        None,
                        None,
                    ),
                    Err(_) => return,
                }
            } else if !context.has(ContentFormat::Html) && context.has(ContentFormat::Rtf) {
                match context.get_rich_text() {
                    Ok(rtf) => {
                        let text = context.get_text().ok();
                        (
                            "rtf".to_string(),
                            "text".to_string(),
                            Some(rtf.clone()),
                            text.clone(),
                            text.as_ref().map(|s| s.len() as i32),
                            Some("rtf".to_string()),
                            None,
                        )
                    }
                    Err(_) => return,
                }
            } else if context.has(ContentFormat::Html) {
                match context.get_html() {
                    Ok(html) => {
                        let text = context.get_text().ok();
                        (
                            "html".to_string(),
                            "text".to_string(),
                            Some(html),
                            text.clone(),
                            text.as_ref().map(|s| s.len() as i32),
                            None,
                            None,
                        )
                    }
                    Err(_) => return,
                }
            } else if context.has(ContentFormat::Text) {
                match context.get_text() {
                    Ok(text) => {
                        if text.is_empty() {
                            return;
                        }
                        let text_len = text.len() as i32;
                        (
                            "text".to_string(),
                            "text".to_string(),
                            Some(text.clone()),
                            Some(text),
                            Some(text_len),
                            None,
                            None,
                        )
                    }
                    Err(_) => return,
                }
            } else {
                return;
            }
        };

        // 构建 InsertItem
        let time = chrono::Utc::now().timestamp_millis();
        let item = InsertItem {
            id: generate_id(),
            item_type: Some(item_type),
            group: Some(group),
            value,
            search,
            count,
            width: None,
            height: None,
            favorite: 0,
            time,
            note: None,
            subtype,
            file_size,
            deleted: Some(0),
            sync_status: Some("not_synced".to_string()),
            code_language: None,
            is_code: Some(0),
            source_app_name: None,
            source_app_icon: None,
            position: None,
        };

        // 同步插入数据库
        let db = db_state.blocking_lock();
        match db.insert_with_deduplication(&item) {
            Ok(result) => {
                // 发送事件通知前端，携带重复数据的 ID（如果是更新操作）
                let payload = if result.is_update {
                    serde_json::json!({ "duplicate_id": result.insert_id })
                } else {
                    serde_json::json!({ "duplicate_id": null })
                };
                let _ = app_handle
                    .emit("plugin:eco-clipboard://database_updated", payload)
                    .map_err(|err| err.to_string());
            }
            Err(e) => {
                log::error!("插入剪贴板数据到数据库失败: {}", e);
            }
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct ReadImage {
    width: u32,
    height: u32,
    image: String,
}

#[command]
pub async fn start_listen<R: Runtime>(
    app_handle: AppHandle<R>,
    manager: State<'_, ClipboardManager>,
) -> Result<(), String> {
    let listener = ClipboardListen::new(app_handle.clone());

    let mut watcher: ClipboardWatcherContext<ClipboardListen<R>> =
        ClipboardWatcherContext::new().unwrap();

    let watcher_shutdown = watcher.add_handler(listener).get_shutdown_channel();

    let mut watcher_shutdown_state = manager.watcher_shutdown.lock().unwrap();

    if (*watcher_shutdown_state).is_some() {
        return Ok(());
    }

    *watcher_shutdown_state = Some(watcher_shutdown);

    spawn(move || {
        watcher.start_watch();
    });

    Ok(())
}

#[command]
pub async fn stop_listen(manager: State<'_, ClipboardManager>) -> Result<(), String> {
    let mut watcher_shutdown = manager.watcher_shutdown.lock().unwrap();

    if let Some(watcher_shutdown) = (*watcher_shutdown).take() {
        watcher_shutdown.stop();
    }

    *watcher_shutdown = None;

    Ok(())
}

#[command]
pub async fn has_files(manager: State<'_, ClipboardManager>) -> Result<bool, String> {
    Ok(manager.has(ContentFormat::Files))
}

#[command]
pub async fn has_image(manager: State<'_, ClipboardManager>) -> Result<bool, String> {
    Ok(manager.has(ContentFormat::Image))
}

#[command]
pub async fn has_html(manager: State<'_, ClipboardManager>) -> Result<bool, String> {
    Ok(manager.has(ContentFormat::Html))
}

#[command]
pub async fn has_rtf(manager: State<'_, ClipboardManager>) -> Result<bool, String> {
    Ok(manager.has(ContentFormat::Rtf))
}

#[command]
pub async fn has_text(manager: State<'_, ClipboardManager>) -> Result<bool, String> {
    Ok(manager.has(ContentFormat::Text))
}

#[command]
pub async fn read_files(manager: State<'_, ClipboardManager>) -> Result<Vec<String>, String> {
    let mut files = manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .get_files()
        .map_err(|err| err.to_string())?;

    files.iter_mut().for_each(|path| {
        *path = path.replace("file://", "");
    });

    Ok(files)
}

#[command]
pub async fn read_image(
    manager: State<'_, ClipboardManager>,
    path: PathBuf,
) -> Result<ReadImage, String> {
    create_dir_all(&path).map_err(|op| op.to_string())?;

    let image = manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .get_image()
        .map_err(|err| err.to_string())?;

    let (width, height) = image.get_size();

    let thumbnail_image = image
        .thumbnail(width / 10, height / 10)
        .map_err(|err| err.to_string())?;

    let bytes = thumbnail_image
        .to_png()
        .map_err(|err| err.to_string())?
        .get_bytes()
        .to_vec();

    let mut hasher = DefaultHasher::new();

    bytes.hash(&mut hasher);

    let hash = hasher.finish();

    let image_path = path.join(format!("{hash}.png"));

    if let Some(path) = image_path.to_str() {
        image.save_to_path(path).map_err(|err| err.to_string())?;

        let image = path.to_string();

        return Ok(ReadImage {
            width,
            height,
            image,
        });
    }

    Err("read_image execution error".to_string())
}

#[command]
pub async fn read_html(manager: State<'_, ClipboardManager>) -> Result<String, String> {
    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .get_html()
        .map_err(|err| err.to_string())
}

#[command]
pub async fn read_rtf(manager: State<'_, ClipboardManager>) -> Result<String, String> {
    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .get_rich_text()
        .map_err(|err| err.to_string())
}

#[command]
pub async fn read_text(manager: State<'_, ClipboardManager>) -> Result<String, String> {
    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .get_text()
        .map_err(|err| err.to_string())
}

#[command]
pub async fn write_files(
    manager: State<'_, ClipboardManager>,
    value: Vec<String>,
) -> Result<(), String> {
    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .set_files(value)
        .map_err(|err| err.to_string())
}

#[command]
pub async fn write_image(
    manager: State<'_, ClipboardManager>,
    value: String,
) -> Result<(), String> {
    let image = RustImageData::from_path(&value).map_err(|err| err.to_string())?;

    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .set_image(image)
        .map_err(|err| err.to_string())
}

#[command]
pub async fn write_html(
    manager: State<'_, ClipboardManager>,
    text: String,
    html: String,
) -> Result<(), String> {
    let contents = vec![ClipboardContent::Text(text), ClipboardContent::Html(html)];

    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .set(contents)
        .map_err(|err| err.to_string())
}

#[command]
pub async fn write_rtf(
    manager: State<'_, ClipboardManager>,
    text: String,
    rtf: String,
) -> Result<(), String> {
    let mut contents = vec![ClipboardContent::Rtf(rtf)];

    if cfg!(not(target_os = "macos")) {
        contents.push(ClipboardContent::Text(text))
    }

    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .set(contents)
        .map_err(|err| err.to_string())
}

#[command]
pub async fn write_text(manager: State<'_, ClipboardManager>, value: String) -> Result<(), String> {
    manager
        .context
        .lock()
        .map_err(|err| err.to_string())?
        .set_text(value)
        .map_err(|err| err.to_string())
}

#[command]
pub async fn get_image_dimensions(path: String) -> Result<ReadImage, String> {
    let image = RustImageData::from_path(&path).map_err(|err| err.to_string())?;
    let (width, height) = image.get_size();

    Ok(ReadImage {
        width,
        height,
        image: path,
    })
}

// get_clipboard_owner_process 已移至 database/source_app.rs
// 避免循环依赖
