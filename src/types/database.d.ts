import type { ClipboardPayload } from "./plugin";

export type TableName = "history";

export interface DeleteResult {
	success: boolean;
	deletedCount: number;
	softDeletedIds: string[];
	hardDeletedIds: string[];
	errors?: string[];
}

export interface HistoryTablePayload extends ClipboardPayload {
	id: string;
	favorite: boolean;
	time: number;
	note?: string;
	// 按需下载相关字段
	lazyDownload?: boolean;
	fileSize?: number;
	fileType?: string;
	// 软删除字段
	deleted?: boolean;
	// 同步状态字段
	syncStatus?: "not_synced" | "synced" | "changed";
	// 注意：isCode 和 codeLanguage 已移除，代码类型通过 type='code' 标识
	// 来源应用相关字段
	sourceAppName?: string;
	sourceAppIcon?: string;
	// 位置字段，用于手动排序模式下保持项目位置
	position?: number;
}

export type TablePayload = Partial<HistoryTablePayload>;
