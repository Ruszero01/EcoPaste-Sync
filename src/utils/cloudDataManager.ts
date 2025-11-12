import { deleteFile, downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import type { WebDAVConfig } from "@/plugins/webdav";
import type {
	CloudItemFingerprint,
	CloudSyncIndex,
	SyncItem,
	SyncModeConfig,
} from "@/types/sync";
import { calculateChecksum } from "@/utils/shared";
import { filterItemsBySyncMode } from "./localDataManager";

/**
 * 云端数据管理器
 *
 * 职责：
 * - 处理云端数据操作（新增、更新、删除）
 * - 云端索引和数据文件的上传、下载、缓存
 * - 云端数据差异检测
 * - 根据当前同步模式筛选需要同步的数据
 *
 * 本地数据筛选和删除策略由 localDataManager 处理
 */
export class CloudDataManager {
	private webdavConfig: WebDAVConfig | null = null;
	private cachedIndex: CloudSyncIndex | null = null;
	private indexCacheTime = 0;
	private readonly INDEX_CACHE_TTL = 30000; // 30秒缓存

	setWebDAVConfig(config: WebDAVConfig | null): void {
		this.webdavConfig = config;
		if (!config) {
			this.clearCache();
		}
	}

	/**
	 * 下载云端同步索引
	 */
	async downloadSyncIndex(): Promise<CloudSyncIndex | null> {
		if (!this.webdavConfig) return null;

		// 检查缓存
		const cached = this.getCachedIndex();
		if (cached) return cached;

		try {
			const filePath = this.getFullPath("sync-index.json");
			const result = await downloadSyncData(this.webdavConfig, filePath);

			if (result.success && result.data) {
				const index = JSON.parse(result.data) as CloudSyncIndex;

				if (this.isValidIndexFormat(index)) {
					this.cachedIndex = index;
					this.indexCacheTime = Date.now();
					return index;
				}
			}
		} catch {}

		return null;
	}

	/**
	 * 上传云端同步索引
	 */
	async uploadSyncIndex(index: CloudSyncIndex): Promise<boolean> {
		if (!this.webdavConfig) return false;

		try {
			const filePath = this.getFullPath("sync-index.json");
			const result = await uploadSyncData(
				this.webdavConfig,
				filePath,
				JSON.stringify(index, null, 2),
			);

			if (result.success) {
				this.cachedIndex = index;
				this.indexCacheTime = Date.now();
				return true;
			}
		} catch {}

		return false;
	}

	/**
	 * 下载云端同步数据
	 */
	async downloadSyncData(): Promise<any> {
		if (!this.webdavConfig) return null;

		try {
			const filePath = this.getFullPath("sync-data.json");
			const result = await downloadSyncData(this.webdavConfig, filePath);

			if (result.success && result.data) {
				return JSON.parse(result.data);
			}
		} catch {}

		return null;
	}

	/**
	 * 上传云端同步数据
	 */
	async uploadSyncData(data: any): Promise<boolean> {
		if (!this.webdavConfig) return false;

		try {
			const filePath = this.getFullPath("sync-data.json");
			const result = await uploadSyncData(
				this.webdavConfig,
				filePath,
				JSON.stringify(data, null, 2),
			);

			return result.success;
		} catch {}

		return false;
	}

	/**
	 * 使用本地数据更新云端索引
	 */
	updateIndexWithLocalChanges(
		index: CloudSyncIndex,
		localItems: any[],
		deletedIds: string[] = [],
	): CloudSyncIndex {
		const updatedIndex = { ...index };

		const activeItems = localItems.filter(
			(item) => !deletedIds.includes(item.id),
		);
		updatedIndex.items = activeItems.map((item) =>
			this.generateItemFingerprint(item),
		);

		updatedIndex.deletedItems = [
			...index.deletedItems.filter((id) => !deletedIds.includes(id)),
			...deletedIds,
		];

		updatedIndex.totalItems = updatedIndex.items.length;
		updatedIndex.dataChecksum = this.calculateIndexChecksum(updatedIndex);
		updatedIndex.statistics = this.calculateStatistics(updatedIndex);
		updatedIndex.timestamp = Date.now();

		return updatedIndex;
	}

	/**
	 * 创建空的云端索引
	 */
	createEmptyIndex(deviceId: string): CloudSyncIndex {
		return {
			format: "unified",
			timestamp: Date.now(),
			deviceId,
			lastSyncTime: Date.now(),
			conflictResolution: "merge",
			networkQuality: "medium",
			performanceMetrics: {
				avgUploadSpeed: 0,
				avgDownloadSpeed: 0,
				avgLatency: 0,
			},
			items: [],
			totalItems: 0,
			dataChecksum: "",
			deletedItems: [],
			statistics: {
				typeCounts: {},
				totalSize: 0,
				favoriteCount: 0,
				lastModified: 0,
			},
		};
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.cachedIndex = null;
		this.indexCacheTime = 0;
	}

	/**
	 * 生成单个项目指纹
	 */
	private generateItemFingerprint(item: any): CloudItemFingerprint {
		const contentChecksum = calculateChecksum(
			JSON.stringify({
				type: item.type,
				value: item.value,
				note: item.note || "",
			}),
		);

		const size = JSON.stringify(item).length;

		return {
			id: item.id,
			type: item.type,
			checksum: contentChecksum,
			favoriteChecksum: item.favorite
				? calculateChecksum(JSON.stringify({ favorite: !!item.favorite }))
				: undefined,
			size,
			timestamp: item.lastModified || Date.now(),
			favorite: !!item.favorite,
			deleted: item.deleted || false,
			note: item.note || "",
		};
	}

	/**
	 * 获取缓存的索引
	 */
	private getCachedIndex(): CloudSyncIndex | null {
		const now = Date.now();

		if (
			this.cachedIndex &&
			this.indexCacheTime &&
			now - this.indexCacheTime < this.INDEX_CACHE_TTL
		) {
			return this.cachedIndex;
		}

		return null;
	}

	/**
	 * 验证索引格式
	 */
	private isValidIndexFormat(index: any): index is CloudSyncIndex {
		return (
			index &&
			index.format === "unified" &&
			Array.isArray(index.items) &&
			typeof index.timestamp === "number" &&
			typeof index.deviceId === "string"
		);
	}

	/**
	 * 计算索引校验和
	 */
	private calculateIndexChecksum(index: CloudSyncIndex): string {
		const checksumData = {
			items: index.items.map((item) => ({
				id: item.id,
				checksum: item.checksum,
				timestamp: item.timestamp,
			})),
			deletedItems: index.deletedItems.sort(),
			timestamp: index.timestamp,
		};

		return calculateChecksum(JSON.stringify(checksumData));
	}

	/**
	 * 计算统计信息
	 */
	private calculateStatistics(
		index: CloudSyncIndex,
	): CloudSyncIndex["statistics"] {
		const typeCounts: Record<string, number> = {};
		let totalSize = 0;
		let favoriteCount = 0;
		let lastModified = 0;

		for (const item of index.items) {
			typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
			totalSize += item.size;
			if (item.favorite) favoriteCount++;
			if (item.timestamp > lastModified) lastModified = item.timestamp;
		}

		return {
			typeCounts,
			totalSize,
			favoriteCount,
			lastModified,
		};
	}

	/**
	 * 删除云端数据项目
	 * @param itemIds 要删除的项目ID列表
	 * @returns 删除结果
	 */
	async deleteCloudItems(itemIds: string[]): Promise<{
		success: number;
		failed: number;
		errors: string[];
	}> {
		if (itemIds.length === 0 || !this.webdavConfig) {
			return { success: 0, failed: 0, errors: [] };
		}

		const errors: string[] = [];
		let successCount = 0;
		let failedCount = 0;

		try {
			// 1. 删除文件包（异步并发处理）
			const packageDeletePromises = itemIds.map(async (itemId) => {
				try {
					const packagePath = this.getPackagePath(itemId);
					const result = await deleteFile(this.webdavConfig!, packagePath);
					return result;
				} catch {
					return false;
				}
			});

			await Promise.allSettled(packageDeletePromises);

			// 2. 更新云端索引，移除已删除的项目
			const currentIndex = await this.downloadSyncIndex();
			if (currentIndex) {
				const updatedItems = currentIndex.items.filter(
					(item) => !itemIds.includes(item.id),
				);

				const updatedIndex: CloudSyncIndex = {
					...currentIndex,
					items: updatedItems,
					deletedItems: [...currentIndex.deletedItems, ...itemIds],
					totalItems: updatedItems.length,
					timestamp: Date.now(),
					dataChecksum: "", // 重新计算校验和
				};

				const indexUpdateSuccess = await this.uploadSyncIndex(updatedIndex);

				if (indexUpdateSuccess) {
					successCount = itemIds.length;
				} else {
					failedCount = itemIds.length;
					errors.push("更新云端索引失败");
				}
			} else {
				failedCount = itemIds.length;
				errors.push("无法获取云端索引");
			}
		} catch (error) {
			failedCount = itemIds.length;
			errors.push(`删除操作异常: ${error}`);
		}

		return { success: successCount, failed: failedCount, errors };
	}

	/**
	 * 获取文件包路径
	 */
	private getPackagePath(itemId: string): string {
		const basePath = this.webdavConfig?.path || "";
		return basePath && basePath !== "/"
			? `${basePath.replace(/\/$/, "")}/packages/${itemId}.json`
			: `packages/${itemId}.json`;
	}

	/**
	 * 获取完整文件路径
	 */
	private getFullPath(filename: string): string {
		if (!this.webdavConfig) return filename;

		const basePath = this.webdavConfig.path || "";
		return basePath && basePath !== "/"
			? `${basePath.replace(/\/$/, "")}/${filename}`
			: filename;
	}

	/**
	 * 根据同步模式配置筛选云端数据
	 * @param remoteIndex 云端同步索引
	 * @param syncConfig 同步模式配置
	 * @returns 筛选后的云端同步项数据
	 */
	filterCloudDataForSync(
		remoteIndex: CloudSyncIndex | null,
		syncConfig: SyncModeConfig | null,
		options: { includeDeleted?: boolean; syncFavoriteChanges?: boolean } = {},
	): SyncItem[] {
		if (!remoteIndex || !remoteIndex.items.length) {
			return [];
		}

		// 将云端指纹转换为 SyncItem 格式
		const cloudItems: SyncItem[] = remoteIndex.items.map((item) => ({
			id: item.id,
			type: item.type,
			value: "", // 云端指纹只包含元数据，不包含完整内容
			search: "",
			createTime: new Date(item.timestamp).toISOString(),
			lastModified: item.timestamp,
			favorite: item.favorite,
			note: item.note,
			checksum: item.checksum,
			size: item.size,
			deviceId: "",
			group: this.determineGroup(item.type),
			count: 0,
		}));

		// 根据同步模式过滤数据
		const filteredItems = filterItemsBySyncMode(
			cloudItems as any[], // 需要类型转换，因为 filterItemsBySyncMode 需要 HistoryItem[]
			syncConfig,
			options,
		);

		return filteredItems.map((item) => item as SyncItem);
	}

	/**
	 * 获取云端数据指纹列表
	 * @param remoteIndex 云端同步索引
	 * @returns 云端数据指纹列表
	 */
	getCloudItemFingerprints(
		remoteIndex: CloudSyncIndex | null,
	): CloudItemFingerprint[] {
		return remoteIndex?.items || [];
	}

	/**
	 * 应用同步变更到云端
	 * @param currentIndex 当前云端索引
	 * @param syncResult 同步处理结果
	 * @param deviceId 当前设备ID
	 * @returns 是否成功
	 */
	async applySyncChanges(
		currentIndex: CloudSyncIndex | null,
		syncResult: {
			itemsToAdd: SyncItem[];
			itemsToUpdate: SyncItem[];
			itemsToDelete: string[];
		},
		deviceId: string,
	): Promise<boolean> {
		try {
			// 1. 首先获取当前的完整云端数据
			const currentCloudData = await this.downloadSyncData();
			let allItems: any[] = [];

			if (currentCloudData?.items) {
				// 保留现有数据，排除要删除的项目
				allItems = currentCloudData.items.filter(
					(item) => !syncResult.itemsToDelete.includes(item.id),
				);
			}

			// 2. 合并新增和更新的项目
			if (
				syncResult.itemsToAdd.length > 0 ||
				syncResult.itemsToUpdate.length > 0
			) {
				const itemsToMerge = [
					...syncResult.itemsToAdd,
					...syncResult.itemsToUpdate,
				];

				// 处理文件项目（如果有）
				const processedItems = await this.processUploadItems(itemsToMerge);

				// 移除已存在的项目（将被更新）
				allItems = allItems.filter(
					(existingItem) =>
						!processedItems.some((newItem) => newItem.id === existingItem.id),
				);

				// 添加新项目
				allItems.push(...processedItems);
			}

			// 3. 创建完整的同步数据包
			if (allItems.length > 0 || syncResult.itemsToDelete.length > 0) {
				const syncData = {
					timestamp: Date.now(),
					deviceId,
					dataType: "full", // 改为full，确保包含完整数据
					items: allItems,
					deleted: syncResult.itemsToDelete,
					compression: "none",
					checksum: calculateChecksum(JSON.stringify(allItems)),
				};

				// 上传完整数据
				const uploadSuccess = await this.uploadSyncData(syncData);
				if (!uploadSuccess) {
					return false;
				}
			}

			// 4. 使用 cloudDataManager 应用同步结果到云端索引
			const updatedIndex = this.applySyncResultToCloud(
				currentIndex,
				syncResult,
				deviceId,
				allItems, // 传递完整的数据列表
			);

			// 5. 上传更新后的索引
			return await this.uploadSyncIndex(updatedIndex);
		} catch (_error) {
			return false;
		}
	}

	/**
	 * 处理上传的项目（包括文件）
	 */
	private async processUploadItems(items: SyncItem[]): Promise<any[]> {
		const fileItems = items.filter(
			(item) => item.type === "image" || item.type === "files",
		);
		const nonFileItems = items.filter(
			(item) => item.type !== "image" && item.type !== "files",
		);

		const processedItems = [...nonFileItems];

		// 处理文件项目
		if (fileItems.length > 0) {
			const { fileSyncManager } = await import("./fileSyncManager");
			const MAX_CONCURRENT_FILE_PROCESSING = 3;
			const processPromises: Promise<void>[] = [];

			for (const item of fileItems) {
				const promise = (async () => {
					try {
						const processed = await fileSyncManager.processFileSyncItem(item);
						if (processed) {
							processedItems.push(processed);
						}
					} catch (_error) {
						// 处理上传文件项目失败
					}
				})();

				processPromises.push(promise);

				if (processPromises.length >= MAX_CONCURRENT_FILE_PROCESSING) {
					await Promise.race(processPromises);
					for (let j = processPromises.length - 1; j >= 0; j--) {
						if (
							await processPromises[j].then(
								() => true,
								() => true,
							)
						) {
							processPromises.splice(j, 1);
						}
					}
				}
			}

			await Promise.allSettled(processPromises);
		}

		return processedItems;
	}

	/**
	 * 应用同步结果到云端索引
	 * @param currentIndex 当前云端索引
	 * @param syncResult 同步处理结果
	 * @param deviceId 当前设备ID
	 * @param completeData 完整的数据列表（确保索引与数据一致）
	 * @returns 更新后的云端索引
	 */
	applySyncResultToCloud(
		currentIndex: CloudSyncIndex | null,
		syncResult: {
			itemsToAdd: SyncItem[];
			itemsToUpdate: SyncItem[];
			itemsToDelete: string[];
		},
		deviceId: string,
		completeData?: any[],
	): CloudSyncIndex {
		const baseIndex = currentIndex || this.createEmptyIndex(deviceId);
		const updatedIndex = { ...baseIndex };

		if (completeData) {
			// 基于完整数据生成索引，确保一致性
			updatedIndex.items = completeData.map((item) =>
				this.convertSyncItemToFingerprint(item),
			);
		} else {
			// 备用方案：使用原有逻辑（基于同步结果）
			// 1. 从索引中移除需要删除的项目
			updatedIndex.items = updatedIndex.items.filter(
				(item) => !syncResult.itemsToDelete.includes(item.id),
			);

			// 2. 更新现有项目
			for (const updateItem of syncResult.itemsToUpdate) {
				const index = updatedIndex.items.findIndex(
					(item) => item.id === updateItem.id,
				);
				if (index !== -1) {
					updatedIndex.items[index] =
						this.convertSyncItemToFingerprint(updateItem);
				}
			}

			// 3. 添加新项目
			for (const addItem of syncResult.itemsToAdd) {
				const exists = updatedIndex.items.find(
					(item) => item.id === addItem.id,
				);
				if (!exists) {
					updatedIndex.items.push(this.convertSyncItemToFingerprint(addItem));
				}
			}
		}

		// 4. 更新索引元数据
		updatedIndex.totalItems = updatedIndex.items.length;
		updatedIndex.deletedItems = [
			...updatedIndex.deletedItems.filter(
				(id) => !syncResult.itemsToDelete.includes(id),
			),
			...syncResult.itemsToDelete,
		];
		updatedIndex.dataChecksum = this.calculateIndexChecksum(updatedIndex);
		updatedIndex.statistics = this.calculateStatistics(updatedIndex);
		updatedIndex.timestamp = Date.now();

		return updatedIndex;
	}

	/**
	 * 将 SyncItem 转换为 CloudItemFingerprint
	 * @param item 同步项
	 * @returns 云端数据指纹
	 */
	private convertSyncItemToFingerprint(item: SyncItem): CloudItemFingerprint {
		// 确保有校验和，如果没有则重新计算
		let checksum = item.checksum;
		if (!checksum) {
			checksum = calculateChecksum(
				JSON.stringify({
					type: item.type,
					value: item.value,
					note: item.note || "",
				}),
			);
		}

		return {
			id: item.id,
			type: item.type,
			checksum,
			favoriteChecksum: item.favorite
				? calculateChecksum(JSON.stringify({ favorite: !!item.favorite }))
				: undefined,
			size: item.size || 0,
			timestamp: item.lastModified || Date.now(),
			favorite: item.favorite,
			deleted: false,
			note: item.note || "",
		};
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
export const cloudDataManager = new CloudDataManager();
