//! 颜色检测器
//! 支持 HEX、RGB、CMYK 格式检测和转换

use regex::Regex;

/// 检测是否为颜色值（支持 Hex/RGB/CMYK 格式）
pub fn detect_color(s: &str) -> bool {
    // Hex 格式: #RGB, #RRGGBB, #RRGGBBAA
    let hex_re = Regex::new(r"^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{8})$").unwrap();
    if hex_re.is_match(s) {
        return true;
    }

    // RGB 格式: rgb(r, g, b) 或 rgba(r, g, b, a)
    let rgb_re = Regex::new(r"^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+)?\s*\)$").unwrap();
    if rgb_re.is_match(s) {
        return true;
    }

    // CMYK 格式: cmyk(c, m, y, k)
    let cmyk_re = Regex::new(r"^cmyk\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$").unwrap();
    if cmyk_re.is_match(s) {
        return true;
    }

    // 向量格式: r,g,b (0-255)
    let rgb_vector_re = Regex::new(r"^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$").unwrap();
    if rgb_vector_re.is_match(s) {
        let parts: Vec<&str> = s.split(',').collect();
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
    if cmyk_vector_re.is_match(s) {
        let parts: Vec<&str> = s.split(',').collect();
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
    /// HEX 转 RGB
    pub fn hex_to_rgb(hex: &str) -> Option<(u8, u8, u8)> {
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
    pub fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
        format!("#{:02x}{:02x}{:02x}", r, g, b)
    }

    /// RGB 转 CMYK
    pub fn rgb_to_cmyk(r: u8, g: u8, b: u8) -> (u8, u8, u8, u8) {
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
    pub fn cmyk_to_rgb(c: u8, m: u8, y: u8, k: u8) -> (u8, u8, u8) {
        let c_dec = c as f64 / 100.0;
        let m_dec = m as f64 / 100.0;
        let y_dec = y as f64 / 100.0;
        let k_dec = k as f64 / 100.0;

        let r = (255.0 * (1.0 - c_dec) * (1.0 - k_dec)).round() as u8;
        let g = (255.0 * (1.0 - m_dec) * (1.0 - k_dec)).round() as u8;
        let b = (255.0 * (1.0 - y_dec) * (1.0 - k_dec)).round() as u8;

        (r, g, b)
    }

    /// 颜色值转 RGB 向量字符串
    pub fn rgb_to_vector_string(r: u8, g: u8, b: u8) -> String {
        format!("{}, {}, {}", r, g, b)
    }

    /// CMYK 值转向量字符串
    pub fn cmyk_to_vector_string(c: u8, m: u8, y: u8, k: u8) -> String {
        format!("{}, {}, {}, {}", c, m, y, k)
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
        // HEX 转 RGB
        assert_eq!(hex_to_rgb("#FF0000"), Some((255, 0, 0)));
        assert_eq!(hex_to_rgb("#f00"), Some((255, 0, 0)));
        assert_eq!(hex_to_rgb("#00FF00"), Some((0, 255, 0)));

        // RGB 转 HEX
        assert_eq!(rgb_to_hex(255, 0, 0), "#ff0000");
        assert_eq!(rgb_to_hex(0, 255, 0), "#00ff00");

        // RGB 转 CMYK
        assert_eq!(rgb_to_cmyk(255, 0, 0), (0, 100, 100, 0)); // 红色
        assert_eq!(rgb_to_cmyk(0, 255, 0), (100, 0, 100, 0)); // 绿色
        assert_eq!(rgb_to_cmyk(0, 0, 0), (0, 0, 0, 100)); // 黑色

        // CMYK 转 RGB
        assert_eq!(cmyk_to_rgb(0, 100, 100, 0), (255, 0, 0)); // 红色
        assert_eq!(cmyk_to_rgb(0, 0, 0, 100), (0, 0, 0)); // 黑色
        assert_eq!(cmyk_to_rgb(100, 100, 100, 0), (0, 0, 0)); // 纯青

        // 向量字符串转换
        assert_eq!(rgb_to_vector_string(255, 128, 64), "255, 128, 64");
        assert_eq!(cmyk_to_vector_string(100, 50, 0, 25), "100, 50, 0, 25");
    }

    #[test]
    fn test_not_color() {
        assert!(!detect_color("red"));
        assert!(!detect_color("not a color"));
        assert!(!detect_color("hsl(0, 100%, 50%)"));
    }
}
