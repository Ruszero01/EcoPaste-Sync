import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import type { WebDAVConfig } from "@/plugins/webdav";
import type { CloudSyncIndex, SyncItem, SyncModeConfig } from "@/types/sync";
import { calculateChecksum } from "@/utils/shared";

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
	 * 下载云端同步数据（包含完整元数据）
	 */
	async downloadSyncIndex(): Promise<CloudSyncIndex | null> {
		if (!this.webdavConfig) return null;

		// 检查缓存
		const cached = this.getCachedIndex();
		if (cached) return cached;

		try {
			const filePath = this.getFullPath("sync-data.json");
			const result = await downloadSyncData(this.webdavConfig, filePath);

			if (result.success && result.data) {
				const syncData = JSON.parse(result.data);

				// 检查数据格式，支持新的统一格式或旧的分离格式
				if (this.isValidUnifiedDataFormat(syncData)) {
					// 新的统一格式，直接返回
					this.cachedIndex = syncData;
					this.indexCacheTime = Date.now();
					return syncData;
				}

				if (this.isValidLegacyIndexFormat(syncData)) {
					// 旧的索引格式，需要下载完整数据
					const fullData = await this.downloadSyncData();
					if (fullData?.items) {
						const unifiedData = this.convertLegacyToUnified(syncData, fullData);
						this.cachedIndex = unifiedData;
						this.indexCacheTime = Date.now();
						return unifiedData;
					}
				}
			}
		} catch (error) {
			console.error("❌ 下载云端同步数据失败:", error);
		}

		return null;
	}

	/**
	 * 上传云端同步数据（统一格式）
	 */
	async uploadSyncIndex(index: CloudSyncIndex): Promise<boolean> {
		if (!this.webdavConfig) return false;

		try {
			const filePath = this.getFullPath("sync-data.json");
			const jsonData = JSON.stringify(index, null, 2);
			const result = await uploadSyncData(
				this.webdavConfig,
				filePath,
				jsonData,
			);

			if (result.success) {
				this.cachedIndex = index;
				this.indexCacheTime = Date.now();
				return true;
			} else {
				console.error(`❌ 云端索引上传失败: ${result.error_message}`);
			}
		} catch (error) {
			console.error("❌ 云端索引上传异常:", error);
		}

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

		// 新格式：直接使用完整的SyncItem数据
		updatedIndex.items = activeItems.map((item) => ({
			id: item.id,
			type: item.type,
			value: item.value || "",
			search: item.search || "",
			createTime:
				item.createTime ||
				new Date(item.lastModified || Date.now()).toISOString(),
			lastModified: item.lastModified || Date.now(),
			favorite: item.favorite,
			note: item.note || "",
			checksum: item.checksum || "",
			size: item.size || 0,
			deviceId: item.deviceId || "",
			group: item.group || this.determineGroup(item.type),
			count: item.count || 0,
			width: item.width,
			height: item.height,
			subtype: item.subtype,
			deleted: item.deleted || false,
		}));

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
			items: [] as SyncItem[], // 明确指定类型
			totalItems: 0,
			dataChecksum: "",
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
	 * 验证新的统一数据格式
	 */
	private isValidUnifiedDataFormat(data: any): data is CloudSyncIndex {
		return (
			data &&
			data.format === "unified" &&
			Array.isArray(data.items) &&
			data.items.length > 0 &&
			data.items[0].type && // 检查是否为完整的SyncItem格式
			typeof data.timestamp === "number" &&
			typeof data.deviceId === "string" &&
			typeof data.items[0].value === "string" // 检查是否有完整的value字段
		);
	}

	/**
	 * 验证旧的索引格式
	 */
	private isValidLegacyIndexFormat(index: any): index is CloudSyncIndex {
		return (
			index &&
			index.format === "unified" &&
			Array.isArray(index.items) &&
			typeof index.timestamp === "number" &&
			typeof index.deviceId === "string" &&
			index.items[0] && // 检查是否为指纹格式（缺少完整字段）
			typeof index.items[0].checksum === "string"
		);
	}

	/**
	 * 将旧的分离格式转换为新的统一格式
	 */
	private convertLegacyToUnified(
		indexData: any,
		fullData: any,
	): CloudSyncIndex {
		const unifiedData: CloudSyncIndex = {
			...indexData,
			items: fullData.items || [], // 使用完整数据作为items
		};

		// 重新计算统计信息
		unifiedData.totalItems = unifiedData.items.length;
		unifiedData.statistics = this.calculateStatistics(unifiedData);

		return unifiedData;
	}

	/**
	 * 计算索引校验和
	 */
	private calculateIndexChecksum(index: CloudSyncIndex): string {
		const checksumData = {
			items: index.items.map((item) => ({
				id: item.id,
				checksum: item.checksum,
				timestamp: item.lastModified || Date.now(),
			})),
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
			totalSize += item.size || 0;
			if (item.favorite) favoriteCount++;
			if (item.lastModified && item.lastModified > lastModified)
				lastModified = item.lastModified;
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
			// 1. 更新云端索引，直接移除已删除的项目
			const currentIndex = await this.downloadSyncIndex();

			if (currentIndex) {
				const updatedItems = currentIndex.items.filter(
					(item) => !itemIds.includes(item.id),
				);

				// 创建更新后的索引
				const updatedIndex: CloudSyncIndex = {
					...currentIndex,
					items: updatedItems,
					totalItems: updatedItems.length,
					timestamp: Date.now(),
					dataChecksum: "", // 临时设为空，稍后重新计算
				};

				// 重新计算校验和
				updatedIndex.dataChecksum = this.calculateIndexChecksum(updatedIndex);
				updatedIndex.statistics = this.calculateStatistics(updatedIndex);

				const indexUpdateSuccess = await this.uploadSyncIndex(updatedIndex);

				if (indexUpdateSuccess) {
					successCount = itemIds.length;
					console.info(`🗑️ 云端删除成功: ${successCount} 个项目`);
				} else {
					failedCount = itemIds.length;
					errors.push("更新云端索引失败");
					console.error(`❌ 云端删除失败: ${itemIds.length} 个项目`);
				}
			} else {
				failedCount = itemIds.length;
				errors.push("无法获取云端索引");
				console.error(`❌ 云端删除失败: 无法获取索引`);
			}
		} catch (error) {
			failedCount = itemIds.length;
			errors.push("删除操作异常: " + String(error));
		}

		return { success: successCount, failed: failedCount, errors };
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
		options: { includeDeleted?: boolean } = {},
	): SyncItem[] {
		if (!remoteIndex || !remoteIndex.items.length) {
			return [];
		}

		// 检查是否为新格式（包含完整的SyncItem数据）
		const isNewFormat =
			remoteIndex.items[0].value !== undefined &&
			typeof remoteIndex.items[0].value === "string" &&
			remoteIndex.items[0].count !== undefined;

		let cloudItems: SyncItem[];

		if (isNewFormat) {
			// 新格式：直接使用完整的SyncItem数据
			cloudItems = remoteIndex.items.map((item) => ({
				id: item.id,
				type: item.type,
				value: item.value, // 完整的value字段内容
				search: item.search || "",
				createTime:
					item.createTime ||
					new Date(item.lastModified || Date.now()).toISOString(),
				lastModified: item.lastModified || Date.now(),
				favorite: item.favorite,
				note: item.note || "",
				checksum: item.checksum,
				size: item.size || 0,
				deviceId: item.deviceId || "",
				group: item.group || this.determineGroup(item.type),
				count: item.count || 0,
				width: item.width,
				height: item.height,
				subtype: item.subtype,
				deleted: item.deleted || false,
			}));
		} else {
			// 旧格式：从指纹转换为SyncItem（兼容性处理）
			cloudItems = remoteIndex.items.map((item: any) => ({
				id: item.id,
				type: item.type,
				value: item.value || "", // 指纹中的基本元数据
				search: "",
				createTime: new Date(item.timestamp).toISOString(),
				lastModified: item.timestamp,
				favorite: item.favorite,
				note: item.note || "",
				checksum: item.checksum,
				size: item.size || 0,
				deviceId: "",
				group: this.determineGroup(item.type),
				count: 0,
				deleted: item.deleted || false,
			}));
		}

		// 使用专门的云端数据筛选逻辑，不考虑syncStatus（云端数据没有此字段）
		const filteredItems = this.filterCloudItemsBySyncMode(
			cloudItems,
			syncConfig,
			options,
		);

		return filteredItems;
	}

	/**
	 * 获取所有云端数据（不进行模式过滤）
	 * @param remoteIndex 云端索引
	 * @param options 过滤选项
	 * @returns 所有云端同步项数据
	 */
	getAllCloudItems(
		remoteIndex: CloudSyncIndex | null,
		options: { includeDeleted?: boolean } = {},
	): SyncItem[] {
		if (!remoteIndex || !remoteIndex.items.length) {
			return [];
		}

		const { includeDeleted = false } = options;

		// 检查是否为新格式（包含完整的SyncItem数据）
		const isNewFormat =
			remoteIndex.items[0].value !== undefined &&
			typeof remoteIndex.items[0].value === "string" &&
			remoteIndex.items[0].count !== undefined;

		let cloudItems: SyncItem[];

		if (isNewFormat) {
			// 新格式：直接使用完整的SyncItem数据
			cloudItems = remoteIndex.items.map((item) => ({
				id: item.id,
				type: item.type,
				value: item.value, // 完整的value字段内容
				search: item.search || "",
				createTime:
					item.createTime ||
					new Date(item.lastModified || Date.now()).toISOString(),
				lastModified: item.lastModified || Date.now(),
				favorite: item.favorite,
				note: item.note || "",
				checksum: item.checksum,
				size: item.size || 0,
				deviceId: item.deviceId || "",
				group: this.determineGroup(item.type),
				count: item.count || 0,
				width: item.width || 0,
				height: item.height || 0,
				subtype: item.subtype,
				deleted: item.deleted || false,
			}));
		} else {
			// 旧格式：从指纹转换为SyncItem（兼容性处理）
			cloudItems = remoteIndex.items.map((item: any) => ({
				id: item.id,
				type: item.type,
				value: item.value || "", // 指纹中的基本元数据
				search: "",
				createTime: new Date(item.timestamp).toISOString(),
				lastModified: item.timestamp,
				favorite: item.favorite,
				note: item.note || "",
				checksum: item.checksum,
				size: item.size || 0,
				deviceId: "",
				group: this.determineGroup(item.type),
				count: 0,
				deleted: item.deleted || false,
			}));
		}

		// 只过滤删除状态，不进行模式过滤
		return cloudItems.filter((item) => {
			// 删除状态过滤
			if (
				!includeDeleted &&
				(item.deleted === true || (item.deleted as any) === 1)
			) {
				return false;
			}
			return true;
		});
	}

	/**
	 * 根据同步模式配置筛选云端数据
	 * 云端数据筛选逻辑：只考虑同步模式，不考虑syncStatus
	 * @param items 云端数据项
	 * @param syncConfig 同步模式配置
	 * @param options 过滤选项
	 * @returns 过滤后的数据
	 */
	private filterCloudItemsBySyncMode(
		items: SyncItem[],
		syncConfig: SyncModeConfig | null,
		options: { includeDeleted?: boolean } = {},
	): SyncItem[] {
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

			return true;
		});
	}

	/**
	 * 获取云端数据指纹列表
	 * @param remoteIndex 云端同步索引
	 * @returns 云端数据指纹列表
	 */
	getCloudItemFingerprints(remoteIndex: CloudSyncIndex | null): SyncItem[] {
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
					(item: SyncItem) => !syncResult.itemsToDelete.includes(item.id),
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

				// 处理项目元数据（实际文件上传由 fileSyncManager 处理）
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
	 * 处理上传的项目（元数据管理，不处理文件上传）
	 * 实际的文件上传由 fileSyncManager 负责
	 */
	private async processUploadItems(items: SyncItem[]): Promise<any[]> {
		// 处理每个项目，如果有文件元数据，则将其合并到 value 中（仅用于云端存储）
		return items.map((item) => {
			const itemCopy = { ...item };

			// 如果有文件元数据，将其存储在云端索引中
			const itemWithMetadata = item as any;
			if (itemWithMetadata._fileMetadata) {
				(itemCopy as any)._fileMetadata = itemWithMetadata._fileMetadata;
			}
			if (itemWithMetadata._syncType) {
				itemCopy._syncType = itemWithMetadata._syncType;
			}

			return itemCopy;
		});
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
			// 新格式：直接使用完整的SyncItem数据（已处理删除操作）
			updatedIndex.items = completeData;
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
					updatedIndex.items[index] = updateItem;
				}
			}

			// 3. 添加新项目
			for (const addItem of syncResult.itemsToAdd) {
				const exists = updatedIndex.items.find(
					(item) => item.id === addItem.id,
				);
				if (!exists) {
					updatedIndex.items.push(addItem);
				}
			}
		}

		// 4. 更新索引元数据（不再记录 deletedItems）
		updatedIndex.totalItems = updatedIndex.items.length;
		updatedIndex.dataChecksum = this.calculateIndexChecksum(updatedIndex);
		updatedIndex.statistics = this.calculateStatistics(updatedIndex);
		updatedIndex.timestamp = Date.now();

		return updatedIndex;
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
