import hljs from "highlight.js";
import { useEffect, useState } from "react";
import "highlight.js/styles/vs2015.css";
import "./styles.css";
import clsx from "clsx";

// 最大行数限制，超过此行数将自动截断
const MAX_LINES = 5;

// 检查代码行数并截断过长的代码
const truncateLongCode = (code: string, maxLines: number = MAX_LINES): string => {
  const lines = code.split('\n');
  if (lines.length <= maxLines) {
    return code;
  }
  
  // 保留前 maxLines-1 行，最后一行显示省略号
  const truncatedLines = lines.slice(0, maxLines - 1);
  truncatedLines.push('... // [代码已截断，共 ' + lines.length + ' 行]');
  
  return truncatedLines.join('\n');
};

interface SyntaxHighlighterProps {
  value: string;
  language?: string;
  className?: string;
}

const SyntaxHighlighter = ({
  value,
  language,
  className,
}: SyntaxHighlighterProps) => {
  const [htmlContent, setHtmlContent] = useState<string>("");

  useEffect(() => {
    if (!value || !language) {
      setHtmlContent("");
      return;
    }

    try {
      // 检查代码行数，如果过长则截断
      const processedValue = truncateLongCode(value);
      
      // 使用 highlight.js 进行语法高亮
      const highlighted = hljs.highlight(processedValue, {
        language: language,
        ignoreIllegals: true,
      }).value;
      
      setHtmlContent(highlighted);
    } catch (error) {
      console.error("Syntax highlighting failed:", error);
      setHtmlContent("");
    }
  }, [value, language]);

  if (!htmlContent) {
    // 如果语法高亮失败，显示纯文本
    return (
      <div
        className={clsx(
          "whitespace-pre font-mono text-sm leading-relaxed",
          "bg-[#1f1f1f] text-[#cccccc]",
          "font-['Maple_Mono_NF_CN',_Consolas,'Courier_New',monospace]",
          className
        )}
      >
        {truncateLongCode(value)}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "whitespace-pre font-mono text-sm leading-relaxed",
        "bg-[#1f1f1f] text-[#cccccc]",
        "font-['Maple_Mono_NF_CN',_Consolas,'Courier_New',monospace]",
        className
      )}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};

export default SyntaxHighlighter;