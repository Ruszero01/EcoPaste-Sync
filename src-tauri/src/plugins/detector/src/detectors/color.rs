//! 颜色检测器
//! 支持 HEX、RGB、CMYK 格式检测和转换

use regex::Regex;

/// 检测是否为颜色值（支持 Hex/RGB/CMYK 格式）
pub fn detect_color(s: &str) -> bool {
    // 先修剪空白字符
    let trimmed = s.trim();

    // Hex 格式: #RGB, #RRGGBB, #RRGGBBAA
    let hex_re = Regex::new(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{8})$").unwrap();
    if hex_re.is_match(trimmed) {
        return true;
    }

    // RGB 格式: rgb(r, g, b) 或 rgba(r, g, b, a)
    let rgb_re = Regex::new(r"^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+)?\s*\)$").unwrap();
    if rgb_re.is_match(trimmed) {
        return true;
    }

    // CMYK 格式: cmyk(c, m, y, k)
    let cmyk_re = Regex::new(r"^cmyk\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$").unwrap();
    if cmyk_re.is_match(trimmed) {
        return true;
    }

    // 向量格式: r,g,b (0-255)
    let rgb_vector_re = Regex::new(r"^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$").unwrap();
    if rgb_vector_re.is_match(trimmed) {
        let parts: Vec<&str> = trimmed.split(',').collect();
        if parts.len() == 3 {
            if let (Ok(_), Ok(_), Ok(_)) = (
                parts[0].trim().parse::<u8>(),
                parts[1].trim().parse::<u8>(),
                parts[2].trim().parse::<u8>(),
            ) {
                // 成功解析为3个有效的u8值（0-255），认为是RGB向量格式
                return true;
            }
        }
    }

    // 向量格式: c,m,y,k (0-100)
    let cmyk_vector_re = Regex::new(r"^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$").unwrap();
    if cmyk_vector_re.is_match(trimmed) {
        let parts: Vec<&str> = trimmed.split(',').collect();
        if parts.len() == 4 {
            if let (Ok(c), Ok(m), Ok(y), Ok(k)) = (
                parts[0].trim().parse::<u8>(),
                parts[1].trim().parse::<u8>(),
                parts[2].trim().parse::<u8>(),
                parts[3].trim().parse::<u8>(),
            ) {
                return c <= 100 && m <= 100 && y <= 100 && k <= 100;
            }
        }
    }

    false
}

/// 获取颜色格式类型
pub fn get_color_format(s: &str) -> Option<String> {
    let trimmed = s.trim();

    // Hex 格式
    let hex_re = Regex::new(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{8})$").unwrap();
    if hex_re.is_match(trimmed) {
        return Some("hex".to_string());
    }

    // RGB 格式
    let rgb_re = Regex::new(r"^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+)?\s*\)$").unwrap();
    if rgb_re.is_match(trimmed) {
        return Some("rgb".to_string());
    }

    // CMYK 格式
    let cmyk_re = Regex::new(r"^cmyk\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$").unwrap();
    if cmyk_re.is_match(trimmed) {
        return Some("cmyk".to_string());
    }

    // 向量格式判断
    let parts: Vec<&str> = trimmed.split(',').collect();
    if parts.len() == 3 {
        // 解析为u8后自动验证范围（0-255）
        if let (Ok(_), Ok(_), Ok(_)) = (
            parts[0].trim().parse::<u8>(),
            parts[1].trim().parse::<u8>(),
            parts[2].trim().parse::<u8>(),
        ) {
            return Some("rgb".to_string());
        }
    }

    if parts.len() == 4 {
        let values: Vec<u8> = parts
            .iter()
            .filter_map(|p| p.trim().parse::<u8>().ok())
            .collect();
        if values.len() == 4 && values.iter().all(|v| *v <= 100) {
            return Some("cmyk".to_string());
        }
    }

    None
}

/// 颜色格式转换
pub mod conversion {
    use super::get_color_format;

    /// 目标颜色类型
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum TargetType {
        /// RGB 向量格式 (r, g, b)
        RgbVector,
        /// HEX 格式 (#RRGGBB)
        Hex,
        /// CMYK 格式 (c, m, y, k)
        Cmyk,
        /// RGB 元组 (r, g, b)
        Rgb,
    }

    /// HEX 转 RGB
    fn hex_to_rgb(hex: &str) -> Option<(u8, u8, u8)> {
        let clean_hex = hex.trim().trim_start_matches('#');

        if clean_hex.len() != 6 && clean_hex.len() != 3 {
            return None;
        }

        let expanded = if clean_hex.len() == 3 {
            clean_hex
                .chars()
                .map(|c| format!("{}{}", c, c))
                .collect::<String>()
        } else {
            clean_hex.to_string()
        };

        let r = u8::from_str_radix(&expanded[0..2], 16).ok()?;
        let g = u8::from_str_radix(&expanded[2..4], 16).ok()?;
        let b = u8::from_str_radix(&expanded[4..6], 16).ok()?;

        Some((r, g, b))
    }

    /// RGB 转 HEX
    fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
        format!("#{:02x}{:02x}{:02x}", r, g, b)
    }

    /// RGB 转 CMYK
    fn rgb_to_cmyk(r: u8, g: u8, b: u8) -> (u8, u8, u8, u8) {
        let r_dec = r as f64 / 255.0;
        let g_dec = g as f64 / 255.0;
        let b_dec = b as f64 / 255.0;

        let k = 1.0 - r_dec.max(g_dec).max(b_dec);

        if k == 1.0 {
            return (0, 0, 0, 100);
        }

        let c = ((1.0 - r_dec - k) / (1.0 - k) * 100.0).round() as u8;
        let m = ((1.0 - g_dec - k) / (1.0 - k) * 100.0).round() as u8;
        let y = ((1.0 - b_dec - k) / (1.0 - k) * 100.0).round() as u8;
        let k = (k * 100.0).round() as u8;

        (c, m, y, k)
    }

    /// CMYK 转 RGB
    fn cmyk_to_rgb(c: u8, m: u8, y: u8, k: u8) -> (u8, u8, u8) {
        let c_dec = c as f64 / 100.0;
        let m_dec = m as f64 / 100.0;
        let y_dec = y as f64 / 100.0;
        let k_dec = k as f64 / 100.0;

        let r = (255.0 * (1.0 - c_dec) * (1.0 - k_dec)).round() as u8;
        let g = (255.0 * (1.0 - m_dec) * (1.0 - k_dec)).round() as u8;
        let b = (255.0 * (1.0 - y_dec) * (1.0 - k_dec)).round() as u8;

        (r, g, b)
    }

    /// 解析 rgb(r, g, b) 或 rgba(r, g, b, a) 格式
    fn parse_rgb_color(s: &str) -> Option<(u8, u8, u8)> {
        let s = s.trim();
        let content = s.trim_start_matches("rgba")
            .trim_start_matches("rgb")
            .trim_start_matches('(')
            .trim_end_matches(')');
        let parts: Vec<&str> = content.split(',').collect();
        if parts.len() < 3 {
            return None;
        }
        let r = parts[0].trim().parse().ok()?;
        let g = parts[1].trim().parse().ok()?;
        let b = parts[2].trim().parse().ok()?;
        Some((r, g, b))
    }

    /// 解析 cmyk(c, m, y, k) 格式
    fn parse_cmyk_color(s: &str) -> Option<(u8, u8, u8)> {
        let s = s.trim();
        let content = s.trim_start_matches("cmyk")
            .trim_start_matches('(')
            .trim_end_matches(')');
        let parts: Vec<&str> = content.split(',').collect();
        if parts.len() != 4 {
            return None;
        }
        let c = parts[0].trim().parse().ok()?;
        let m = parts[1].trim().parse().ok()?;
        let y = parts[2].trim().parse().ok()?;
        let k = parts[3].trim().parse().ok()?;
        Some(cmyk_to_rgb(c, m, y, k))
    }

    /// 将任意颜色格式转换为 RGB
    fn color_to_rgb(color: &str) -> Option<(u8, u8, u8)> {
        let format = get_color_format(color)?;
        match format.as_str() {
            "hex" => hex_to_rgb(color),
            "rgb" => parse_rgb_color(color),
            "cmyk" => parse_cmyk_color(color),
            _ => None,
        }
    }

    /// 通用颜色转换函数
    ///
    /// 将任意格式的颜色转换为指定的目标格式
    ///
    /// # Arguments
    /// * `color` - 输入颜色值
    /// * `target` - 目标格式类型
    ///
    /// # Returns
    /// 转换后的字符串，失败返回 None
    pub fn convert(color: &str, target: TargetType) -> Option<String> {
        let rgb = color_to_rgb(color)?;

        match target {
            TargetType::RgbVector => Some(format!("{}, {}, {}", rgb.0, rgb.1, rgb.2)),
            TargetType::Hex => Some(rgb_to_hex(rgb.0, rgb.1, rgb.2)),
            TargetType::Cmyk => {
                let (c, m, y, k) = rgb_to_cmyk(rgb.0, rgb.1, rgb.2);
                Some(format!("{}, {}, {}, {}", c, m, y, k))
            }
            TargetType::Rgb => Some(format!("{}, {}, {}", rgb.0, rgb.1, rgb.2)),
        }
    }

    /// 将任意颜色格式转换为 RGB 向量字符串（用于去重）
    pub fn color_to_rgb_vector(color: &str) -> Option<String> {
        convert(color, TargetType::RgbVector)
    }

    /// 在颜色列表中查找与目标颜色相似的记录
    ///
    /// # Arguments
    /// * `new_search` - 新颜色的 search 字段（RGB 向量字符串）
    /// * `records` - 现有颜色记录列表 (id, search)
    ///
    /// # Returns
    /// 返回第一个相似颜色的 id（在容差范围内），如果没有相似的返回 None
    pub fn find_similar_color(new_search: &str, records: &[(String, String)]) -> Option<String> {
        let rgb_new = color_to_rgb_vector(new_search)?;

        // 解析 RGB 向量
        let parse_rgb = |s: &str| -> Option<(u8, u8, u8)> {
            let parts: Vec<&str> = s.split(',').collect();
            if parts.len() == 3 {
                let r = parts[0].trim().parse().ok()?;
                let g = parts[1].trim().parse().ok()?;
                let b = parts[2].trim().parse().ok()?;
                Some((r, g, b))
            } else {
                None
            }
        };

        let rgb_new = parse_rgb(&rgb_new)?;

        for (id, existing_search) in records {
            if let Some(rgb_existing) = color_to_rgb_vector(existing_search) {
                if let Some((r1, g1, b1)) = parse_rgb(&rgb_existing) {
                    // 计算欧几里得距离
                    let diff_r = rgb_new.0 as f64 - r1 as f64;
                    let diff_g = rgb_new.1 as f64 - g1 as f64;
                    let diff_b = rgb_new.2 as f64 - b1 as f64;
                    let distance = (diff_r * diff_r + diff_g * diff_g + diff_b * diff_b).sqrt();

                    // 容差阈值：距离 <= 10 视为相似颜色
                    if distance <= 10.0 {
                        return Some(id.clone());
                    }
                }
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::conversion::*;

    #[test]
    fn test_hex_color() {
        assert!(detect_color("#FFF"));
        assert!(detect_color("#FFFFFF"));
        assert!(detect_color("#FFFA"));
        assert!(detect_color("#FFFFFFFF"));
        assert_eq!(get_color_format("#FF5733"), Some("hex".to_string()));
    }

    #[test]
    fn test_rgb_color() {
        assert!(detect_color("rgb(255, 255, 255)"));
        assert!(detect_color("rgba(255, 255, 255, 0.5)"));
        assert!(detect_color("255, 255, 255"));
        assert_eq!(get_color_format("rgb(255, 0, 0)"), Some("rgb".to_string()));
        assert_eq!(get_color_format("255, 128, 64"), Some("rgb".to_string()));
    }

    #[test]
    fn test_cmyk_color() {
        assert!(detect_color("cmyk(100, 0, 0, 0)"));
        assert!(detect_color("0, 100, 50, 25"));
        assert_eq!(get_color_format("cmyk(100, 50, 0, 0)"), Some("cmyk".to_string()));
        assert_eq!(get_color_format("0, 100, 50, 25"), Some("cmyk".to_string()));
    }

    #[test]
    fn test_color_conversion() {
        // 使用统一的 convert 函数
        assert_eq!(convert("#FF0000", TargetType::RgbVector), Some("255, 0, 0".to_string()));
        assert_eq!(convert("#f00", TargetType::RgbVector), Some("255, 0, 0".to_string()));
        assert_eq!(convert("#00FF00", TargetType::RgbVector), Some("0, 255, 0".to_string()));

        // 转 HEX
        assert_eq!(convert("rgb(255, 0, 0)", TargetType::Hex), Some("#ff0000".to_string()));
        assert_eq!(convert("cmyk(0, 100, 100, 0)", TargetType::Hex), Some("#ff0000".to_string()));

        // 转 CMYK
        assert_eq!(convert("#FF0000", TargetType::Cmyk), Some("0, 100, 100, 0".to_string()));
        assert_eq!(convert("rgb(0, 255, 0)", TargetType::Cmyk), Some("100, 0, 100, 0".to_string()));

        // 转 RGB
        assert_eq!(convert("#FF0000", TargetType::Rgb), Some("255, 0, 0".to_string()));

        // 去重函数复用 convert
        assert_eq!(color_to_rgb_vector("#FF0000"), Some("255, 0, 0".to_string()));
        assert_eq!(color_to_rgb_vector("rgb(0, 255, 0)"), Some("0, 255, 0".to_string()));
        assert_eq!(color_to_rgb_vector("cmyk(0, 0, 0, 100)"), Some("0, 0, 0".to_string()));
    }

    #[test]
    fn test_not_color() {
        assert!(!detect_color("red"));
        assert!(!detect_color("not a color"));
        assert!(!detect_color("hsl(0, 100%, 50%)"));
    }
}
