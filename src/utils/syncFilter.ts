import type { SyncModeConfig } from "@/types/sync.d";

export interface HistoryItem {
	id: string;
	type: "text" | "image" | "files" | "html" | "rtf";
	group: "text" | "image" | "files";
	value: string;
	search: string;
	count?: number;
	width?: number;
	height?: number;
	favorite: boolean;
	createTime: string;
	note?: string;
	subtype?: string;
	lastModified?: number;
	deviceId?: string;
	size?: number;
	checksum?: string;
}

/**
 * 根据同步模式配置过滤历史数据
 * @param items 原始历史数据
 * @param syncConfig 同步模式配置
 * @returns 过滤后的数据
 */
export const filterHistoryDataBySyncMode = (
	items: HistoryItem[],
	syncConfig: SyncModeConfig,
): HistoryItem[] => {
	return items.filter((item) => {
		// 1. 收藏模式过滤
		if (syncConfig.settings.onlyFavorites && !item.favorite) {
			return false;
		}

		// 2. 内容类型过滤
		switch (item.type) {
			case "text":
				return syncConfig.settings.includeText;
			case "html":
				return syncConfig.settings.includeHtml;
			case "rtf":
				return syncConfig.settings.includeRtf;
			case "image":
				if (!syncConfig.settings.includeImages) return false;
				// 文件大小过滤
				if (syncConfig.fileLimits) {
					const maxSize = syncConfig.fileLimits.maxImageSize * 1024 * 1024; // MB to bytes
					const fileSize = item.count || 0;
					return fileSize <= maxSize;
				}
				return true;
			case "files":
				if (!syncConfig.settings.includeFiles) return false;
				// 文件大小过滤
				if (syncConfig.fileLimits) {
					const maxSize = syncConfig.fileLimits.maxFileSize * 1024 * 1024; // MB to bytes
					const fileSize = item.count || 0;
					return fileSize <= maxSize;
				}
				return true;
			default:
				return false;
		}
	});
};

/**
 * 检查单个项目是否可以被同步
 * @param item 历史数据项
 * @param syncConfig 同步模式配置
 * @returns 是否可以同步
 */
export const isItemSyncable = (
	item: HistoryItem,
	syncConfig: SyncModeConfig,
): boolean => {
	return filterHistoryDataBySyncMode([item], syncConfig).length > 0;
};

/**
 * 获取项目的同步状态信息
 * @param item 历史数据项
 * @param syncConfig 同步模式配置
 * @returns 同步状态信息
 */
export const getSyncStatus = (
	item: HistoryItem,
	syncConfig: SyncModeConfig,
): {
	canSync: boolean;
	reason?: string;
	mode?: string;
} => {
	const canSync = isItemSyncable(item, syncConfig);

	if (!canSync) {
		let reason = "";

		if (syncConfig.settings.onlyFavorites && !item.favorite) {
			reason = "仅同步收藏内容";
		} else if (item.type === "image" && !syncConfig.settings.includeImages) {
			reason = "轻量模式不同步图片";
		} else if (item.type === "files" && !syncConfig.settings.includeFiles) {
			reason = "轻量模式不同步文件";
		} else if (syncConfig.fileLimits) {
			if (item.type === "image") {
				const maxSize = syncConfig.fileLimits.maxImageSize * 1024 * 1024;
				const fileSize = item.count || 0;
				if (fileSize > maxSize) {
					reason = `图片超过 ${syncConfig.fileLimits.maxImageSize}MB 限制`;
				}
			} else if (item.type === "files") {
				const maxSize = syncConfig.fileLimits.maxFileSize * 1024 * 1024;
				const fileSize = item.count || 0;
				if (fileSize > maxSize) {
					reason = `文件超过 ${syncConfig.fileLimits.maxFileSize}MB 限制`;
				}
			}
		}

		return {
			canSync: false,
			reason,
			mode: syncConfig.mode,
		};
	}

	return {
		canSync: true,
		mode: syncConfig.mode,
	};
};
