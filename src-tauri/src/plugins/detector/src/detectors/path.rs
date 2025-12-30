//! 路径检测器

use std::path::Path;

/// 检测是否为文件路径
pub fn detect_path(s: &str) -> bool {
    // 检查是否为 file:// 协议路径
    if s.starts_with("file://") {
        return true;
    }

    // 检查路径是否存在
    Path::new(s).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_protocol() {
        assert!(detect_path("file:///C:/test.txt"));
    }

    #[test]
    fn test_nonexistent_path() {
        // 非 file:// 协议且路径不存在时返回 false
        assert!(!detect_path("/nonexistent/path"));
    }
}
