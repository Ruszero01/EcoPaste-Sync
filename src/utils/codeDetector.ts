import hljs from "highlight.js";

export interface CodeDetectionResult {
	isCode: boolean;
	language: string;
	relevance?: number;
}

/**
 * 检测代码语言（基于main分支的检测逻辑）
 * @param code - 代码文本
 * @param minLength - 最小检测长度，默认为 10
 * @returns 检测到的语言名称，如果不是代码则返回 null
 */
export function detectCode(code: string, minLength = 10): CodeDetectionResult {
	if (!code || code.trim().length < minLength) {
		return { isCode: false, language: "", relevance: 0 };
	}

	const trimmedCode = code.trim();

	// 首先进行快速的语言特征检测，优先检测常见语言
	const quickDetection = quickLanguageDetection(trimmedCode);
	if (quickDetection) {
		return { isCode: true, language: quickDetection, relevance: 8 };
	}

	// 使用 Highlight.js 的自动检测，但限制语言范围以提高准确性
	const result = hljs.highlightAuto(trimmedCode, getCommonLanguages());

	// 使用更严格的判断条件
	if (result.relevance >= 7 && result.language !== "plaintext") {
		const normalizedLanguage = normalizeLanguageName(result.language || "");

		// 验证检测结果是否合理
		if (validateDetection(trimmedCode, normalizedLanguage)) {
			return {
				isCode: true,
				language: normalizedLanguage,
				relevance: result.relevance,
			};
		}
	}

	return { isCode: false, language: "", relevance: result.relevance };
}

/**
 * 快速语言检测 - 基于明显特征
 * @param code - 代码文本
 * @returns 检测到的语言或 null
 */
function quickLanguageDetection(code: string): string | null {
	const lowerCode = code.toLowerCase();

	// C++ 特征检测
	if (
		containsMultiple(code, [
			"int main",
			"cout",
			"cin",
			"<<",
			">>",
			"using namespace std",
			"#include",
		]) ||
		containsMultiple(code, [
			"const_cast",
			"dynamic_cast",
			"reinterpret_cast",
			"static_cast",
		]) ||
		(containsMultiple(code, ["#include", "using namespace", "std::"]) &&
			containsMultiple(code, ["int", "main"]))
	) {
		return "cpp";
	}

	// C 特征检测
	if (
		containsMultiple(code, ["#include", "printf", "scanf", "malloc", "free"]) &&
		!lowerCode.includes("cout")
	) {
		return "c";
	}

	// Java 特征检测
	if (
		containsMultiple(code, [
			"public class",
			"public static void main",
			"System.out.println",
			"import java.",
		])
	) {
		return "java";
	}

	// Python 特征检测
	if (
		containsMultiple(code, ["def ", "import ", "print(", ":"]) &&
		!lowerCode.includes("function")
	) {
		return "python";
	}

	// JavaScript 特征检测
	if (
		containsMultiple(code, [
			"function ",
			"const ",
			"let ",
			"var ",
			"console.log",
			"=>",
		]) &&
		!lowerCode.includes("class main")
	) {
		return "javascript";
	}

	// TypeScript 特征检测
	if (
		containsMultiple(code, [
			"interface ",
			"type ",
			"as ",
			": string",
			": number",
			": boolean",
		])
	) {
		return "typescript";
	}

	return null;
}

/**
 * 检查代码是否包含多个指定关键词
 * @param code - 代码文本
 * @param keywords - 关键词数组
 * @param minMatches - 最小匹配数量，默认为 2
 * @returns 是否匹配
 */
function containsMultiple(
	code: string,
	keywords: string[],
	minMatches = 2,
): boolean {
	const lowerCode = code.toLowerCase();
	const matches = keywords.filter((keyword) =>
		lowerCode.includes(keyword.toLowerCase()),
	);
	return matches.length >= minMatches;
}

/**
 * 获取常见语言列表，限制检测范围
 */
function getCommonLanguages(): string[] {
	return [
		"javascript",
		"typescript",
		"python",
		"java",
		"cpp",
		"c",
		"csharp",
		"rust",
		"go",
		"php",
		"ruby",
		"swift",
		"kotlin",
		"scala",
		"html",
		"css",
		"json",
		"xml",
		"yaml",
		"markdown",
		"sql",
		"bash",
		"shell",
		"powershell",
	];
}

/**
 * 验证检测结果是否合理
 * @param code - 原始代码
 * @param detectedLanguage - 检测到的语言
 * @returns 验证结果
 */
function validateDetection(code: string, detectedLanguage: string): boolean {
	const languageFeatures: Record<string, string[]> = {
		cpp: [
			"int main",
			"cout",
			"cin",
			"<<",
			">>",
			"::",
			"->",
			".*",
			"const_cast",
			"dynamic_cast",
		],
		c: ["#include", "printf", "scanf", "malloc", "free", "struct", "typedef"],
		java: [
			"public class",
			"public static void main",
			"System.out",
			"import java.",
		],
		python: ["def ", "import ", "print(", ":", "elif ", "__init__"],
		javascript: [
			"function ",
			"const ",
			"let ",
			"var ",
			"=>",
			"console.log",
			"=>",
		],
		typescript: [
			"interface ",
			"type ",
			"as ",
			": string",
			": number",
			"public ",
			"private ",
		],
		rust: ["fn main", "let mut", "println!", "use std::", "-> Result"],
		go: ["func main", "package main", 'import "', "fmt.Println", "go "],
	};

	const features = languageFeatures[detectedLanguage.toLowerCase()];
	if (!features) return true; // 没有特定特征的直接通过

	const lowerCode = code.toLowerCase();
	const featureMatches = features.filter((feature) =>
		lowerCode.includes(feature.toLowerCase()),
	);

	// 至少要有一个特征匹配
	return featureMatches.length > 0;
}

/**
 * 标准化语言名称，确保与 CodeMirror 扩展兼容
 * @param language - Highlight.js 检测到的语言名称
 * @returns 标准化后的语言名称
 */
function normalizeLanguageName(language: string): string {
	if (!language) return "";

	// Highlight.js 语言名称到 CodeMirror 支持的语言名称映射
	const languageMap: Record<string, string> = {
		javascript: "javascript",
		typescript: "typescript",
		python: "python",
		java: "java",
		cpp: "c++",
		c: "c",
		csharp: "csharp",
		rust: "rust",
		go: "go",
		scala: "scala",
		kotlin: "kotlin",
		swift: "swift",
		ruby: "ruby",
		php: "php",
		sql: "sql",
		html: "html",
		xml: "xml",
		css: "css",
		scss: "scss",
		sass: "sass",
		json: "json",
		yaml: "yaml",
		toml: "toml",
		markdown: "markdown",
		bash: "bash",
		shell: "shell",
		powershell: "powershell",
		dockerfile: "dockerfile",
		makefile: "makefile",
		cmake: "cmake",
		lua: "lua",
		perl: "perl",
		r: "r",
		matlab: "matlab",
		delphi: "delphi",
		dart: "dart",
		elixir: "elixir",
		erlang: "erlang",
		haskell: "haskell",
		julia: "julia",
		nim: "nim",
		objc: "objc",
		ocaml: "ocaml",
		pascal: "pascal",
		scheme: "scheme",
		solidity: "solidity",
		vbnet: "vbnet",
		verilog: "verilog",
		vhdl: "vhdl",
	};

	return languageMap[language.toLowerCase()] || language.toLowerCase();
}

/**
 * 检测文本是否包含代码
 * @param text - 文本内容
 * @returns 是否为代码
 */
export function isNaturalLanguage(text: string): boolean {
	if (!text || text.trim().length < 10) {
		return false;
	}

	const result = hljs.highlightAuto(text.trim());

	// 使用更高的相关性阈值来判断是否为代码
	return result.relevance < 6 || result.language === "plaintext";
}

/**
 * 获取语言的显示名称
 * @param language - 语言代码
 * @returns 语言的显示名称
 */
export function getLanguageDisplayName(language: string): string {
	if (!language) return "代码";

	const displayNames: Record<string, string> = {
		javascript: "JAVASCRIPT",
		typescript: "TYPESCRIPT",
		python: "PYTHON",
		java: "JAVA",
		cpp: "C++",
		c: "C",
		csharp: "C#",
		rust: "RUST",
		go: "GO",
		scala: "SCALA",
		kotlin: "KOTLIN",
		swift: "SWIFT",
		ruby: "RUBY",
		php: "PHP",
		sql: "SQL",
		html: "HTML",
		xml: "XML",
		css: "CSS",
		scss: "SCSS",
		sass: "SASS",
		json: "JSON",
		yaml: "YAML",
		toml: "TOML",
		markdown: "MARKDOWN",
		bash: "BASH",
		shell: "SHELL",
		powershell: "POWERSHELL",
		dockerfile: "DOCKERFILE",
		makefile: "MAKEFILE",
		cmake: "CMAKE",
		lua: "LUA",
		perl: "PERL",
		r: "R",
		matlab: "MATLAB",
		delphi: "DELPHI",
		dart: "DART",
		elixir: "ELIXIR",
		erlang: "ERLANG",
		haskell: "HASKELL",
		julia: "JULIA",
		nim: "NIM",
		objc: "OBJECTIVE-C",
		ocaml: "OCAML",
		pascal: "PASCAL",
		scheme: "SCHEME",
		solidity: "SOLIDITY",
		vbnet: "VB.NET",
		verilog: "VERILOG",
		vhdl: "VHDL",
	};

	return displayNames[language.toLowerCase()] || language.toUpperCase();
}
