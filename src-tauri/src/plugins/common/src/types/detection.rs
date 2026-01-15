//! 检测类型模块
//! 提供内容检测相关的类型定义

use serde::{Deserialize, Serialize};

/// 检测选项
#[derive(Debug, Clone)]
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

/// 检测结果
#[derive(Debug, Default)]
pub struct DetectionResult {
    pub subtype: Option<String>,
    pub is_code: bool,
    pub code_language: Option<String>,
    pub is_markdown: bool,
    pub color_normalized: Option<String>,
}

/// 类型检测结果（供前端使用）
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDetectionResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    #[serde(default)]
    pub is_code: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_language: Option<String>,
    #[serde(default)]
    pub is_markdown: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_normalized: Option<String>,
}

/// 检测选项（兼容旧接口）
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// 颜色转换类型
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorConvertType {
    /// 转换为 RGB 向量格式 (r, g, b)
    RgbVector,
    /// 转换为 HEX 格式 (#RRGGBB)
    Hex,
    /// 转换为 CMYK 格式 (c, m, y, k)
    Cmyk,
    /// 转换为 RGB 格式 (r, g, b)
    Rgb,
}

/// 目标颜色格式
#[derive(Debug, Clone, Copy)]
pub enum TargetType {
    RgbVector,
    Hex,
    Cmyk,
    Rgb,
}

impl From<ColorConvertType> for TargetType {
    fn from(t: ColorConvertType) -> Self {
        match t {
            ColorConvertType::RgbVector => TargetType::RgbVector,
            ColorConvertType::Hex => TargetType::Hex,
            ColorConvertType::Cmyk => TargetType::Cmyk,
            ColorConvertType::Rgb => TargetType::Rgb,
        }
    }
}

/// 颜色转换结果
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorConvertResult {
    /// 转换后的值
    pub value: String,
    /// 是否转换成功
    pub success: bool,
    /// 错误信息（如果失败）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
