use std::path::PathBuf;

use clipboard_rs::common::{RustImage, RustImageData};
use tauri::{AppHandle, Manager, Runtime};

use tauri_plugin_eco_common::{file::get_file_size, id::generate_id};

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
