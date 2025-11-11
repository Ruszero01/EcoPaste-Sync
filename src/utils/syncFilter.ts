import type { SyncModeConfig } from "@/types/sync";
import { calculateContentChecksum } from "./syncEngine";

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
	deleted?: boolean;
}

export interface SyncFilterOptions {
	includeDeleted?: boolean;
	syncFavoriteChanges?: boolean;
}

/**
 * 根据同步模式配置和历史记录过滤数据
 * @param items 原始历史数据
 * @param syncConfig 同步模式配置
 * @param options 过滤选项
 * @returns 过滤后的数据
 */
export const filterItemsBySyncMode = (
	items: HistoryItem[],
	syncConfig: SyncModeConfig | null,
	options: SyncFilterOptions = {},
): HistoryItem[] => {
	if (!syncConfig?.settings) {
		return items;
	}

	const { includeDeleted = false, syncFavoriteChanges = false } = options;
	const settings = syncConfig.settings;

	return items.filter((item) => {
		// 1. 删除状态过滤
		if (
			!includeDeleted &&
			(item.deleted === true || (item.deleted as any) === 1)
		) {
			return false;
		}

		// 2. 收藏模式过滤
		if (settings.onlyFavorites) {
			if (syncFavoriteChanges) {
				return true;
			}

			if (!item.favorite) {
				return false;
			}
		}

		// 3. 内容类型过滤
		switch (item.type) {
			case "text":
				return settings.includeText;
			case "html":
				return settings.includeHtml;
			case "rtf":
				return settings.includeRtf;
			case "image":
				return settings.includeImages;
			case "files":
				return settings.includeFiles;
			default:
				return true;
		}
	});
};

/**
 * 根据同步模式配置过滤历史数据（保持向后兼容）
 * @param items 原始历史数据
 * @param syncConfig 同步模式配置
 * @returns 过滤后的数据
 */
export const filterHistoryDataBySyncMode = (
	items: HistoryItem[],
	syncConfig: SyncModeConfig,
): HistoryItem[] => {
	return filterItemsBySyncMode(items, syncConfig);
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
 * 判断项目是否应该同步（包含收藏状态变化的特殊处理）
 * @param item 历史数据项
 * @param syncConfig 同步模式配置
 * @param allowFavoriteChanges 是否允许收藏状态变化
 * @returns 是否应该同步
 */
export const shouldSyncItem = (
	item: HistoryItem,
	syncConfig: SyncModeConfig | null,
	allowFavoriteChanges = false,
): boolean => {
	if (!syncConfig?.settings) return true;

	const settings = syncConfig.settings;

	// 收藏模式检查
	if (settings.onlyFavorites) {
		if (allowFavoriteChanges) {
			return true;
		}
		if (!item.favorite) {
			return false;
		}
	}

	// 类型检查
	switch (item.type) {
		case "text":
			return settings.includeText;
		case "html":
			return settings.includeHtml;
		case "rtf":
			return settings.includeRtf;
		case "image":
			return settings.includeImages;
		case "files":
			return settings.includeFiles;
		default:
			return true;
	}
};

/**
 * 去重处理历史数据
 * @param items 原始历史数据
 * @returns 去重后的数据
 */
export const deduplicateItems = (items: HistoryItem[]): HistoryItem[] => {
	const uniqueItems: HistoryItem[] = [];
	const seenIds = new Set<string>();
	const seenKeys = new Set<string>();

	for (const item of items) {
		if (item.id) {
			if (!seenIds.has(item.id)) {
				seenIds.add(item.id);
				uniqueItems.push(item);
			}
		} else {
			const key = `${item.type}:${item.value}`;
			if (!seenKeys.has(key)) {
				seenKeys.add(key);
				uniqueItems.push(item);
			}
		}
	}

	return uniqueItems;
};

/**
 * 检测本地删除的项目
 * @param currentLocalData 当前本地数据
 * @returns 删除的项目ID列表
 */
export const detectLocalDeletions = (
	currentLocalData: HistoryItem[],
): string[] => {
	return currentLocalData
		.filter((item) => item.deleted === true || (item.deleted as any) === 1)
		.map((item) => item.id);
};

/**
 * 提取文件项的核心内容用于校验和计算
 * @param item 文件项
 * @returns 核心内容字符串
 */
export const extractFileCoreValue = (item: any): string => {
	// 如果是文件包格式，提取原始路径信息
	if (item._syncType === "package_files" && typeof item.value === "string") {
		try {
			const packageInfo = JSON.parse(item.value);
			if (
				packageInfo.originalPaths &&
				Array.isArray(packageInfo.originalPaths)
			) {
				// 对于文件包，使用原始路径数组作为核心内容
				if (item.type === "image" && packageInfo.originalPaths.length === 1) {
					return packageInfo.originalPaths[0]; // 图片单个路径
				}
				return JSON.stringify(packageInfo.originalPaths.sort()); // 文件数组路径
			}
		} catch {
			// 解析失败，继续使用原始逻辑
		}
	}

	// 如果是JSON格式的路径数组，直接使用
	if (
		typeof item.value === "string" &&
		item.value.startsWith("[") &&
		item.value.endsWith("]")
	) {
		try {
			const paths = JSON.parse(item.value);
			if (Array.isArray(paths)) {
				return JSON.stringify(paths.sort());
			}
		} catch {
			// 解析失败，继续使用原始逻辑
		}
	}

	// 默认情况：确保 value 不为 null 或 undefined
	if (!item.value) {
		return "";
	}

	return typeof item.value === "string"
		? item.value
		: JSON.stringify(item.value);
};

/**
 * 计算内容校验和
 * @param item 数据项
 * @returns 校验和字符串
 */
export const calculateItemChecksum = (item: any): string => {
	return calculateContentChecksum(item);
};

/**
 * 生成轻量级本地数据
 * @param localItems 本地原始数据
 * @param includeDeletedForDetection 是否包含已删除项用于检测
 * @returns 轻量级数据
 */
export const generateLightweightLocalData = (
	localItems: any[],
	includeDeletedForDetection = false,
): any[] => {
	const uniqueItems = deduplicateItems(localItems as any[]);
	let filteredItems = uniqueItems;

	if (!includeDeletedForDetection) {
		filteredItems = uniqueItems; // 不进行同步模式过滤，因为调用时需要syncConfig
	} else {
		filteredItems = uniqueItems; // 不进行同步模式过滤，因为调用时需要syncConfig
	}

	const lightweightData = filteredItems.map((item) => {
		const checksum = calculateItemChecksum(item);

		// 统一大小计算，确保与指纹生成逻辑一致
		let size: number;
		if (item.type === "image" || item.type === "files") {
			// 使用核心内容计算大小，确保与校验和计算一致
			const coreValue = extractFileCoreValue(item);
			size = coreValue.length;
		} else {
			size = JSON.stringify(item).length;
		}

		return {
			id: item.id,
			type: item.type,
			value: item.value || "", // 确保 value 不为 null 或 undefined
			createTime: item.createTime,
			lastModified: item.lastModified || Date.now(),
			favorite: item.favorite,
			deleted: item.deleted || false,
			checksum,
			size, // 添加size字段以保持一致性
			note: item.note || "", // 包含注释字段，确保同步过程中注释不会丢失
		};
	});

	return lightweightData;
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
