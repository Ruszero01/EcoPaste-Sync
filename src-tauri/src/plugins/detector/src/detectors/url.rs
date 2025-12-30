//! URL 检测器

/// 检测是否为 URL
pub fn detect_url(s: &str) -> bool {
    s.starts_with("http://")
        || s.starts_with("https://")
        || s.starts_with("ftp://")
        || s.starts_with("file://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_http_url() {
        assert!(detect_url("http://example.com"));
        assert!(detect_url("https://example.com/path"));
    }

    #[test]
    fn test_ftp_url() {
        assert!(detect_url("ftp://files.example.com"));
    }

    #[test]
    fn test_not_url() {
        assert!(!detect_url("example.com"));
        assert!(!detect_url("just a string"));
    }
}
