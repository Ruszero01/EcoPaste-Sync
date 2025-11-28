import type { ClipboardPayload } from "./plugin";

export type TableName = "history";

export interface HistoryTablePayload extends ClipboardPayload {
	id: string;
	favorite: boolean;
	createTime: string;
	note?: string;
	// 按需下载相关字段
	lazyDownload?: boolean;
	fileSize?: number;
	fileType?: string;
	// 软删除字段
	deleted?: boolean;
	// 同步状态字段
	syncStatus?: "none" | "synced" | "syncing";
	isCloudData?: boolean;
	// 最后修改时间字段（用于同步）
	lastModified?: number;
	// 代码检测相关字段
	isCode?: boolean;
	codeLanguage?: string;
	// 来源应用相关字段
	sourceAppName?: string;
	sourceAppIcon?: string;
}

export type TablePayload = Partial<HistoryTablePayload>;
