import type { HistoryItem, SyncItem, SyncModeConfig } from "@/types/sync";
import { calculateChecksum } from "./shared";

/**
 * 本地数据管理器
 *
 * 职责：
 * - 根据同步模式和设置筛选本地需要参与同步的数据
 * - 处理本地数据库操作（插入、删除、更新）
 * - 处理本地数据删除策略
 * - 生成本地数据指纹和校验和
 *
 * 文件操作依然调用专门的 fileSyncManager 完成
 */

export interface SyncFilterOptions {
	includeDeleted?: boolean;
}

// ================================
// 本地数据筛选策略
// ================================

/**
 * 根据同步模式配置筛选本地需要参与同步的数据
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

	const { includeDeleted = false } = options;
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
			// syncFavoriteChanges 只影响收藏状态变化的同步行为，不影响收藏模式的筛选逻辑
			if (!item.favorite) {
				return false;
			}
		}

		// 3. 内容类型过滤
		let typeAllowed = true;
		switch (item.type) {
			case "text":
				typeAllowed = settings.includeText;
				break;
			case "html":
				typeAllowed = settings.includeHtml;
				break;
			case "rtf":
				typeAllowed = settings.includeRtf;
				break;
			case "image":
				typeAllowed = settings.includeImages;
				break;
			case "files":
				typeAllowed = settings.includeFiles;
				break;
			default:
				typeAllowed = true;
		}

		if (!typeAllowed) {
			return false;
		}

		// 4. 文件大小过滤（仅对图片和文件生效）
		if (
			syncConfig.fileLimits &&
			(item.type === "image" || item.type === "files")
		) {
			const { maxImageSize, maxFileSize } = syncConfig.fileLimits;
			const fileSize = item.count || 0; // count 字段存储文件大小

			if (item.type === "image" && fileSize > maxImageSize * 1024 * 1024) {
				return false;
			}
			if (item.type === "files" && fileSize > maxFileSize * 1024 * 1024) {
				return false;
			}
		}

		return true;
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
 * 判断项目是否应该同步
 * @param item 历史数据项
 * @param syncConfig 同步模式配置
 * @returns 是否应该同步
 */
export const shouldSyncItem = (
	item: HistoryItem,
	syncConfig: SyncModeConfig | null,
): boolean => {
	if (!syncConfig?.settings) return true;

	const settings = syncConfig.settings;

	// 收藏模式检查
	if (settings.onlyFavorites) {
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

// ================================
// 本地数据删除策略
// ================================

/**
 * 根据本地删除状态筛选数据
 * 以本地删除状态为准，标记需要从云端删除的项目
 * @param items 原始数据
 * @param deleteHandler 删除处理器回调函数
 * @returns 过滤后的数据和需要删除的项目ID
 */
export const filterItemsByDeletionStrategy = <T extends HistoryItem>(
	items: T[],
	deleteHandler?: (itemIds: string[]) => Promise<void>,
): {
	filteredItems: T[];
	itemsToDelete: string[];
} => {
	const itemsToDelete: string[] = [];
	const filteredItems: T[] = [];

	for (const item of items) {
		const isDeleted = item.deleted === true || (item.deleted as any) === 1;

		if (isDeleted) {
			// 本地标记删除：记录需要从云端删除的项目
			itemsToDelete.push(item.id);
		} else {
			// 本地未删除：保留该项目
			filteredItems.push(item);
		}
	}

	// 异步处理删除（如果提供了删除处理器）
	if (itemsToDelete.length > 0 && deleteHandler) {
		// 异步执行，不阻塞主流程
		deleteHandler(itemsToDelete).catch(() => {
			// 删除处理器执行失败
		});
	}

	return {
		filteredItems,
		itemsToDelete,
	};
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

// ================================
// 本地数据处理工具
// ================================

/**
 * 提取文件项的核心内容用于校验和计算
 * @param item 文件项
 * @returns 核心内容字符串
 */
export const extractFileCoreValue = (item: any): string => {
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
export const calculateContentChecksum = (item: any): string => {
	const coreFields: any = {
		id: item.id,
		type: item.type,
	};

	if (item.type === "image" || item.type === "files") {
		const coreValue = extractFileCoreValue(item);
		coreFields.value = coreValue;
	} else {
		coreFields.value = item.value;
	}

	const sortedKeys = Object.keys(coreFields).sort();
	const orderedObject: any = {};

	for (const key of sortedKeys) {
		orderedObject[key] = coreFields[key];
	}

	const checksumSource = JSON.stringify(orderedObject);
	return calculateChecksum(checksumSource);
};

/**
 * 计算项目校验和
 * @param item 数据项
 * @returns 校验和字符串
 */
export const calculateItemChecksum = (item: any): string => {
	return calculateContentChecksum(item);
};

/**
 * 生成轻量级本地数据用于云端比较
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

// ================================
// 本地数据管理器
// ================================

/**
 * 本地数据管理器类
 *
 * 职责：
 * - 根据同步模式配置筛选本地需要参与同步的数据
 * - 生成本地数据同步项和校验和
 * - 执行本地数据库的增删改操作
 * - 接收并处理同步冲突解决器的结果
 */
export class LocalDataManager {
	/**
	 * 根据同步模式配置筛选本地数据
	 * @param localItems 原始本地数据
	 * @param syncConfig 同步模式配置
	 * @param options 过滤选项
	 * @returns 筛选后的同步项数据
	 */
	filterLocalDataForSync(
		localItems: HistoryItem[],
		syncConfig: SyncModeConfig | null,
		options: SyncFilterOptions = {},
	): SyncItem[] {
		// 1. 根据同步模式过滤数据
		const filteredItems = filterItemsBySyncMode(
			localItems,
			syncConfig,
			options,
		);

		// 2. 转换为 SyncItem 格式
		return filteredItems.map((item) => this.convertToSyncItem(item));
	}

	/**
	 * 获取需要删除的本地项目ID列表
	 * @param localItems 原始本地数据
	 * @returns 需要删除的项目ID列表
	 */
	getLocalItemsToDelete(localItems: HistoryItem[]): string[] {
		return detectLocalDeletions(localItems);
	}

	/**
	 * 将 HistoryItem 转换为 SyncItem
	 * @param item 历史数据项
	 * @returns 同步项
	 */
	private convertToSyncItem(item: HistoryItem): SyncItem {
		const coreValue = this.extractCoreValue(item);
		const contentChecksum = calculateChecksum(coreValue);

		return {
			id: item.id,
			type: item.type,
			value: item.value || "",
			search: item.search || "",
			createTime: item.createTime,
			lastModified: item.lastModified || Date.now(),
			favorite: item.favorite,
			note: item.note || "",
			checksum: contentChecksum,
			size: JSON.stringify(item).length,
			deviceId: item.deviceId || "",
			group: item.group,
			count: item.count || 0,
			width: item.width || 0,
			height: item.height || 0,
			subtype: item.subtype,
		};
	}

	/**
	 * 提取核心内容用于校验和计算
	 * @param item 数据项
	 * @returns 核心内容字符串
	 */
	private extractCoreValue(item: HistoryItem): string {
		// 对于文件项，提取原始路径信息
		if (item.type === "image" || item.type === "files") {
			return extractFileCoreValue(item);
		}

		// 确保value不为null或undefined
		if (!item.value) {
			return "";
		}

		return typeof item.value === "string"
			? item.value
			: JSON.stringify(item.value);
	}

	/**
	 * 应用同步结果到本地数据
	 * @param originalData 原始本地数据
	 * @param syncResult 同步处理结果
	 * @returns 处理后的本地数据
	 */
	applySyncResultToLocal(
		originalData: HistoryItem[],
		syncResult: {
			itemsToAdd: SyncItem[];
			itemsToUpdate: SyncItem[];
			itemsToDelete: string[];
		},
	): HistoryItem[] {
		let processedData = [...originalData];

		// 1. 移除需要删除的项目
		processedData = processedData.filter(
			(item) => !syncResult.itemsToDelete.includes(item.id),
		);

		// 2. 更新现有项目
		for (const updateItem of syncResult.itemsToUpdate) {
			const index = processedData.findIndex(
				(item) => item.id === updateItem.id,
			);
			if (index !== -1) {
				// 只更新特定字段，避免覆盖不必要的字段
				processedData[index] = {
					...processedData[index],
					// 明确列出需要更新的字段
					value: updateItem.value || processedData[index].value,
					favorite:
						updateItem.favorite !== undefined
							? updateItem.favorite
							: processedData[index].favorite,
					note:
						updateItem.note !== undefined
							? updateItem.note
							: processedData[index].note,
					lastModified:
						updateItem.lastModified || processedData[index].lastModified,
					checksum: updateItem.checksum || processedData[index].checksum,
					// 不包含 deviceId, _syncType 等临时字段
				};
			}
		}

		// 3. 添加新项目
		for (const addItem of syncResult.itemsToAdd) {
			const exists = processedData.find((item) => item.id === addItem.id);
			if (!exists) {
				processedData.push(this.convertSyncItemToHistoryItem(addItem));
			}
		}

		return processedData;
	}

	/**
	 * 将 SyncItem 转换回 HistoryItem 格式
	 * @param item 同步项
	 * @returns 历史数据项
	 */
	private convertSyncItemToHistoryItem(item: SyncItem): HistoryItem {
		// 确定分组
		const group = this.determineGroup(item.type);

		return {
			// 只选择需要的字段，避免包含同步相关的内部字段
			id: item.id,
			type: item.type,
			value: item.value || "",
			search: item.search || "",
			createTime: item.createTime,
			favorite: item.favorite,
			note: item.note || "",
			group,
			count: item.count || 0,
			width: item.width || 0,
			height: item.height || 0,
			subtype: item.subtype,
			lastModified: item.lastModified || Date.now(),
			deviceId: item.deviceId || "",
			size: item.size || 0,
			checksum: item.checksum || "",
			deleted: item.deleted || false,
		};
	}

	/**
	 * 应用同步变更到本地数据库
	 * @param originalData 原始本地数据
	 * @param syncResult 同步结果
	 */
	async applySyncChanges(
		originalData: HistoryItem[],
		syncResult: {
			itemsToAdd: SyncItem[];
			itemsToUpdate: SyncItem[];
			itemsToDelete: string[];
		},
	): Promise<void> {
		try {
			// 1. 处理需要删除的项目
			if (syncResult.itemsToDelete.length > 0) {
				await this.deleteItemsFromDatabase(syncResult.itemsToDelete);
			}

			// 2. 处理需要添加和更新的项目（文件包已在同步引擎中预处理）
			const itemsToProcess = [
				...syncResult.itemsToAdd,
				...syncResult.itemsToUpdate,
			];

			if (itemsToProcess.length > 0) {
				// 直接处理同步结果，文件包已经在 fileSyncManager 中处理过
				const processedData = this.applySyncResultToLocal(
					originalData,
					syncResult,
				);

				// 批量更新数据库
				await this.batchUpdateDatabase(processedData, originalData);
			}
		} catch (error) {
			throw new Error(
				`应用同步变更失败: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * 从数据库删除项目
	 * @param itemIds 要删除的项目ID列表
	 */
	private async deleteItemsFromDatabase(itemIds: string[]): Promise<void> {
		const { updateSQL } = await import("@/database");

		const deletePromises = itemIds.map(async (itemId) => {
			try {
				await updateSQL("history", {
					id: itemId,
					deleted: 1,
				} as any);
			} catch (error) {
				console.error(`删除项目失败 (${itemId}):`, error);
			}
		});

		await Promise.allSettled(deletePromises);
	}

	/**
	 * 批量更新数据库
	 * @param processedData 处理后的数据
	 * @param originalData 原始数据
	 */
	private async batchUpdateDatabase(
		processedData: HistoryItem[],
		originalData: HistoryItem[],
	): Promise<void> {
		// 找出新增和更新的项目
		const newItems = processedData.filter(
			(item) => !originalData.some((original) => original.id === item.id),
		);

		const updatedItems = processedData.filter((item) =>
			originalData.some((original) => original.id === item.id),
		);

		// 批量处理
		const { updateSQL } = await import("@/database");

		// 处理新增项目
		if (newItems.length > 0) {
			const insertPromises = newItems.map(async (item) => {
				try {
					const insertItem = {
						id: item.id,
						type: item.type,
						group: item.group,
						value: item.value || "",
						search: item.search || "",
						count: item.count || 0,
						width: item.width,
						height: item.height,
						favorite: item.favorite ? 1 : 0,
						createTime: item.createTime,
						note: item.note || "",
						subtype: item.subtype as any, // 类型断言以兼容数据库约束
						deleted: item.deleted ? 1 : 0,
						syncStatus: "synced", // 从云端下载的数据标记为已同步
						isCloudData: 1, // 标记为云端数据
					} as any; // 类型断言以处理boolean到integer的转换

					const { insertWithDeduplicationForSync } = await import("@/database");
					await insertWithDeduplicationForSync("history", insertItem);
				} catch (error) {
					console.error(`插入项目失败 (${item.id}):`, error);
				}
			});

			await Promise.allSettled(insertPromises);
		}

		// 处理更新项目
		if (updatedItems.length > 0) {
			const updatePromises = updatedItems.map(async (item) => {
				try {
					const updateItem = {
						id: item.id,
						type: item.type,
						group: item.group,
						value: item.value || "",
						search: item.search || "",
						favorite: item.favorite ? 1 : 0,
						note: item.note?.trim() || "",
						subtype: item.subtype as any, // 类型断言以兼容数据库约束
						deleted: item.deleted ? 1 : 0,
						syncStatus: "synced", // 从云端更新的数据标记为已同步
						isCloudData: 1, // 标记为云端数据
					} as any; // 类型断言以处理boolean到integer的转换

					await updateSQL("history", updateItem);
				} catch (error) {
					console.error(`更新项目失败 (${item.id}):`, error);
				}
			});

			await Promise.allSettled(updatePromises);
		}
	}

	/**
	 * 根据类型确定分组
	 * @param type 类型
	 * @returns 分组
	 */
	private determineGroup(type: string): "text" | "image" | "files" {
		switch (type) {
			case "text":
			case "html":
			case "rtf":
				return "text";
			case "image":
				return "image";
			case "files":
				return "files";
			default:
				return "text";
		}
	}
}

// 导出单例实例
export const localDataManager = new LocalDataManager();
