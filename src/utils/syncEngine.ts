import { LISTEN_KEY } from "@/constants";
import { getHistoryData, selectSQL, updateSQL } from "@/database";
import {
	type WebDAVConfig,
	downloadSyncData,
	uploadSyncData,
} from "@/plugins/webdav";
import type {
	CloudItemFingerprint,
	ConflictInfo,
	SyncData,
	SyncItem,
	SyncModeConfig,
	SyncResult,
} from "@/types/sync";
import {
	calculateChecksum as calculateStringChecksum,
	generateDeviceId,
} from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
import { cloudDataManager } from "./cloudDataManager";
import { fileSyncManager } from "./fileSyncManager";
import { syncConflictResolver } from "./syncConflictResolver";
import {
	detectLocalDeletions,
	extractFileCoreValue,
	generateLightweightLocalData,
} from "./syncFilter";

export function calculateUnifiedChecksum(
	item: any,
	includeMetadata = false,
	includeFavorite = true,
): string {
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

	if (includeMetadata) {
		coreFields.createTime = item.createTime;
		coreFields.favorite = !!item.favorite;
		coreFields.note = item.note || "";
	}

	if (includeFavorite) {
		coreFields.favorite = !!item.favorite;
	}

	const sortedKeys = Object.keys(coreFields).sort();
	const orderedObject: any = {};

	for (const key of sortedKeys) {
		orderedObject[key] = coreFields[key];
	}

	const checksumSource = JSON.stringify(orderedObject);
	return calculateStringChecksum(checksumSource);
}

export function calculateContentChecksum(item: any): string {
	return calculateUnifiedChecksum(item, false, false);
}

export function calculateFavoriteAwareChecksum(item: any): string {
	return calculateUnifiedChecksum(item, false, true);
}

let syncEventEmitter: (() => void) | null = null;

const setDefaultSyncListener = () => {
	if (!syncEventEmitter) {
		syncEventEmitter = () => {};
	}
};

export const setSyncEventListener = (listener: () => void) => {
	if (syncEventEmitter === listener) {
		return;
	}
	syncEventEmitter = listener;
};

export class SyncEngine {
	private webdavConfig: WebDAVConfig | null = null;
	private deviceId: string = generateDeviceId();
	private isOnline = false;
	private lastSyncTime = 0;
	private syncModeConfig: SyncModeConfig | null = null;
	private isInitialized = false;

	private syncInProgress = false;

	private isTransitioningToFavoriteMode = false;
	private isTransitioningFromFavoriteMode = false;

	constructor() {
		this.deviceId = generateDeviceId();
		setDefaultSyncListener();
	}

	async initialize(config: WebDAVConfig): Promise<boolean> {
		if (this.isInitialized && this.webdavConfig) {
			const isSameConfig =
				this.webdavConfig.url === config.url &&
				this.webdavConfig.username === config.username &&
				this.webdavConfig.path === config.path;
			if (isSameConfig) return true;
		}

		this.webdavConfig = config;
		this.isOnline = true;
		cloudDataManager.setWebDAVConfig(config);
		fileSyncManager.setWebDAVConfig(config);

		const index = await cloudDataManager.downloadSyncIndex();
		this.isInitialized = true;

		return index !== null;
	}

	setSyncModeConfig(config: SyncModeConfig): void {
		if (this.syncModeConfig) {
			const configString = JSON.stringify(config);
			const currentConfigString = JSON.stringify(this.syncModeConfig);
			if (configString === currentConfigString) return;
		}

		const fileModeChanged =
			this.syncModeConfig?.settings.includeImages !==
				config.settings.includeImages ||
			this.syncModeConfig?.settings.includeFiles !==
				config.settings.includeFiles;
		const favoriteModeChanged =
			this.syncModeConfig?.settings.onlyFavorites !==
			config.settings.onlyFavorites;

		if (favoriteModeChanged) {
			this.handleFavoriteModeChange(
				this.syncModeConfig?.settings.onlyFavorites || false,
				config.settings.onlyFavorites,
			);
		}

		this.syncModeConfig = config;

		if (fileModeChanged || favoriteModeChanged) {
			this.clearCache();
			cloudDataManager.clearCache();
		}
	}

	private handleFavoriteModeChange(
		previousOnlyFavorites: boolean,
		currentOnlyFavorites: boolean,
	): void {
		if (!previousOnlyFavorites && currentOnlyFavorites) {
			this.isTransitioningToFavoriteMode = true;
		} else if (previousOnlyFavorites && !currentOnlyFavorites) {
			this.isTransitioningFromFavoriteMode = true;
		}
	}

	getDeviceId(): string {
		return this.deviceId;
	}

	checkTransitioningToFavoriteMode(): boolean {
		return this.isTransitioningToFavoriteMode;
	}

	checkTransitioningFromFavoriteMode(): boolean {
		return this.isTransitioningFromFavoriteMode;
	}

	resetModeTransitionFlags(): void {
		this.isTransitioningToFavoriteMode = false;
		this.isTransitioningFromFavoriteMode = false;
	}

	private getFullPath(fileName: string): string {
		if (!this.webdavConfig) return `/${fileName}`;
		const basePath = this.webdavConfig.path.startsWith("/")
			? this.webdavConfig.path
			: `/${this.webdavConfig.path}`;
		return `${basePath}/${fileName}`;
	}

	async performBidirectionalSync(): Promise<SyncResult> {
		if (this.syncInProgress) {
			return {
				success: false,
				uploaded: 0,
				downloaded: 0,
				conflicts: [],
				errors: ["同步正在进行中"],
				duration: 0,
				timestamp: Date.now(),
			};
		}

		if (!this.webdavConfig) {
			throw new Error("WebDAV配置未初始化");
		}

		this.syncInProgress = true;
		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		try {
			const localRawData = await getHistoryData(false);
			let localLightweightData = generateLightweightLocalData(
				localRawData,
				false,
			);

			// 应用同步模式过滤
			if (this.syncModeConfig) {
				const { filterItemsBySyncMode } = await import("./syncFilter");
				localLightweightData = filterItemsBySyncMode(
					localLightweightData,
					this.syncModeConfig,
					{ includeDeleted: false },
				);
			}
			const localDeletedItems = detectLocalDeletions(localLightweightData);

			const remoteIndex = await cloudDataManager.downloadSyncIndex();

			const diffResult = cloudDataManager.detectSyncDifferences(
				localLightweightData,
				remoteIndex,
				localDeletedItems,
			);

			let downloadCount = 0;
			if (diffResult.toDownload.length > 0 && remoteIndex) {
				downloadCount = await this.downloadRemoteItems(diffResult.toDownload);
			}

			let uploadCount = 0;
			const itemsToUpload = [
				...diffResult.added,
				...diffResult.modified,
				...diffResult.favoriteChanged,
			];

			if (itemsToUpload.length > 0 || localDeletedItems.length > 0) {
				uploadCount = await this.uploadLocalItems(
					itemsToUpload,
					localDeletedItems,
				);

				await this.updateRemoteIndex(localDeletedItems);
			}

			if (
				this.isTransitioningToFavoriteMode ||
				this.isTransitioningFromFavoriteMode
			) {
				this.resetModeTransitionFlags();
			}

			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch {}

			result.success = true;
			result.uploaded = uploadCount;
			result.downloaded = downloadCount;
			this.lastSyncTime = Date.now();
		} catch (error) {
			result.errors.push(
				`同步异常: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			this.syncInProgress = false;
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	private async downloadRemoteItems(
		itemsToDownload: CloudItemFingerprint[],
	): Promise<number> {
		const remoteData = await this.downloadRemoteData();
		if (!remoteData?.items) return 0;

		const itemsToProcess = remoteData.items.filter((item) =>
			itemsToDownload.some((fp) => fp.id === item.id),
		);

		const { mergedData, conflicts } = await this.mergeRemoteData(
			{ ...remoteData, items: itemsToProcess },
			[], // 不需要本地项，因为我们正在下载远程数据
		);

		if (conflicts.length > 0) {
			// 使用新的冲突解决器
			for (const conflict of conflicts) {
				syncConflictResolver.resolveConflict({
					localItem: conflict.localVersion,
					remoteItem: conflict.remoteVersion,
					deviceId: this.deviceId,
				});
			}
		}

		await this.updateLocalData(mergedData);
		// 文件同步现在通过 processFileSyncItem 自动处理

		return itemsToProcess.length;
	}

	private async uploadLocalItems(
		_itemsToUpload: CloudItemFingerprint[],
		deletedItems: string[],
	): Promise<number> {
		// 获取所有符合同步模式的本地数据
		const localRawData = await getHistoryData(false);
		let allSyncableData = localRawData;

		// 应用同步模式过滤
		if (this.syncModeConfig) {
			const { filterItemsBySyncMode } = await import("./syncFilter");
			allSyncableData = filterItemsBySyncMode(
				allSyncableData,
				this.syncModeConfig,
				{ includeDeleted: false },
			);
		}

		// 转换为同步项格式
		const fullLocalData = await this.convertToSyncItems(allSyncableData);
		const processedData = await this.processFileItems(fullLocalData);

		// 处理删除的项目：从完整数据中移除已删除的项目
		const finalData = processedData.filter(
			(item) => !deletedItems.includes(item.id),
		);

		const syncData: SyncData = {
			timestamp: Date.now(),
			deviceId: this.deviceId,
			dataType: "full", // 使用完整数据，确保云端包含所有同步数据
			items: finalData,
			deleted: deletedItems,
			compression: "none",
			checksum: calculateStringChecksum(JSON.stringify(finalData)),
		};

		const uploadSuccess = await this.uploadSyncData(syncData);

		if (uploadSuccess) {
			if (deletedItems.length > 0) {
				await this.deleteRemoteFiles(deletedItems);
			}
			return finalData.length;
		}

		return 0;
	}

	private async updateRemoteIndex(_deletedItems: string[]): Promise<void> {
		const currentIndex = await cloudDataManager.downloadSyncIndex();
		const localRawData = await getHistoryData(false);
		let currentLocalData = generateLightweightLocalData(localRawData, false);

		// 应用同步模式过滤
		if (this.syncModeConfig) {
			const { filterItemsBySyncMode } = await import("./syncFilter");
			currentLocalData = filterItemsBySyncMode(
				currentLocalData,
				this.syncModeConfig,
				{ includeDeleted: false },
			);
		}

		const updatedIndex = cloudDataManager.updateIndexWithLocalChanges(
			currentIndex || cloudDataManager.createEmptyIndex(this.deviceId),
			currentLocalData,
			_deletedItems,
		);

		await cloudDataManager.uploadSyncIndex(updatedIndex);
	}

	async downloadRemoteData(): Promise<SyncData | null> {
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

	private async uploadSyncData(syncData: SyncData): Promise<boolean> {
		if (!this.webdavConfig) {
			return false;
		}

		try {
			const filePath = this.getFullPath("sync-data.json");
			const dataString = JSON.stringify(syncData, null, 2);

			const result = await uploadSyncData(
				this.webdavConfig,
				filePath,
				dataString,
			);

			return result.success;
		} catch {
			return false;
		}
	}

	private async convertToSyncItems(items: any[]): Promise<SyncItem[]> {
		const syncItems: SyncItem[] = [];
		const fileItems: any[] = [];
		const nonFileItems: any[] = [];

		for (const item of items) {
			if (item.type === "image" || item.type === "files") {
				fileItems.push(item);
			} else {
				nonFileItems.push(item);
			}
		}

		for (const item of nonFileItems) {
			try {
				const syncItem = this.convertToSyncItem(item);
				syncItems.push(syncItem);
			} catch {}
		}

		const MAX_CONCURRENT_FILE_PROCESSING = 3;
		const fileProcessPromises: Promise<void>[] = [];

		for (let i = 0; i < fileItems.length; i++) {
			const item = fileItems[i];
			const promise = (async () => {
				try {
					const syncItem = this.convertToSyncItem(item);
					const processedSyncItem =
						await fileSyncManager.processFileSyncItem(syncItem);

					if (processedSyncItem) {
						syncItems.push(processedSyncItem);
					}
				} catch {}
			})();

			fileProcessPromises.push(promise);

			if (fileProcessPromises.length >= MAX_CONCURRENT_FILE_PROCESSING) {
				await Promise.race(fileProcessPromises);
				for (let j = fileProcessPromises.length - 1; j >= 0; j--) {
					if (
						await fileProcessPromises[j].then(
							() => true,
							() => true,
						)
					) {
						fileProcessPromises.splice(j, 1);
					}
				}
			}
		}

		await Promise.allSettled(fileProcessPromises);

		return syncItems;
	}

	private convertToSyncItem(item: any): SyncItem {
		const checksum = item.checksum || calculateContentChecksum(item);

		let size: number;
		if (item.type === "image" || item.type === "files") {
			const coreValue = extractFileCoreValue(item);
			size = coreValue.length;
		} else {
			size = JSON.stringify(item).length;
		}

		let groupValue: "text" | "image" | "files";
		if (item.group) {
			groupValue = item.group;
		} else {
			switch (item.type as "text" | "image" | "files" | "html" | "rtf") {
				case "image":
					groupValue = "image";
					break;
				case "files":
					groupValue = "files";
					break;
				default:
					groupValue = "text";
					break;
			}
		}

		return {
			id: item.id,
			type: item.type,
			group: groupValue,
			value: item.value,
			search: item.search,
			count: item.count,
			width: item.width,
			height: item.height,
			favorite: item.favorite,
			createTime: item.createTime,
			note: item.note,
			subtype: item.subtype,
			lastModified: item.lastModified || Date.now(),
			deviceId: this.deviceId,
			size,
			checksum,
			deleted: item.deleted || false,
		};
	}

	private async processFileItems(items: SyncItem[]): Promise<SyncItem[]> {
		const MAX_CONCURRENT_FILE_PROCESSING = 3;
		const processedItems: SyncItem[] = [];
		const processPromises: Promise<void>[] = [];

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const promise = (async () => {
				try {
					const processed = await fileSyncManager.processFileSyncItem(item);
					if (processed) {
						processedItems.push(processed);
					}
				} catch {}
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

		return processedItems;
	}

	private async mergeRemoteData(
		remoteData: SyncData,
		localData: SyncItem[],
	): Promise<{ mergedData: SyncItem[]; conflicts: ConflictInfo[] }> {
		const conflicts: ConflictInfo[] = [];
		const localMap = new Map(localData.map((item) => [item.id, item]));
		const mergedData: SyncItem[] = [];

		for (const remoteItem of remoteData.items) {
			const localItem = localMap.get(remoteItem.id);

			if (!localItem) {
				mergedData.push(remoteItem);
			} else {
				const localTime = new Date(localItem.createTime).getTime();
				const remoteTime = new Date(remoteItem.createTime).getTime();

				if (localItem.checksum !== remoteItem.checksum) {
					const conflict: ConflictInfo = {
						itemId: remoteItem.id,
						type: "modify",
						localVersion: localItem,
						remoteVersion: remoteItem,
						resolution: remoteTime > localTime ? "remote" : "local",
						reason: "内容冲突",
					};
					conflicts.push(conflict);

					if (remoteTime > localTime) {
						mergedData.push(remoteItem);
					} else {
						mergedData.push(localItem);
					}
				} else {
					mergedData.push(localItem);
				}
			}
		}

		for (const localItem of localData) {
			if (!remoteData.items.some((remote) => remote.id === localItem.id)) {
				mergedData.push(localItem);
			}
		}

		return { mergedData, conflicts };
	}

	private async updateLocalData(
		data: SyncItem[],
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const errors: string[] = [];
		let successCount = 0;
		let failedCount = 0;

		for (const item of data) {
			try {
				await this.insertOrUpdateItem(item);
				successCount++;
			} catch {
				failedCount++;
			}
		}

		return { success: successCount, failed: failedCount, errors };
	}

	private async insertOrUpdateItem(item: SyncItem): Promise<void> {
		try {
			let queryValue = item.value || "";
			if (item.type === "image" || item.type === "files") {
				queryValue = extractFileCoreValue(item);
			}

			let groupValue: "text" | "image" | "files";
			if (item.group) {
				groupValue = item.group;
			} else {
				switch (item.type as "text" | "image" | "files" | "html" | "rtf") {
					case "image":
						groupValue = "image";
						break;
					case "files":
						groupValue = "files";
						break;
					default:
						groupValue = "text";
						break;
				}
			}

			let calculatedCount = item.fileSize || item.count || 0;
			if (
				(item.type === "text" || item.type === "html" || item.type === "rtf") &&
				item.value
			) {
				calculatedCount = (item.value || "").length;
			}

			// 确保收藏状态转换为数据库兼容的格式（0/1）
			const favoriteValue = item.favorite ? 1 : 0;

			const localItem: any = {
				id: item.id,
				type: item.type,
				group: groupValue,
				value: item.value || "", // 确保 value 不为 null 或 undefined
				search: item.search || "",
				count: calculatedCount,
				width: item.width,
				height: item.height,
				favorite: favoriteValue, // 使用数值格式而不是 boolean
				createTime: item.createTime,
				note: item.note || "",
				subtype: item.subtype,
				lazyDownload: item.lazyDownload,
				fileSize: item.fileSize,
				fileType: item.fileType,
			};

			const existingById = (await selectSQL("history", {
				id: item.id,
			})) as any[];

			if (existingById && existingById.length > 0) {
				const existing = existingById[0];
				const resolvedFavorite = this.resolveFavoriteStatus(existing, item);
				const updateItem = {
					...localItem,
					id: existing.id,
					favorite: resolvedFavorite ? 1 : 0, // 转换为数值格式
					count: Math.max(existing.count || 0, item.count || 0),
					createTime: existing.createTime,
					note: item.note?.trim() ? item.note : existing.note || "",
				};

				await updateSQL("history", updateItem);
				return;
			}

			const existingRecords = (await selectSQL("history", {
				type: item.type,
				value: queryValue,
			})) as any[];

			if (existingRecords && existingRecords.length > 0) {
				const existing = existingRecords[0];
				const resolvedFavorite = this.resolveFavoriteStatus(existing, item);
				const updateItem = {
					...localItem,
					id: existing.id,
					favorite: resolvedFavorite ? 1 : 0, // 转换为数值格式
					count: Math.max(existing.count || 0, item.count || 0),
					createTime: existing.createTime,
					note: item.note?.trim() ? item.note : existing.note || "",
				};

				await updateSQL("history", updateItem);
			} else {
				await this.insertForSync("history", localItem);
			}
		} catch (error) {
			throw new Error(
				`插入或更新项失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private resolveFavoriteStatus(existing: any, incoming: SyncItem): boolean {
		const existingIsFavorite =
			existing.favorite === true || existing.favorite === 1;
		const incomingIsFavorite = incoming.favorite;

		let result: boolean;

		if (this.checkTransitioningToFavoriteMode()) {
			result = existingIsFavorite;
		} else if (this.checkTransitioningFromFavoriteMode()) {
			result = existingIsFavorite;
		} else {
			// 正常情况下，优先使用传入的收藏状态
			result = incomingIsFavorite;

			if (this.syncModeConfig?.settings.onlyFavorites && !incomingIsFavorite) {
				// 在仅收藏模式下，如果传入的数据不是收藏状态，则不保存
				result = false;
			}
		}

		return result;
	}

	private async insertForSync(tableName: string, item: any): Promise<void> {
		try {
			const { insertWithDeduplicationForSync } = await import("@/database");
			await insertWithDeduplicationForSync(tableName as any, item);
		} catch (error) {
			throw new Error(
				`插入数据失败 (表: ${tableName}, ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async deleteRemoteFiles(
		deletedIds: string[],
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const results = { success: 0, failed: 0, errors: [] as string[] };

		if (!this.webdavConfig || deletedIds.length === 0) {
			return results;
		}

		const filePackagesToDelete: any[] = [];

		for (const deletedId of deletedIds) {
			const packageInfo = {
				packageId: deletedId,
				itemId: deletedId,
				itemType: "files",
				fileName: `${deletedId}.zip`,
				originalPaths: [],
				size: 0,
				checksum: "",
				compressedSize: 0,
			};
			filePackagesToDelete.push(packageInfo);
		}

		if (filePackagesToDelete.length === 0) {
			return results;
		}

		const deleteSuccess = await fileSyncManager.deleteRemoteFiles(
			filePackagesToDelete.map((pkg) => pkg.packageId),
		);

		return {
			success: deleteSuccess ? filePackagesToDelete.length : 0,
			failed: deleteSuccess ? 0 : filePackagesToDelete.length,
			errors: deleteSuccess ? [] : ["删除远程文件失败"],
		};
	}

	getSyncStatus() {
		return {
			isOnline: this.isOnline,
			isSyncing: this.syncInProgress,
			lastSyncTime: this.lastSyncTime,
			pendingCount: 0,
			errorCount: 0,
			syncProgress: 0,
		};
	}

	clearCache(): void {
		cloudDataManager.clearCache();
	}

	canSync(): boolean {
		return this.isOnline && !!this.webdavConfig && !this.syncInProgress;
	}

	async markItemAsDeleted(itemId: string): Promise<boolean> {
		try {
			await updateSQL("history", {
				id: itemId,
				deleted: true,
			});

			return true;
		} catch {
			return false;
		}
	}

	async permanentlyDeleteItems(itemIds: string[]): Promise<void> {
		if (itemIds.length === 0) {
			return;
		}

		try {
			const { deleteFromDatabase } = await import("@/database");
			await deleteFromDatabase("history", itemIds);
		} catch {}
	}
}

export const syncEngine = new SyncEngine();
