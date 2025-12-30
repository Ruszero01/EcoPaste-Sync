//! 邮箱检测器

use regex::Regex;

/// 检测是否为邮箱地址
pub fn detect_email(s: &str) -> bool {
    let email_regex = Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
    email_regex.is_match(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_email() {
        assert!(detect_email("test@example.com"));
        assert!(detect_email("user.name@domain.co.uk"));
    }

    #[test]
    fn test_invalid_email() {
        assert!(!detect_email("not an email"));
        assert!(!detect_email("@example.com"));
        assert!(!detect_email("user@"));
    }
}
