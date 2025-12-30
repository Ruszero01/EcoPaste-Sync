//! 类型检测命令模块
//!
//! 提供内容类型检测功能

use crate::{models::TypeDetectionResult, detectors::{DetectionOptions, DetectionResult}};
use serde::{Deserialize, Serialize};

/// 检测内容类型
///
/// 检测顺序：URL → 邮箱 → 路径 → 颜色 → 代码 → Markdown
/// 如果匹配到某个类型，立即返回，不会继续检测其他类型
#[tauri::command]
pub async fn detect_content(
    content: String,
    item_type: String,
    options: DetectionOptions,
) -> Result<TypeDetectionResult, String> {
    // 只有文本类型才需要进行子类型检测
    if item_type != "text" {
        return Ok(TypeDetectionResult::default());
    }

    // 按优先级进行检测
    let result = run_detection(&content, &options);

    Ok(TypeDetectionResult {
        subtype: result.subtype,
        is_code: result.is_code,
        code_language: result.code_language,
        is_markdown: result.is_markdown,
        color_normalized: result.color_normalized,
    })
}

/// 运行类型检测（按优先级）
pub fn run_detection(content: &str, options: &DetectionOptions) -> DetectionResult {
    use crate::detectors::{detect_url, detect_email, detect_path, detect_color, detect_code, detect_markdown};

    // URL 检测
    if options.detect_url && detect_url(content) {
        return DetectionResult {
            subtype: Some("url".to_string()),
            ..Default::default()
        };
    }

    // 邮箱检测
    if options.detect_email && detect_email(content) {
        return DetectionResult {
            subtype: Some("email".to_string()),
            ..Default::default()
        };
    }

    // 路径检测
    if options.detect_path && detect_path(content) {
        return DetectionResult {
            subtype: Some("path".to_string()),
            ..Default::default()
        };
    }

    // 颜色检测
    if options.detect_color && detect_color(content) {
        // 将颜色转换为 RGB 向量字符串用于去重
        let color_normalized = crate::detectors::conversion::color_to_rgb_vector(content);
        return DetectionResult {
            subtype: Some("color".to_string()),
            color_normalized,
            ..Default::default()
        };
    }

    // 代码检测（如果开启）
    if options.detect_code {
        let code_result = detect_code(content, options.code_min_length);
        if code_result.is_code {
            return DetectionResult {
                is_code: true,
                code_language: code_result.language,
                ..Default::default()
            };
        }
    }

    // Markdown 检测（如果开启）
    if options.detect_markdown && detect_markdown(content) {
        return DetectionResult {
            is_markdown: true,
            ..Default::default()
        };
    }

    DetectionResult::default()
}

/// 检测选项（兼容旧接口）
#[derive(Debug, Serialize, Deserialize)]
pub struct LegacyDetectionOptions {
    pub detect_url: bool,
    pub detect_email: bool,
    pub detect_path: bool,
    pub detect_color: bool,
    pub detect_code: bool,
    pub detect_markdown: bool,
}

impl Default for LegacyDetectionOptions {
    fn default() -> Self {
        Self {
            detect_url: true,
            detect_email: true,
            detect_path: true,
            detect_color: true,
            detect_code: false,
            detect_markdown: true,
        }
    }
}

impl From<LegacyDetectionOptions> for DetectionOptions {
    fn from(opt: LegacyDetectionOptions) -> Self {
        Self {
            detect_url: opt.detect_url,
            detect_email: opt.detect_email,
            detect_path: opt.detect_path,
            detect_color: opt.detect_color,
            detect_code: opt.detect_code,
            detect_markdown: opt.detect_markdown,
            code_min_length: 10,
        }
    }
}
