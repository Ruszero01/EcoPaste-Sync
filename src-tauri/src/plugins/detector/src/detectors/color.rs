//! 颜色检测器

use regex::Regex;

/// 检测是否为颜色值（支持 Hex/RGB/HSL 格式）
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

    // HSL 格式: hsl(h, s, l) 或 hsla(h, s, l, a)
    let hsl_re = Regex::new(r"^hsla?\(\s*\d+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+)?\s*\)$").unwrap();
    if hsl_re.is_match(s) {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_color() {
        assert!(detect_color("#FFF"));
        assert!(detect_color("#FFFFFF"));
        assert!(detect_color("#FFFA"));
        assert!(detect_color("#FFFFFFFF"));
    }

    #[test]
    fn test_rgb_color() {
        assert!(detect_color("rgb(255, 255, 255)"));
        assert!(detect_color("rgba(255, 255, 255, 0.5)"));
    }

    #[test]
    fn test_hsl_color() {
        assert!(detect_color("hsl(0, 100%, 50%)"));
        assert!(detect_color("hsla(0, 100%, 50%, 0.5)"));
    }

    #[test]
    fn test_not_color() {
        assert!(!detect_color("red"));
        assert!(!detect_color("not a color"));
    }
}
