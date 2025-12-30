//! 代码检测器
//!
//! 使用正则表达式进行代码语言检测
//! 支持: Rust, TypeScript, JavaScript, Python, Go, C, C++, Java, C#, SQL, CSS

use regex::Regex;
use once_cell::sync::Lazy;

/// 代码检测结果
#[derive(Debug, Clone)]
pub struct CodeDetectionResult {
    pub is_code: bool,
    pub language: Option<String>,
}

/// 检查文本中是否包含多个指定关键词（至少 min_matches 个）
fn contains_multiple(text: &str, keywords: &[&str], min_matches: usize) -> bool {
    let lower = text.to_lowercase();
    let matches: usize = keywords
        .iter()
        .filter(|kw| lower.contains(&kw.to_lowercase()))
        .count();
    matches >= min_matches
}

/// 检查日志格式
fn is_log_format(text: &str) -> bool {
    // 时间戳模式 (简化)
    if Regex::new(r"\[\d{4}-\d{2}-\d{2}.*?\d{2}:\d{2}:\d{2}")
        .unwrap()
        .is_match(text)
    {
        return true;
    }

    // 日志级别
    if Regex::new(r"\[(DEBUG|INFO|WARN|ERROR|FATAL|CRITICAL|TRACE|NOTICE)\]")
        .unwrap()
        .is_match(text)
    {
        return true;
    }

    false
}

/// 检查是否为自然语言
fn is_natural_language(text: &str) -> bool {
    if is_log_format(text) {
        return true;
    }

    let common_words = [
        "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
        "this", "that", "which", "what", "when", "where", "who", "how", "is", "are", "was", "were",
        "have", "has", "had", "been", "being", "can", "could", "will", "would", "should", "may",
    ];

    let words: Vec<&str> = text.split_whitespace().filter(|w| w.len() > 2).collect();
    if words.is_empty() {
        return false;
    }

    let common_count = words
        .iter()
        .filter(|w| common_words.contains(&w.to_lowercase().as_str()))
        .count();
    let ratio = common_count as f32 / words.len() as f32;

    ratio > 0.3
}

/// 快速语言检测 - 基于全文特征
fn quick_language_detection(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();

    // C++ 特征
    if contains_multiple(
        text,
        &["int main", "cout", "cin", "<<", ">>", "using namespace std", "#include"],
        2,
    ) || contains_multiple(
        text,
        &["const_cast", "dynamic_cast", "reinterpret_cast", "static_cast"],
        2,
    ) || (contains_multiple(text, &["#include", "using namespace", "std::"], 2)
        && contains_multiple(text, &["int", "main"], 2))
    {
        return Some("C++");
    }

    // C 特征
    if contains_multiple(text, &["#include", "printf", "scanf", "malloc", "free"], 3)
        && !lower.contains("cout")
    {
        return Some("C");
    }

    // Java 特征 - 需要精确匹配 System.out.println
    if contains_multiple(
        text,
        &["public class", "public static void main", "System.out.println"],
        2,
    ) && !lower.contains("console.writeline")
    {
        return Some("Java");
    }

    // Python 特征
    if contains_multiple(text, &["def ", "import ", "print(", ":"], 2)
        && !lower.contains("function")
    {
        return Some("Python");
    }

    // JavaScript 特征
    if contains_multiple(
        text,
        &["function ", "const ", "let ", "var ", "console.log", "=>"],
        2,
    ) && !lower.contains("class main")
    {
        return Some("JavaScript");
    }

    // TypeScript 特征
    if contains_multiple(
        text,
        &["interface ", "type ", "as ", ": string", ": number", ": boolean"],
        2,
    ) {
        return Some("TypeScript");
    }

    // Rust 特征
    if contains_multiple(
        text,
        &["fn ", "let mut", "println!", "use std::", "-> ", "match ", "impl ", "pub fn"],
        2,
    ) {
        return Some("Rust");
    }

    // Go 特征
    if contains_multiple(
        text,
        &["func main", "package main", "import \"", "fmt.", "go "],
        2,
    ) {
        return Some("Go");
    }

    // C# 特征
    if contains_multiple(
        text,
        &["using System", "public class", "Console.WriteLine", "namespace "],
        2,
    ) {
        return Some("C#");
    }

    None
}

/// 检测是否为代码，并识别编程语言
pub fn detect_code(content: &str, min_length: usize) -> CodeDetectionResult {
    let trimmed = content.trim();

    if trimmed.len() < min_length {
        return CodeDetectionResult {
            is_code: false,
            language: None,
        };
    }

    if is_natural_language(trimmed) {
        return CodeDetectionResult {
            is_code: false,
            language: None,
        };
    }

    // JSON 检测
    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && serde_json::from_str::<serde_json::Value>(trimmed).is_ok()
    {
        return CodeDetectionResult {
            is_code: true,
            language: Some("JSON".to_string()),
        };
    }

    // HTML 检测
    if trimmed.starts_with('<') {
        static HTML_PATTERN: Lazy<Regex> = Lazy::new(|| {
            Regex::new(r"^<\s*(html|head|body|div|script|style|link|meta|span|p|h[1-6])[\s>]")
                .unwrap()
        });
        if HTML_PATTERN.is_match(trimmed) {
            return CodeDetectionResult {
                is_code: true,
                language: Some("HTML".to_string()),
            };
        }
    }

    // CSS 检测
    if trimmed.starts_with('.') || trimmed.starts_with('#') || trimmed.starts_with('@') {
        static CSS_PATTERN: Lazy<Regex> =
            Lazy::new(|| Regex::new(r"^(\.[a-zA-Z].*\{|#[a-zA-Z].*\{|@media\s)").unwrap());
        if CSS_PATTERN.is_match(trimmed) {
            return CodeDetectionResult {
                is_code: true,
                language: Some("CSS".to_string()),
            };
        }
    }

    // SQL 检测
    if is_valid_sql(trimmed) {
        return CodeDetectionResult {
            is_code: true,
            language: Some("SQL".to_string()),
        };
    }

    // 快速语言检测
    if let Some(lang) = quick_language_detection(trimmed) {
        return CodeDetectionResult {
            is_code: true,
            language: Some(lang.to_string()),
        };
    }

    CodeDetectionResult {
        is_code: false,
        language: None,
    }
}

/// 验证是否为有效的 SQL
fn is_valid_sql(text: &str) -> bool {
    let lower = text.to_lowercase();

    // SQL 关键字
    let sql_keywords = [
        "select", "from", "where", "insert", "update", "delete", "create", "drop", "table",
        "index", "join", "inner", "left", "right", "group", "order", "by", "union", "distinct",
        "primary", "key", "foreign", "references", "not", "null", "default",
    ];

    let found: usize = sql_keywords
        .iter()
        .filter(|kw| lower.contains(&format!(" {} ", kw)))
        .count();

    if found < 3 {
        return false;
    }

    // SQL 结构
    Regex::new(
        r"(select\s+.+\s+from|insert\s+into\s+.+\s+values|update\s+.+\s+set|delete\s+from\s+.+\s+where|create\s+table\s+|drop\s+table\s+)",
    )
    .unwrap()
    .is_match(&lower)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rust_detection() {
        let code = r#"pub fn detect_code(content: &str, min_length: usize) -> CodeDetectionResult {
    let trimmed = content.trim();
}"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("Rust".to_string()));
    }

    #[test]
    fn test_rust_let_detection() {
        let code = r#"let mut items = vec![];
for item in items.iter() {
    println!("{}", item);
}"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("Rust".to_string()));
    }

    #[test]
    fn test_python_detection() {
        let code = r#"def hello():
    print("Hello, world!")
    return True"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("Python".to_string()));
    }

    #[test]
    fn test_json_detection() {
        let code = r#"{"name": "test", "value": 123}"#;
        let result = detect_code(code, 2);
        assert!(result.is_code);
        assert_eq!(result.language, Some("JSON".to_string()));
    }

    #[test]
    fn test_javascript_detection() {
        let code = r#"const items = [];
function addItem(item) {
    items.push(item);
}"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("JavaScript".to_string()));
    }

    #[test]
    fn test_typescript_detection() {
        let code = r#"interface User {
    name: string;
    age: number;
}

const user: User = { name: "test" };"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("TypeScript".to_string()));
    }

    #[test]
    fn test_go_detection() {
        let code = r#"package main
import "fmt"
func main() {
    fmt.Println("Hello")
}"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("Go".to_string()));
    }

    #[test]
    fn test_html_detection() {
        let code = r#"<div class="container">
    <p>Hello</p>
</div>"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("HTML".to_string()));
    }

    #[test]
    fn test_css_detection() {
        let code = r#".container {
    color: red;
}"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("CSS".to_string()));
    }

    #[test]
    fn test_cpp_detection() {
        let code = r#"#include <iostream>
using namespace std;
int main() {
    cout << "Hello" << endl;
    return 0;
}"#;
        let result = detect_code(code, 15);
        assert!(result.is_code);
        assert_eq!(result.language, Some("C++".to_string()));
    }

    #[test]
    fn test_java_detection() {
        let code = r#"public class Main {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}"#;
        let result = detect_code(code, 15);
        assert!(result.is_code);
        assert_eq!(result.language, Some("Java".to_string()));
    }

    #[test]
    fn test_csharp_detection() {
        let code = r#"using System;
namespace MyApp {
    public class Program {
        public static void Main() {
            Console.WriteLine("Hello");
        }
    }
}"#;
        let result = detect_code(code, 15);
        assert!(result.is_code);
        assert_eq!(result.language, Some("C#".to_string()));
    }

    #[test]
    fn test_sql_detection() {
        let code = r#"SELECT id, name FROM users WHERE status = 'active' ORDER BY created_at"#;
        let result = detect_code(code, 10);
        assert!(result.is_code);
        assert_eq!(result.language, Some("SQL".to_string()));
    }

    #[test]
    fn test_natural_language() {
        let text = "This is a normal sentence about programming.";
        let result = detect_code(text, 10);
        assert!(!result.is_code);
    }

    #[test]
    fn test_log_excluded() {
        let log = r#"[2025-01-15 10:30:45] [INFO] User logged in"#;
        let result = detect_code(log, 10);
        assert!(!result.is_code);
    }
}
