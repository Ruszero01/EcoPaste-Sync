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
