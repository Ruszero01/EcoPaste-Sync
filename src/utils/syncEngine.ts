import { LISTEN_KEY } from "@/constants";
import { getHistoryData, selectSQL, updateSQL } from "@/database";
import {
	type WebDAVConfig,
	downloadSyncData,
	uploadSyncData,
} from "@/plugins/webdav";
import type {
	CloudItemFingerprint,
	CloudSyncIndex,
	ConflictInfo,
	SyncData,
	SyncDiffResult,
	SyncItem,
	SyncModeConfig,
	SyncResult,
} from "@/types/sync";
import { filePackageManager } from "@/utils/filePackageManager";
import {
	calculateChecksum as calculateStringChecksum,
	generateDeviceId,
} from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
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

function detectDiff(
	localFingerprints: Map<string, CloudItemFingerprint>,
	remoteIndex: CloudSyncIndex,
	localDeletedIds: Set<string>,
): SyncDiffResult {
	const remoteMap = new Map(remoteIndex.items.map((item) => [item.id, item]));

	const result: SyncDiffResult = {
		added: [],
		modified: [],
		favoriteChanged: [],
		deleted: [],
		toDownload: [],
		unchanged: [],
		statistics: {
			totalLocal: localFingerprints.size,
			totalRemote: remoteIndex.items.length,
			conflicts: 0,
		},
	};

	for (const [id, localFp] of localFingerprints) {
		if (localDeletedIds.has(id)) continue;

		const remoteFp = remoteMap.get(id);
		if (!remoteFp) {
			result.added.push(localFp);
		} else {
			const contentChanged = localFp.checksum !== remoteFp.checksum;
			const favoriteChanged = localFp.favorite !== remoteFp.favorite;

			if (contentChanged && favoriteChanged) {
				result.modified.push(localFp);
			} else if (contentChanged) {
				result.modified.push(localFp);
			} else if (favoriteChanged) {
				result.favoriteChanged.push(localFp);
			} else {
				result.unchanged.push(id);
			}
		}
	}

	for (const [id, remoteFp] of remoteMap) {
		const localFp = localFingerprints.get(id);

		if (!localFp && !remoteFp.deleted) {
			result.toDownload.push(remoteFp);
		} else if (localFp && needsDownload(localFp, remoteFp)) {
			result.toDownload.push(remoteFp);
		}
	}

	return result;
}

function needsDownload(
	localFp: CloudItemFingerprint,
	remoteFp: CloudItemFingerprint,
): boolean {
	if (remoteFp.deleted) return false;

	return (
		remoteFp.timestamp > localFp.timestamp &&
		remoteFp.checksum !== localFp.checksum
	);
}

class UnifiedCloudDataManager {
	private webdavConfig: WebDAVConfig | null = null;
	private cachedIndex: CloudSyncIndex | null = null;
	private indexCacheTime = 0;
	private readonly INDEX_CACHE_TTL = 30000;

	constructor(deviceId: string) {
		void deviceId;
	}

	setWebDAVConfig(config: WebDAVConfig): void {
		this.webdavConfig = config;
	}

	private getIndexFilePath(): string {
		if (!this.webdavConfig) return "/sync-index.json";
		const basePath = this.webdavConfig.path.startsWith("/")
			? this.webdavConfig.path
			: `/${this.webdavConfig.path}`;
		return `${basePath}/sync-index.json`;
	}

	async downloadSyncIndex(): Promise<CloudSyncIndex | null> {
		if (!this.webdavConfig) return null;

		try {
			const filePath = this.getIndexFilePath();
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

	async uploadSyncIndex(index: CloudSyncIndex): Promise<boolean> {
		if (!this.webdavConfig) return false;

		try {
			const filePath = this.getIndexFilePath();
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

	getCachedIndex(): CloudSyncIndex | null {
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

	generateLocalFingerprints(
		localItems: any[],
	): Map<string, CloudItemFingerprint> {
		const fingerprintMap = new Map<string, CloudItemFingerprint>();

		for (const item of localItems) {
			const fingerprint = this.generateItemFingerprint(item);
			fingerprintMap.set(item.id, fingerprint);
		}

		return fingerprintMap;
	}

	generateItemFingerprint(item: any): CloudItemFingerprint {
		const contentChecksum = calculateContentChecksum(item);
		const favoriteAwareChecksum = calculateFavoriteAwareChecksum(item);

		let size: number;
		if (item.type === "image" || item.type === "files") {
			const coreValue = extractFileCoreValue(item);
			size = coreValue.length;
		} else {
			size = JSON.stringify(item).length;
		}

		return {
			id: item.id,
			type: item.type,
			checksum: contentChecksum,
			favoriteChecksum: item.favorite ? favoriteAwareChecksum : undefined,
			size,
			timestamp: item.lastModified || Date.now(),
			favorite: !!item.favorite,
			deleted: item.deleted || false,
			note: item.note || "",
		};
	}

	detectSyncDifferences(
		localItems: any[],
		remoteIndex: CloudSyncIndex | null,
		deletedItemIds: string[] = [],
	): SyncDiffResult {
		if (!remoteIndex) {
			return {
				added: localItems.map((item) => this.generateItemFingerprint(item)),
				modified: [],
				favoriteChanged: [],
				deleted: deletedItemIds,
				toDownload: [],
				unchanged: [],
				statistics: {
					totalLocal: localItems.length,
					totalRemote: 0,
					conflicts: 0,
				},
			};
		}

		const localFingerprints = this.generateLocalFingerprints(localItems);
		const deletedSet = new Set(deletedItemIds);

		return detectDiff(localFingerprints, remoteIndex, deletedSet);
	}

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

	private isValidIndexFormat(index: any): index is CloudSyncIndex {
		return (
			index &&
			index.format === "unified" &&
			Array.isArray(index.items) &&
			typeof index.timestamp === "number" &&
			typeof index.deviceId === "string"
		);
	}

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

		return calculateStringChecksum(JSON.stringify(checksumData));
	}

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

	clearCache(): void {
		this.cachedIndex = null;
		this.indexCacheTime = 0;
	}
}

class FileSyncManager {
	private webdavConfig: WebDAVConfig | null = null;
	private syncModeConfig: SyncModeConfig | null = null;

	setWebDAVConfig(config: WebDAVConfig): void {
		this.webdavConfig = config;
		filePackageManager.setWebDAVConfig(config);
	}

	setSyncModeConfig(config: SyncModeConfig | null): void {
		this.syncModeConfig = config;
		filePackageManager.setSyncModeConfig(config);
	}

	async processFileSyncItem(item: SyncItem): Promise<SyncItem | null> {
		if (!this.isFileItem(item) || !this.webdavConfig) {
			return item;
		}

		try {
			if (item.type === "image") {
				return await this.processImageItem(item);
			}
			if (item.type === "files") {
				return await this.processFilesItem(item);
			}
		} catch {}

		return item;
	}

	private isFileItem(item: SyncItem): boolean {
		return item.type === "image" || item.type === "files";
	}

	private async processImageItem(item: SyncItem): Promise<SyncItem | null> {
		try {
			if (item._syncType === "package_files") {
				return item;
			}

			let imagePath = item.value;

			if (typeof imagePath === "string" && imagePath.startsWith("{")) {
				try {
					const parsed = JSON.parse(imagePath);
					if (parsed.packageId && parsed.originalPaths) {
						return {
							...item,
							_syncType: "package_files",
						};
					}
				} catch {}

				try {
					const parsed = JSON.parse(imagePath);
					if (
						parsed.originalPaths &&
						Array.isArray(parsed.originalPaths) &&
						parsed.originalPaths.length > 0
					) {
						const recoveredPath = parsed.originalPaths[0];
						if (typeof recoveredPath === "string" && recoveredPath.length > 0) {
							return {
								...item,
								value: recoveredPath,
								_syncType: undefined,
							};
						}
					}
				} catch {}

				return item;
			}

			if (typeof imagePath === "string" && imagePath.startsWith("[")) {
				try {
					const parsed = JSON.parse(imagePath);
					if (Array.isArray(parsed) && parsed.length > 0) {
						const validPath = parsed.find(
							(pathItem: any) =>
								typeof pathItem === "string" &&
								(pathItem.includes(":") ||
									pathItem.includes("/") ||
									pathItem.includes("\\")),
						);

						if (validPath) {
							imagePath = validPath;
						} else {
							imagePath = parsed[0];
						}
					}
				} catch {}
			}

			if (typeof imagePath !== "string") {
				return item;
			}

			if (
				imagePath.includes('{"') ||
				imagePath.includes('"}') ||
				imagePath.includes("packageId")
			) {
				return item;
			}

			const maxSize = this.syncModeConfig?.fileLimits?.maxImageSize || 5;
			const fileSize = await this.getFileSize(imagePath);

			if (fileSize > maxSize * 1024 * 1024) {
				return item;
			}

			const paths = Array.isArray(imagePath) ? imagePath : [imagePath];

			const packageInfo = await filePackageManager.smartUploadPackage(
				item.id,
				item.type,
				paths,
				this.webdavConfig!,
			);

			if (packageInfo) {
				return {
					...item,
					value: JSON.stringify(packageInfo),
					_syncType: "package_files",
					fileSize: packageInfo.size,
					fileType: "image",
				};
			}
		} catch {}

		return item;
	}

	private async processFilesItem(item: SyncItem): Promise<SyncItem | null> {
		try {
			if (item._syncType === "package_files") {
				return item;
			}

			let filePaths: string[];
			try {
				const parsedValue = JSON.parse(item.value);

				if (!Array.isArray(parsedValue)) {
					if (typeof parsedValue === "object" && parsedValue !== null) {
						if (
							parsedValue.originalPaths &&
							Array.isArray(parsedValue.originalPaths)
						) {
							filePaths = parsedValue.originalPaths.filter(
								(path: any) => typeof path === "string",
							);
						} else if (parsedValue.paths && Array.isArray(parsedValue.paths)) {
							filePaths = parsedValue.paths.filter(
								(path: any) => typeof path === "string",
							);
						} else if (
							parsedValue.path &&
							typeof parsedValue.path === "string"
						) {
							filePaths = [parsedValue.path];
						} else if (
							parsedValue.fileName &&
							typeof parsedValue.fileName === "string"
						) {
							filePaths = [parsedValue.fileName];
						} else {
							return item;
						}
					} else {
						return item;
					}
				} else {
					filePaths = parsedValue.filter((path) => typeof path === "string");
				}

				if (filePaths.length === 0) {
					return item;
				}
			} catch {
				return item;
			}

			const maxSize = this.syncModeConfig?.fileLimits?.maxFileSize || 10;
			const validPaths: string[] = [];

			for (const filePath of filePaths) {
				try {
					const fileSize = await this.getFileSize(filePath);
					if (fileSize <= maxSize * 1024 * 1024) {
						validPaths.push(filePath);
					}
				} catch {}
			}

			if (validPaths.length === 0) {
				return item;
			}

			try {
				const packageInfo = await filePackageManager.smartUploadPackage(
					item.id,
					item.type,
					validPaths,
					this.webdavConfig!,
				);

				if (packageInfo) {
					return {
						...item,
						value: JSON.stringify(packageInfo),
						_syncType: "package_files",
						fileSize: packageInfo.size,
						fileType: "files",
					};
				}

				return item;
			} catch {
				return item;
			}
		} catch {}

		return item;
	}

	private async getFileSize(filePath: string): Promise<number> {
		try {
			const { lstat } = await import("@tauri-apps/plugin-fs");
			const stat = await lstat(filePath);
			return stat.size || 0;
		} catch {
			return 0;
		}
	}

	async syncRemoteFiles(items: SyncItem[]): Promise<void> {
		const packageItems = items.filter(
			(item) => item._syncType === "package_files" && this.isFileItem(item),
		);

		if (packageItems.length === 0 || !this.webdavConfig) {
			return;
		}

		const MAX_CONCURRENT_SYNC = 3;
		const syncPromises: Promise<void>[] = [];

		for (let i = 0; i < packageItems.length; i++) {
			const item = packageItems[i];

			let packageInfo: any;
			try {
				packageInfo = JSON.parse(item.value);
			} catch {
				continue;
			}

			const syncPromise = (async () => {
				try {
					await filePackageManager.syncFilesIntelligently(
						packageInfo,
						this.webdavConfig!,
					);
				} catch {}
			})();

			syncPromises.push(syncPromise);

			if (syncPromises.length >= MAX_CONCURRENT_SYNC) {
				await Promise.race(syncPromises);

				for (let j = syncPromises.length - 1; j >= 0; j--) {
					if (
						await syncPromises[j].then(
							() => true,
							() => true,
						)
					) {
						syncPromises.splice(j, 1);
					}
				}
			}
		}
		await Promise.allSettled(syncPromises);
	}
}

class ConflictResolver {
	resolveConflicts(conflicts: ConflictInfo[]): ConflictInfo[] {
		return conflicts.map((conflict) => this.resolveConflict(conflict));
	}

	private resolveConflict(conflict: ConflictInfo): ConflictInfo {
		switch (conflict.type) {
			case "modify":
				return this.resolveModifyConflict(conflict);
			case "delete":
				return this.resolveDeleteConflict(conflict);
			case "create":
				return this.resolveCreateConflict(conflict);
			default:
				return conflict;
		}
	}

	private resolveModifyConflict(conflict: ConflictInfo): ConflictInfo {
		const localTime = new Date(conflict.localVersion.createTime).getTime();
		const remoteTime = new Date(conflict.remoteVersion.createTime).getTime();

		if (remoteTime > localTime) {
			return { ...conflict, resolution: "remote", reason: "远程版本较新" };
		}
		if (localTime > remoteTime) {
			return { ...conflict, resolution: "local", reason: "本地版本较新" };
		}

		return {
			...conflict,
			resolution: "local",
			reason: "时间戳相同，保留本地版本",
		};
	}

	private resolveDeleteConflict(conflict: ConflictInfo): ConflictInfo {
		return {
			...conflict,
			resolution: "local",
			reason: "删除冲突，保留本地数据",
		};
	}

	private resolveCreateConflict(conflict: ConflictInfo): ConflictInfo {
		return {
			...conflict,
			resolution: "remote",
			reason: "创建冲突，使用远程版本",
		};
	}
}

export class SyncEngine {
	private webdavConfig: WebDAVConfig | null = null;
	private deviceId: string = generateDeviceId();
	private isOnline = false;
	private lastSyncTime = 0;
	private syncModeConfig: SyncModeConfig | null = null;
	private isInitialized = false;

	private cloudManager: UnifiedCloudDataManager;
	private fileSyncManager: FileSyncManager;
	private conflictResolver: ConflictResolver;

	private syncInProgress = false;

	private isTransitioningToFavoriteMode = false;
	private isTransitioningFromFavoriteMode = false;

	constructor() {
		this.deviceId = generateDeviceId();
		this.cloudManager = new UnifiedCloudDataManager(this.deviceId);
		this.fileSyncManager = new FileSyncManager();
		this.conflictResolver = new ConflictResolver();
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
		this.cloudManager.setWebDAVConfig(config);
		this.fileSyncManager.setWebDAVConfig(config);
		this.fileSyncManager.setSyncModeConfig(this.syncModeConfig);

		const index = await this.cloudManager.downloadSyncIndex();
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
		this.fileSyncManager.setSyncModeConfig(config);

		if (fileModeChanged || favoriteModeChanged) {
			this.clearCache();
			this.cloudManager.clearCache();
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

			const remoteIndex = await this.cloudManager.downloadSyncIndex();

			const diffResult = this.cloudManager.detectSyncDifferences(
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
			this.conflictResolver.resolveConflicts(conflicts);
		}

		await this.updateLocalData(mergedData);
		await this.fileSyncManager.syncRemoteFiles(mergedData);

		return itemsToProcess.length;
	}

	private async uploadLocalItems(
		itemsToUpload: CloudItemFingerprint[],
		deletedItems: string[],
	): Promise<number> {
		// 从数据库获取完整的本地数据
		const localRawData = await getHistoryData(false);
		const fullLocalItems = localRawData.filter((item) =>
			itemsToUpload.some((fp) => fp.id === item.id),
		);

		const fullLocalData = await this.convertToSyncItems(fullLocalItems);

		const processedData = await this.processFileItems(fullLocalData);

		const syncData: SyncData = {
			timestamp: Date.now(),
			deviceId: this.deviceId,
			dataType: "incremental",
			items: processedData,
			deleted: deletedItems,
			compression: "none",
			checksum: calculateStringChecksum(JSON.stringify(processedData)),
		};

		const uploadSuccess = await this.uploadSyncData(syncData);

		if (uploadSuccess) {
			if (deletedItems.length > 0) {
				await this.deleteRemoteFiles(deletedItems);
			}
			return processedData.length;
		}

		return 0;
	}

	private async updateRemoteIndex(_deletedItems: string[]): Promise<void> {
		const currentIndex = await this.cloudManager.downloadSyncIndex();
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

		const updatedIndex = this.cloudManager.updateIndexWithLocalChanges(
			currentIndex || this.createEmptyIndex(),
			currentLocalData,
			_deletedItems,
		);

		await this.cloudManager.uploadSyncIndex(updatedIndex);
	}

	private createEmptyIndex(): CloudSyncIndex {
		return {
			format: "unified",
			timestamp: Date.now(),
			deviceId: this.deviceId,
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
						await this.fileSyncManager.processFileSyncItem(syncItem);

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
					const processed =
						await this.fileSyncManager.processFileSyncItem(item);
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

		const deleteResults = await filePackageManager.deleteRemotePackages(
			filePackagesToDelete,
			this.webdavConfig,
		);

		return deleteResults;
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
		this.cloudManager.clearCache();
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
