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

	// 首先检查是否为自然语言或日志
	if (isNaturalLanguagePattern(trimmedCode)) {
		return { isCode: false, language: "", relevance: 0 };
	}

	// 首先进行快速的语言特征检测，优先检测常见语言
	const quickDetection = quickLanguageDetection(trimmedCode);
	if (quickDetection) {
		return { isCode: true, language: quickDetection, relevance: 8 };
	}

	// 使用 Highlight.js 的自动检测，但限制语言范围以提高准确性
	const result = hljs.highlightAuto(trimmedCode, getCommonLanguages());

	// 对于 YAML 和 SQL，需要更高的相关性阈值
	const relevanceThreshold = ["yaml", "sql"].includes(
		result.language?.toLowerCase() || "",
	)
		? 8
		: 7;

	// 使用更严格的判断条件
	if (
		result.relevance >= relevanceThreshold &&
		result.language !== "plaintext"
	) {
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
 * 验证文本是否为有效的 YAML
 * @param code - 代码文本
 * @returns 是否为有效的 YAML
 */
function isValidYaml(code: string): boolean {
	const trimmedCode = code.trim();
	const lines = trimmedCode.split("\n");

	// 必须包含 YAML 的关键特征
	let hasYamlFeatures = false;
	let hasColonValuePairs = 0;
	let hasDashLists = 0;
	let hasKeyColonSpacing = 0;

	// 排除明显的日志或普通文本的特征
	const logIndicators = [
		/\[\d{4}-\d{2}-\d{2}/, // 日期日志格式
		/\[\d{2}:\d{2}:\d{2}/, // 时间日志格式
		/\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/i, // 日志级别
		/^\s*\[\w+\]:?\s*$/m, // 日志标签格式
	];

	// 检查是否为日志格式
	for (const pattern of logIndicators) {
		if (pattern.test(trimmedCode)) {
			return false;
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		// 检查键值对格式 (key: value 或 key: )
		if (
			/^[a-zA-Z_][a-zA-Z0-9_-]*:\s*.+$/.test(line) ||
			/^[a-zA-Z_][a-zA-Z0-9_-]*:\s*$/.test(line)
		) {
			hasColonValuePairs++;
			hasYamlFeatures = true;

			// 检查是否有正确的冒号后空格（YAML 最佳实践）
			if (/^[a-zA-Z_][a-zA-Z0-9_-]*:\s+/.test(line)) {
				hasKeyColonSpacing++;
			}
		}

		// 检查列表格式 (- item)
		if (/^-\s+.+$/.test(line)) {
			hasDashLists++;
			hasYamlFeatures = true;
		}

		// 检查嵌套结构（缩进）
		if (i > 0 && /^\s{2,}/.test(lines[i]) && !/^\s*-/.test(lines[i])) {
			hasYamlFeatures = true;
		}
	}

	// 必须有 YAML 特征，且有一定数量的键值对或列表项
	if (!hasYamlFeatures) return false;

	// 至少需要2个键值对或1个列表项+1个键值对
	const hasEnoughStructure =
		hasColonValuePairs >= 2 || (hasColonValuePairs >= 1 && hasDashLists >= 1);

	// 如果有键值对，大部分应该有正确的空格格式
	const hasGoodFormatting =
		hasColonValuePairs === 0 || hasKeyColonSpacing / hasColonValuePairs >= 0.6;

	return hasEnoughStructure && hasGoodFormatting;
}

/**
 * 验证文本是否为有效的 SQL
 * @param code - 代码文本
 * @returns 是否为有效的 SQL
 */
function isValidSql(code: string): boolean {
	const trimmedCode = code.trim();
	const lowerCode = trimmedCode.toLowerCase();

	// 排除 Markdown 语法
	const markdownPatterns = [
		/^#{1,6}\s+/m, // 标题
		/\*\*.*?\*\*/, // 粗体
		/\*.*?\*/, // 斜体
		/\[.*?\]\(.*?\)/, // 链接
		/```[\s\S]*?```/, // 代码块
		/`[^`]+`/, // 行内代码
		/^\s*[-*+]\s+/m, // 列表
		/^\s*\d+\.\s+/m, // 有序列表
		/^\s*>\s+/m, // 引用
	];

	for (const pattern of markdownPatterns) {
		if (pattern.test(trimmedCode)) {
			return false;
		}
	}

	// 排除明显的纯文本内容
	const textPatterns = [
		/^[a-z\s,.;!?]+$/im, // 纯英文句子
		/[\u4e00-\u9fff]+/, // 包含中文
		/^(the|and|or|but|in|on|at|to|for|of|with|by)\s+/im, // 常见英文单词开头
	];

	// 如果文本包含太多自然语言特征，可能不是 SQL
	let textMatchCount = 0;
	for (const pattern of textPatterns) {
		if (pattern.test(trimmedCode)) {
			textMatchCount++;
		}
	}
	if (textMatchCount >= 2) {
		return false;
	}

	// SQL 关键字检测
	const sqlKeywords = [
		"select",
		"from",
		"where",
		"insert",
		"update",
		"delete",
		"create",
		"drop",
		"alter",
		"table",
		"index",
		"view",
		"database",
		"schema",
		"join",
		"inner",
		"left",
		"right",
		"group",
		"order",
		"by",
		"having",
		"union",
		"all",
		"distinct",
		"count",
		"sum",
		"avg",
		"max",
		"min",
		"primary",
		"key",
		"foreign",
		"references",
		"not",
		"null",
		"default",
	];

	const foundKeywords = sqlKeywords.filter((keyword) =>
		new RegExp(`\\b${keyword}\\b`, "i").test(lowerCode),
	);

	// 必须包含至少3个 SQL 关键字
	if (foundKeywords.length < 3) {
		return false;
	}

	// 检查 SQL 语法结构
	const sqlPatterns = [
		/select\s+.+\s+from\s+/i, // SELECT ... FROM ...
		/insert\s+into\s+.+\s+values/i, // INSERT INTO ... VALUES
		/update\s+.+\s+set\s+/i, // UPDATE ... SET
		/delete\s+from\s+.+\s+where/i, // DELETE FROM ... WHERE
		/create\s+table\s+/i, // CREATE TABLE
		/drop\s+table\s+/i, // DROP TABLE
		/alter\s+table\s+/i, // ALTER TABLE
	];

	const hasSqlStructure = sqlPatterns.some((pattern) =>
		pattern.test(lowerCode),
	);

	// 检查是否包含 SQL 特有的符号
	const hasSqlSymbols =
		/[(),=<>!]+/.test(trimmedCode) && !/[{}[\]]/.test(trimmedCode); // 排除编程语言的大括号

	return hasSqlStructure && hasSqlSymbols;
}

/**
 * 强化的日志格式检测 - 专门用于快速排除日志内容
 * @param code - 代码文本
 * @returns 是否为日志格式
 */
function isLogFormat(code: string): boolean {
	const trimmedCode = code.trim();

	// 1. 时间戳模式检测
	const timestampPatterns = [
		/\[\d{4}-\d{2}-\d{2}[\s\T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?[\sZ]?\]/, // [2025-11-28 03:11:40.123] 或 [2025-11-28T03:11:40.123Z]
		/\[\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/, // [2025/11/28 03:11:40.123]
		/\[\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/, // [11/28/2025 03:11:40.123]
		/\[\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/, // [03:11:40.123] 或 [03:11:40]
		/\[\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\]/, // [Nov 28 03:11:40]
	];

	// 2. 日志级别模式检测
	const logLevelPatterns = [
		/\[(?:DEBUG|INFO|WARN|ERROR|FATAL|CRITICAL|TRACE|NOTICE)\]/i,
		/\[(?:SQL|DB|DATABASE|APP|SYSTEM|SERVER|CLIENT)\]/i,
	];

	// 3. 程序模块/组件模式检测
	const modulePatterns = [
		/\[[\w.-]+::[\w.-]+\]/, // [sqlx::query], [app::service], [module::component]
		/\[[\w.-]+\.(?:query|execute|connect|request|response)\]/, // [db.query], [api.request]
		/\[(?:thread|task|process|worker)-\d+\]/, // [thread-1234], [task-5678]
	];

	// 4. 数据库操作模式检测
	const databasePatterns = [
		/\b(?:INSERT|UPDATE|DELETE|SELECT|CREATE|DROP|ALTER)\s+(?:OR\s+REPLACE|IGNORE|IF\s+NOT\s+EXISTS)?\s+\w+/i,
		/\b(?:rows_affected|rows_returned|elapsed|elapsed_secs)\s*=/i,
		/\bdb\.statement\s*=/i,
	];

	// 5. 结构化日志模式检测
	const structuredLogPatterns = [
		/\[\d{4}-\d{2}-\d{2}.*?\].*?\[.*?\].*?\[.*?\]/, // [时间][模块][级别] 格式
		/\w+=\w+.*?\w+=\d+/, // key=value key=number 格式
		/elapsed(?:_secs)?=\d+(?:\.\d+)?(?:µs|ms|s)/, // 性能指标格式
	];

	// 检查时间戳模式（最基本的日志特征）
	const hasTimestamp = timestampPatterns.some((pattern) =>
		pattern.test(trimmedCode),
	);
	if (hasTimestamp) {
		return true;
	}

	// 检查是否有多个日志特征组合
	let logFeatureCount = 0;

	if (logLevelPatterns.some((pattern) => pattern.test(trimmedCode))) {
		logFeatureCount++;
	}

	if (modulePatterns.some((pattern) => pattern.test(trimmedCode))) {
		logFeatureCount++;
	}

	if (databasePatterns.some((pattern) => pattern.test(trimmedCode))) {
		logFeatureCount++;
	}

	if (structuredLogPatterns.some((pattern) => pattern.test(trimmedCode))) {
		logFeatureCount++;
	}

	// 如果有2个或以上的日志特征，认为是日志
	if (logFeatureCount >= 2) {
		return true;
	}

	// 检查SQL相关的日志（特殊处理）
	const sqlLogIndicators = [
		/\[sql(?:lite|x)?::(?:query|execute|prepare)\]/i,
		/\bdb\.(?:statement|query|execution)\s*=/i,
		/\b(?:INSERT|UPDATE|DELETE|SELECT).*?VALUES\s*\(/i,
	];

	if (sqlLogIndicators.some((pattern) => pattern.test(trimmedCode))) {
		return true;
	}

	return false;
}

/**
 * 快速语言检测 - 基于明显特征
 * @param code - 代码文本
 * @returns 检测到的语言或 null
 */
function quickLanguageDetection(code: string): string | null {
	const lowerCode = code.toLowerCase();

	// 强化的日志模式检测 - 优先处理
	if (isLogFormat(code)) {
		return null; // 明确是日志，返回 null
	}

	// YAML 特征检测 - 需要更严格的验证
	if (isValidYaml(code)) {
		return "yaml";
	}

	// SQL 特征检测 - 需要更严格的验证
	if (isValidSql(code)) {
		return "sql";
	}

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
	const lowerLanguage = detectedLanguage.toLowerCase();

	// 对于 YAML 和 SQL，使用专门的验证函数
	if (lowerLanguage === "yaml") {
		return isValidYaml(code);
	}
	if (lowerLanguage === "sql") {
		return isValidSql(code);
	}

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

	const features = languageFeatures[lowerLanguage];
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
 * 检测文本是否为自然语言（非代码）
 * @param text - 文本内容
 * @returns 是否为自然语言
 */
function isNaturalLanguagePattern(text: string): boolean {
	if (!text || text.trim().length < 10) {
		return false;
	}

	const trimmedText = text.trim();

	// 首先检查是否有明显的代码特征，如果有就直接返回 false
	const codePatterns = [
		/\b(int|char|float|double|bool|void|string|const|static|public|private|protected|class|struct|enum|if|else|for|while|do|switch|case|break|continue|return|include|import|using|namespace|cout|cin|printf|scanf|malloc|free|function|var|let)\b/g, // 代码关键字
		/[{}();]/, // 代码括号和分号
		/\w+\s*[\+\-\*\/%\=]\s*\w+/, // 数学运算
		/\w+\s*==\s*\w+|\w+\s*!=\s*\w+|\w+\s*<=\s*\w+|\w+\s*>=\s*\w+/, // 比较运算
		/\w+\s*&&\s*\w+|\w+\s*\|\|\s*\w+/, // 逻辑运算
		/\b\d+\b/, // 数字字面量
		/->\w+|\.\w+/, // 指针访问或成员访问
	];

	for (const pattern of codePatterns) {
		if (pattern.test(trimmedText)) {
			return false; // 发现代码特征，不是自然语言
		}
	}

	const lowerText = trimmedText.toLowerCase();

	// 检查日志模式
	const logPatterns = [
		/\[\d{4}-\d{2}-\d{2}[\s\T]\d{2}:\d{2}:\d{2}/, // ISO 时间戳
		/\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}/, // 标准日期时间
		/\b\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/, // syslog 格式
		/^\s*\[\d+:\d+\s*[AP]M\]/i, // 简单时间格式
		/\b(ERROR|WARN|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/i, // 日志级别
		/\b(process|thread|task)\s+(started|completed|failed|error)\b/i, // 进程日志
		/\b(request|response)\s+(sent|received|processed)\b/i, // 网络日志
	];

	// 检查是否匹配日志模式
	for (const pattern of logPatterns) {
		if (pattern.test(trimmedText)) {
			return true;
		}
	}

	// 检查是否主要是纯英文句子（不包含代码结构）
	const naturalLanguagePatterns = [
		/^[a-z][^.]*[.!?]?\s*$/gm, // 单个简单句子
		/^[a-z\s,;:!?]+$/gm, // 只有字母和标点
	];

	let naturalLanguageMatches = 0;
	let totalSentences = 0;

	// 统计句子数量和自然语言匹配数量
	const sentences = trimmedText
		.split(/[.!?]+/)
		.filter((s) => s.trim().length > 0);
	totalSentences = sentences.length;

	for (const sentence of sentences) {
		const trimmedSentence = sentence.trim();
		if (trimmedSentence.length === 0) continue;

		// 检查句子是否为纯英文自然语言
		for (const pattern of naturalLanguagePatterns) {
			if (pattern.test(trimmedSentence.toLowerCase())) {
				naturalLanguageMatches++;
				break;
			}
		}
	}

	// 如果大部分句子都是自然语言格式，可能是自然语言文本
	if (totalSentences >= 2 && naturalLanguageMatches / totalSentences >= 0.7) {
		return true;
	}

	// 检查常见英文自然语言词汇的出现频率
	const commonWords = [
		"the",
		"and",
		"or",
		"but",
		"in",
		"on",
		"at",
		"to",
		"for",
		"of",
		"with",
		"by",
		"from",
		"up",
		"about",
		"into",
		"through",
		"during",
		"before",
		"after",
		"above",
		"below",
		"between",
	];
	const words = lowerText.split(/\s+/).filter((word) => word.length > 2);
	const commonWordCount = words.filter((word) =>
		commonWords.includes(word),
	).length;

	// 如果常见自然语言词汇占比较高且没有代码特征，可能是自然语言
	if (words.length > 5 && commonWordCount / words.length > 0.3) {
		return true;
	}

	return false;
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

	// 首先检查自然语言模式
	if (isNaturalLanguagePattern(text)) {
		return true;
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
		javascript: "JavaScript",
		typescript: "TypeScript",
		python: "Python",
		java: "Java",
		cpp: "C++",
		c: "C",
		csharp: "C#",
		rust: "Rust",
		go: "Go",
		scala: "Scala",
		kotlin: "Kotlin",
		swift: "Swift",
		ruby: "Ruby",
		php: "Php",
		sql: "Sql",
		html: "Html",
		xml: "Xml",
		css: "Css",
		scss: "Scss",
		sass: "Sass",
		json: "Json",
		yaml: "Yaml",
		toml: "Toml",
		markdown: "Markdown",
		bash: "Bash",
		shell: "Shell",
		powershell: "PowerShell",
		dockerfile: "Dockerfile",
		makefile: "Makefile",
		cmake: "Cmake",
		lua: "Lua",
		perl: "Perl",
		r: "R",
		matlab: "Matlab",
		delphi: "Delphi",
		dart: "Dart",
		elixir: "Elixir",
		erlang: "Erlang",
		haskell: "Haskell",
		julia: "Julia",
		nim: "Nim",
		objc: "Objective-C",
		ocaml: "Ocaml",
		pascal: "Pascal",
		scheme: "Scheme",
		solidity: "Solidity",
		vbnet: "VbNet",
		verilog: "Verilog",
		vhdl: "Vhdl",
	};

	return (
		displayNames[language.toLowerCase()] ||
		language.charAt(0).toUpperCase() + language.slice(1)
	);
}
