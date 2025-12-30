export type WindowLabel = (typeof WINDOW_LABEL)[keyof typeof WINDOW_LABEL];

export interface ReadImage {
	width: number;
	height: number;
	image: string;
}

export interface ClipboardPayload {
	type?:
		| "text"
		| "formatted"
		| "markdown"
		| "image"
		| "files"
		| "color"
		| "code";
	group: "text" | "image" | "files";
	subtype?: "url" | "email" | "color" | "path" | "html" | "rtf" | string; // string for code language
	count: number;
	value: string;
	search: string;
	width?: number;
	height?: number;
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
