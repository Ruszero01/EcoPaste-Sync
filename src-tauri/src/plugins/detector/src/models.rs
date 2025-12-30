//! 类型检测数据模型

use serde::{Deserialize, Serialize};

/// 类型检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeDetectionResult {
    /// 子类型: url/email/path/color 等
    pub subtype: Option<String>,
    /// 是否为代码
    pub is_code: bool,
    /// 代码语言
    pub code_language: Option<String>,
    /// 是否为 Markdown
    pub is_markdown: bool,
    /// 颜色标准化值（RGB向量字符串），用于颜色去重
    pub color_normalized: Option<String>,
}

impl Default for TypeDetectionResult {
    fn default() -> Self {
        Self {
            subtype: None,
            is_code: false,
            code_language: None,
            is_markdown: false,
            color_normalized: None,
        }
    }
}

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
