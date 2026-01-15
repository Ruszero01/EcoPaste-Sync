//! 文件操作模块
//! 提供文件工具函数

use std::path::PathBuf;

/// 获取文件大小（字节），失败返回 1
#[inline]
pub fn get_file_size(path: &PathBuf) -> i32 {
    std::fs::metadata(path)
        .ok()
        .map(|m| m.len() as i32)
        .unwrap_or(1)
}

/// 检查文件是否为图片格式
#[inline]
pub fn is_image_file(path: &str) -> bool {
    static IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"];
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    ext.map(|e| IMAGE_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false)
}

/// 检查文件列表是否全为图片
#[inline]
pub fn is_all_images(files: &[String]) -> bool {
    files.iter().all(|f| is_image_file(f))
}
