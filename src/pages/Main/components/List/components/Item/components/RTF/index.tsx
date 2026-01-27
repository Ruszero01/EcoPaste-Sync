import type { HistoryTablePayload } from "@/types/database";
import { type FC, memo, useEffect, useState } from "react";
import HTML from "../HTML";

/**
 * 简单的 RTF 到 HTML 转换器
 * 处理常见的 RTF 标签：字体、颜色、粗体、斜体、下划线、段落等
 */
const rtfToHtml = (rtf: string): string => {
	if (!rtf) return "";

	let html = rtf;

	// 第一步：处理 Unicode 转义序列 \u22914?
	html = html.replace(/\\u(\d+)\?/g, (_, charCode) => {
		const code = Number.parseInt(charCode, 10);
		return code > 0 ? String.fromCharCode(code) : "";
	});

	// 第二步：处理十六进制转义 \'c8
	// Git Bash RTF 使用 GBK 编码的中文，需要成对转换
	html = html.replace(
		/\\'([0-9a-fA-F]{2})\\'([0-9a-fA-F]{2})/g,
		(_, hex1, hex2) => {
			// GBK 解码：将两个字节转换为中文
			const bytes = [Number.parseInt(hex1, 16), Number.parseInt(hex2, 16)];
			// 使用 TextDecoder 进行 GBK 解码
			try {
				const decoder = new TextDecoder("gbk");
				const view = new Uint8Array(bytes);
				return decoder.decode(view);
			} catch {
				// 如果 TextDecoder 不支持 gbk，回退到 latin1
				return String.fromCharCode(...bytes);
			}
		},
	);
	// 处理单个十六进制转义（非中文部分）
	html = html.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
		const code = Number.parseInt(hex, 16);
		return code > 0 ? String.fromCharCode(code) : "";
	});

	// 第三步：移除 RTF 头部
	html = html.replace(/\\rtf1[\\a-z0-9\s]*\{[^}]*\}/gi, "");
	html = html.replace(/\\fonttbl[\s\S]*?\{[^}]*\}/g, "");
	html = html.replace(/\\colortbl[^\}]*\}/g, "");

	// 移除控制字符 (排除 \t \n \r)
	const controlChars = String.fromCharCode(
		...Array.from({ length: 32 }, (_, i) => i),
	);
	html = html.replace(
		new RegExp(`[${controlChars.replace("\t\n\r", "")}]`, "g"),
		"",
	);

	// 处理粗体 \b 和 \b0
	html = html.replace(/\\b0?/g, (_, match) =>
		match === "\\b0" ? "</strong>" : "<strong>",
	);

	// 处理斜体 \i 和 \i0
	html = html.replace(/\\i0?/g, (_, match) =>
		match === "\\i0" ? "</em>" : "<em>",
	);

	// 处理下划线 \ul 和 \ulnone
	html = html.replace(/\\ulnone?/g, (_, match) =>
		match === "\\ulnone" ? "</u>" : "<u>",
	);

	// 处理删除线 \strike 和 \strike0
	html = html.replace(/\\strike0?/g, (_, match) =>
		match === "\\strike0" ? "</strike>" : "<strike>",
	);

	// 处理下标 \sub 和 \sub0
	html = html.replace(/\\sub0?/g, (_, match) =>
		match === "\\sub0" ? "</sub>" : "<sub>",
	);

	// 处理上标 \super 和 \super0
	html = html.replace(/\\super0?/g, (_, match) =>
		match === "\\super0" ? "</sup>" : "<sup>",
	);

	// 处理段落和换行
	html = html.replace(/\\par\s*/g, "\n");
	html = html.replace(/\\line/g, "\n");

	// 处理制表符
	html = html.replace(/\\tab/g, "    ");

	// 清理所有剩余的 RTF 命令（字母开头的，如 \fs20, \f0 等）
	html = html.replace(/\\[a-zA-Z]+\d*/g, "");

	// 清理大括号
	html = html.replace(/[\{\}]/g, "");

	// 清理连续的空白
	html = html.replace(/[ \t]+/g, " ");
	html = html.replace(/\n\s*\n/g, "\n");
	html = html.replace(/^\s+|\s+$/gm, "");

	return html.trim();
};

const RTF: FC<HistoryTablePayload> = (props) => {
	const { value } = props;

	const [parsedHTML, setParsedHTML] = useState("");

	useEffect(() => {
		if (!value) return;
		setParsedHTML(rtfToHtml(value));
	}, [value]);

	if (!parsedHTML) {
		return null;
	}

	return <HTML value={parsedHTML} />;
};

export default memo(RTF);
