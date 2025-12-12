export type WindowLabel = (typeof WINDOW_LABEL)[keyof typeof WINDOW_LABEL];

export interface ReadImage {
	width: number;
	height: number;
	image: string;
}

export interface ClipboardPayload {
	type?: "text" | "rtf" | "html" | "markdown" | "image" | "files" | "color";
	group: "text" | "image" | "files";
	subtype?: "url" | "email" | "color" | "path" | "image";
	count: number;
	value: string;
	search: string;
	width?: number;
	height?: number;
	// 代码检测相关字段
	isCode?: boolean;
	codeLanguage?: string;
	// 来源应用相关字段
	sourceAppName?: string;
	sourceAppIcon?: string;
}

export interface WindowsOCR {
	content: string;
	qr: Array<{
		bounds: Array<{ x: number; y: number }>;
		content: string;
	}>;
}
