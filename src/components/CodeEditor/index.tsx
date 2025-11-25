import { globalStore } from "@/stores/global";
import type { HistoryTablePayload } from "@/types/database";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import { vsCodeDark } from "@fsegurai/codemirror-theme-vscode-dark";
import { vsCodeLight } from "@fsegurai/codemirror-theme-vscode-light";
import CodeMirror from "@uiw/react-codemirror";
import { type FC, memo } from "react";
import { useSnapshot } from "valtio";

/**
 * 获取CodeMirror语言扩展
 */
const getLanguageExtension = (language?: string) => {
	if (!language) return [];

	switch (language) {
		case "javascript":
		case "typescript":
			return [javascript({ jsx: true, typescript: language === "typescript" })];
		case "python":
			return [python()];
		case "java":
			return [java()];
		case "cpp":
		case "c":
		case "csharp":
			return [cpp()];
		case "rust":
			return [rust()];
		case "sql":
			return [sql()];
		case "css":
		case "scss":
		case "sass":
			return [css()];
		case "json":
			return [json()];
		case "xml":
			return [xml()];
		case "markdown":
			return [markdown()];
		case "html":
			return [html()];
		default:
			return [javascript()];
	}
};

interface CodeEditorProps extends Partial<HistoryTablePayload> {
	value: string;
	onChange?: (value: string) => void;
	editable?: boolean;
}

const CodeEditor: FC<CodeEditorProps> = ({
	value,
	codeLanguage,
	onChange,
	editable = false,
}) => {
	const { appearance } = useSnapshot(globalStore);
	const { isDark } = appearance;

	// 确定主题
	const theme = isDark ? vsCodeDark : vsCodeLight;

	// 获取语言扩展
	const extensions = getLanguageExtension(codeLanguage);

	// 基础配置 + 主题定制
	const allExtensions = [
		...extensions,
		EditorView.theme({
			"&": {
				backgroundColor: "var(--color-bg-1)",
			},
			".cm-content": {
				backgroundColor: "var(--color-bg-1)",
			},
			".cm-editor": {
				backgroundColor: "var(--color-bg-1)",
			},
			".cm-scroller": {
				backgroundColor: "var(--color-bg-1)",
			},
			".cm-editor, .cm-scroller, .cm-content": {
				borderRadius: "0.375rem",
			},
			".cm-gutters": {
				backgroundColor: "var(--color-bg-2)",
				borderRight: "1px solid var(--color-border-2)",
			},
			".cm-gutter": {
				backgroundColor: "var(--color-bg-2)",
			},
			".cm-gutterElement": {
				backgroundColor: "var(--color-bg-2)",
			},
			".cm-lineNumbers .cm-gutterElement": {
				backgroundColor: "var(--color-bg-2)",
			},
			".cm-activeLine": {
				backgroundColor: "var(--color-bg-2)",
			},
			".cm-activeLineGutter": {
				backgroundColor: "var(--color-bg-2)",
			},
			".cm-scroll-corner": {
				display: "none",
			},
			".cm-scroller::-webkit-scrollbar-corner": {
				display: "none",
			},
			".cm-scroller::-webkit-resizer": {
				display: "none",
			},
			".cm-content .cm-widget": {
				backgroundColor: "transparent",
			},
			".cm-panels": {
				backgroundColor: "var(--color-bg-1)",
			},
		}),
	];

	if (!editable) {
		// 只读模式下，使用展示样式
		return (
			<div
				className="overflow-hidden rounded border"
				style={{ borderColor: "#424242" }}
			>
				<CodeMirror
					value={value}
					height="400px"
					theme={theme}
					extensions={allExtensions}
					editable={false}
					basicSetup={{
						lineNumbers: true,
						highlightActiveLineGutter: true,
						highlightSpecialChars: true,
						history: true,
						foldGutter: true,
						drawSelection: true,
						dropCursor: false,
						allowMultipleSelections: false,
						indentOnInput: false,
						syntaxHighlighting: true,
						bracketMatching: true,
						closeBrackets: false,
						autocompletion: false,
						highlightActiveLine: true,
						highlightSelectionMatches: false,
					}}
				/>
			</div>
		);
	}

	// 可编辑模式
	return (
		<div
			className="overflow-hidden rounded border"
			style={{ borderColor: "#424242" }}
		>
			<CodeMirror
				value={value}
				height="400px"
				theme={theme}
				extensions={allExtensions}
				onChange={onChange}
				editable={editable}
				basicSetup={{
					lineNumbers: true,
					highlightActiveLineGutter: true,
					highlightSpecialChars: true,
					history: true,
					foldGutter: true,
					drawSelection: true,
					dropCursor: true,
					allowMultipleSelections: true,
					indentOnInput: true,
					syntaxHighlighting: true,
					bracketMatching: true,
					closeBrackets: true,
					autocompletion: true,
					highlightActiveLine: true,
					highlightSelectionMatches: true,
				}}
			/>
		</div>
	);
};

export default memo(CodeEditor);
