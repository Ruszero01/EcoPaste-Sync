//! 检测器模块
//!
//! 提供各种内容类型检测器，可独立使用或组合使用

use serde::{Deserialize, Serialize};

mod code;
mod color;
mod email;
mod markdown;
mod path;
mod url;

pub use code::detect_code;
pub use color::conversion::TargetType;
pub use color::{conversion, detect_color, get_color_format};
pub use email::detect_email;
pub use markdown::detect_markdown;
pub use path::detect_path;
pub use url::detect_url;

/// 检测结果
#[derive(Debug, Clone, Default)]
pub struct DetectionResult {
    pub subtype: Option<String>,
    pub is_code: bool,
    pub code_language: Option<String>,
    pub is_markdown: bool,
    /// 颜色标准化值（RGB向量字符串），用于颜色去重
    pub color_normalized: Option<String>,
}

/// 检测选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionOptions {
    pub detect_url: bool,
    pub detect_email: bool,
    pub detect_path: bool,
    pub detect_color: bool,
    pub detect_code: bool,
    pub detect_markdown: bool,
    pub code_min_length: usize,
}

impl Default for DetectionOptions {
    fn default() -> Self {
        Self {
            detect_url: true,
            detect_email: true,
            detect_path: true,
            detect_color: true,
            detect_code: false,
            detect_markdown: true,
            code_min_length: 10,
        }
    }
}
