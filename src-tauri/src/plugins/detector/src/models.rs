//! 类型检测数据模型

use serde::{Deserialize, Serialize};

pub use tauri_plugin_eco_common::types::detection::TypeDetectionResult;

/// 内容类型枚举（预留用于未来扩展）
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ContentType {
    Text,
    Html,
    Rtf,
    Image,
    Files,
    Color,
    Markdown,
}

/// 检测配置（预留用于未来扩展）
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct DetectionConfig {
    pub enable_code_detection: bool,
    pub enable_color_detection: bool,
    pub code_min_length: usize,
}

impl Default for DetectionConfig {
    fn default() -> Self {
        Self {
            enable_code_detection: false,
            enable_color_detection: true,
            code_min_length: 10,
        }
    }
}
