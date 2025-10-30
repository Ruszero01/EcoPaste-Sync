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
}

export type TablePayload = Partial<HistoryTablePayload>;
