//! Markdown 检测器
//!
//! 基于 Highlight.js 自动检测逻辑：使用代码检测的方式识别 Markdown
//! 参考 hljs.highlightAuto 对 markdown 的识别方式（将 markdown 作为代码语言检测）

/// 检查文本中是否包含多个指定关键词（至少 min_matches 个）
fn contains_multiple(text: &str, keywords: &[&str], min_matches: usize) -> bool {
    let lower = text.to_lowercase();
    let matches: usize = keywords
        .iter()
        .filter(|kw| lower.contains(&kw.to_lowercase()))
        .count();
    matches >= min_matches
}

/// 检测是否为 Markdown 格式
/// 使用类似代码检测的方式：检查 Markdown 特有语法特征
pub fn detect_markdown(content: &str) -> bool {
    let trimmed = content.trim();

    if trimmed.len() < 5 {
        return false;
    }

    // 排除明显是代码的格式
    if is_code_like(trimmed) {
        return false;
    }

    // Markdown 核心特征检测（使用 contains_multiple 方式，类似代码检测）

    // 1. 标题格式：多个标题行
    let header_count = contains_multiple(trimmed, &["\n# ", "\n## ", "\n### ", "\n#### ", "\n##### ", "\n###### "], 1)
        || contains_multiple(trimmed, &["# ", "## ", "### ", "#### ", "##### ", "###### "], 2);

    // 2. 代码块：``` 或 ~~~
    let has_code_block = contains_multiple(trimmed, &["\n```", "\n~~~", "```\n", "~~~\n"], 1);

    // 3. 链接格式：[text](url)
    let has_link = contains_multiple(trimmed, &["[", "](", ")"], 3);

    // 4. 引用：>
    let has_blockquote = contains_multiple(trimmed, &["\n> ", "\n>"], 2) || trimmed.starts_with("> ");

    // 5. 列表：- * + 或数字.
    let has_list = contains_multiple(trimmed, &["\n- ", "\n* ", "\n+ ", "\n1. ", "\n2. ", "\n3. "], 2);

    // 6. 水平分割线：--- 或 ***
    let has_hr = contains_multiple(trimmed, &["\n---\n", "\n***\n", "\n---\r", "\n***\r"], 1);

    // 7. 行内代码：`
    let has_inline_code = contains_multiple(trimmed, &["`", "`"], 2);

    // 8. 粗体/斜体：**text** *text* __text__ _text_
    let has_emphasis = contains_multiple(trimmed, &["**", "**"], 1)
        || contains_multiple(trimmed, &["__", "__"], 1)
        || contains_multiple(trimmed, &["*", "*"], 2)
        || contains_multiple(trimmed, &["_", "_"], 2);

    // 9. 图片：![alt](url)
    let has_image = contains_multiple(trimmed, &["![", "](", ")"], 3);

    // 10. 表格：| col |
    let has_table = contains_multiple(trimmed, &["|", "|"], 4);

    // 计算特征分数
    let mut score = 0;
    if header_count { score += 2; }
    if has_code_block { score += 2; }
    if has_link { score += 1; }
    if has_blockquote { score += 1; }
    if has_list { score += 1; }
    if has_hr { score += 1; }
    if has_inline_code { score += 1; }
    if has_emphasis { score += 1; }
    if has_image { score += 1; }
    if has_table { score += 1; }

    // 分数达到 2 分以上认为是 Markdown
    // 标题或代码块加任意一个其他特征就可以确认
    score >= 2
}

/// 检查是否像代码（排除 Markdown 检测）
fn is_code_like(text: &str) -> bool {
    let lower = text.to_lowercase();

    // 检查常见的代码关键字和结构
    let code_patterns = [
        // 函数定义
        "fn ",
        "function ",
        "def ",
        "pub fn ",
        // 类和对象
        "class ",
        "public class",
        "struct ",
        // 导入和包含
        "import ",
        "#include",
        "use std::",
        // 常见关键字
        "let mut",
        "const ",
        "var ",
        "public ",
        "private ",
        // 语言特有
        "console.log",
        "System.out.",
        "printf(",
        "println!",
        "-> ",
        "::",
        "=>",
    ];

    let matches: usize = code_patterns
        .iter()
        .filter(|kw| lower.contains(*kw))
        .count();

    // 匹配多个代码特征认为像代码
    matches >= 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_markdown_document() {
        let content = r#"# Title

## Subtitle

- item 1
- item 2

[link](http://example.com)

**bold text**
"#;
        assert!(detect_markdown(content));
    }

    #[test]
    fn test_not_markdown() {
        let content = "This is just a plain text without any markdown features.";
        assert!(!detect_markdown(content));
    }

    #[test]
    fn test_short_text() {
        assert!(!detect_markdown("#"));
        assert!(!detect_markdown("abc"));
    }
}
