use std::path::PathBuf;

use clipboard_rs::common::{RustImage, RustImageData};
use tauri::{AppHandle, Manager, Runtime};

/// 获取文件大小（字节），失败返回 1
pub fn get_file_size(path: &PathBuf) -> i32 {
    std::fs::metadata(path)
        .ok()
        .map(|m| m.len() as i32)
        .unwrap_or(1)
}

/// 检查文件是否为图片格式
pub fn is_image_file(path: &str) -> bool {
    static IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"];
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    ext.map(|e| IMAGE_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false)
}

pub fn is_all_images(files: &[String]) -> bool {
    files.iter().all(|f| is_image_file(f))
}

/// 生成唯一 ID（基于时间戳的纳秒级哈希）
pub fn generate_id() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp)
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
