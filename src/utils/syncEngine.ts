import { LISTEN_KEY } from "@/constants";
import { getHistoryData, selectSQL, updateSQL } from "@/database";
import {
	type WebDAVConfig,
	downloadSyncData,
	uploadSyncData,
} from "@/plugins/webdav";
import type {
	ConflictInfo,
	SyncData,
	SyncItem,
	SyncMetadata,
	SyncModeConfig,
	SyncResult,
} from "@/types/sync";
import { filePackageManager } from "@/utils/filePackageManager";
import {
	calculateChecksum as calculateStringChecksum,
	generateDeviceId,
} from "@/utils/shared";
import { getGlobalSyncErrorTracker } from "@/utils/syncErrorTracker";
import { emit } from "@tauri-apps/api/event";

/**
 * 提取文件项的核心内容用于校验和计算
 */
function extractFileCoreValue(item: any): string {
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

	// 默认情况：直接使用value
	return typeof item.value === "string"
		? item.value
		: JSON.stringify(item.value);
}

/**
 * 统一的校验和计算函数
 */
export function calculateUnifiedChecksum(
	item: any,
	includeMetadata = false,
	includeFavorite = true,
): string {
	const coreFields: any = {
		id: item.id,
		type: item.type,
	};

	// 对于文件类型，使用核心内容而不是格式化字符串
	if (item.type === "image" || item.type === "files") {
		const coreValue = extractFileCoreValue(item);
		coreFields.value = coreValue;
	} else {
		// 其他类型保持原有逻辑
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
	const checksum = calculateStringChecksum(checksumSource);

	return checksum;
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

interface DataFingerprint {
	id: string;
	checksum: string;
	timestamp: number;
	size: number;
	type: string;
}

interface SyncStatistics {
	totalItems: number;
	addedItems: number;
	modifiedItems: number;
	deletedItems: number;
	skippedItems: number;
	conflictItems: number;
	uploadSize: number;
	downloadSize: number;
	duration: number;
}

/**
 * 元数据管理器
 */
class MetadataManager {
	private webdavConfig: WebDAVConfig | null = null;
	private metadataCache: SyncMetadata | null = null;
	private fingerprintCache: Map<string, DataFingerprint> = new Map();

	constructor(deviceId: string) {
		void deviceId;
	}

	setWebDAVConfig(config: WebDAVConfig): void {
		this.webdavConfig = config;
	}

	private getMetadataFilePath(): string {
		if (!this.webdavConfig) return "/metadata.json";
		const basePath = this.webdavConfig.path.startsWith("/")
			? this.webdavConfig.path
			: `/${this.webdavConfig.path}`;
		return `${basePath}/metadata.json`;
	}

	private getFingerprintFilePath(): string {
		if (!this.webdavConfig) return "/fingerprints.json";
		const basePath = this.webdavConfig.path.startsWith("/")
			? this.webdavConfig.path
			: `/${this.webdavConfig.path}`;
		return `${basePath}/fingerprints.json`;
	}

	async downloadMetadata(): Promise<SyncMetadata | null> {
		if (!this.webdavConfig) return null;

		try {
			const filePath = this.getMetadataFilePath();
			const result = await downloadSyncData(this.webdavConfig, filePath);

			if (result.success && result.data) {
				const metadata = JSON.parse(result.data) as SyncMetadata;
				this.metadataCache = metadata;
				return metadata;
			}
		} catch {
			// 下载元数据失败
		}

		return null;
	}

	async uploadMetadata(metadata: SyncMetadata): Promise<boolean> {
		if (!this.webdavConfig) return false;

		try {
			const filePath = this.getMetadataFilePath();
			const result = await uploadSyncData(
				this.webdavConfig,
				filePath,
				JSON.stringify(metadata, null, 2),
			);

			if (result.success) {
				this.metadataCache = metadata;
				return true;
			}
		} catch {
			// 上传元数据失败
		}

		return false;
	}

	async downloadFingerprints(): Promise<Map<string, DataFingerprint>> {
		if (!this.webdavConfig) return new Map();

		try {
			const filePath = this.getFingerprintFilePath();
			const result = await downloadSyncData(this.webdavConfig, filePath);

			if (result.success && result.data) {
				const fingerprintData = JSON.parse(result.data);
				const fingerprintMap = new Map<string, DataFingerprint>();

				for (const fp of fingerprintData) {
					fingerprintMap.set(fp.id, fp);
				}

				this.fingerprintCache = fingerprintMap;
				return fingerprintMap;
			}
		} catch {
			// 下载指纹数据失败
		}

		return new Map();
	}

	async uploadFingerprints(
		fingerprints: Map<string, DataFingerprint>,
	): Promise<boolean> {
		if (!this.webdavConfig) return false;

		try {
			const filePath = this.getFingerprintFilePath();
			const fingerprintArray = Array.from(fingerprints.values());
			const result = await uploadSyncData(
				this.webdavConfig,
				filePath,
				JSON.stringify(fingerprintArray, null, 2),
			);

			if (result.success) {
				this.fingerprintCache = fingerprints;
				return true;
			}
		} catch {
			// 上传指纹数据失败
		}

		return false;
	}

	generateFingerprint(item: SyncItem): DataFingerprint {
		const checksum = calculateContentChecksum(item);

		let size: number;
		if (item.type === "image" || item.type === "files") {
			// 使用核心内容计算大小，确保与校验和计算一致
			const coreValue = extractFileCoreValue(item);
			size = coreValue.length;
		} else {
			// 其他类型保持原有逻辑
			size = JSON.stringify(item).length;
		}

		return {
			id: item.id,
			checksum,
			timestamp: item.lastModified || Date.now(),
			size,
			type: item.type,
		};
	}

	generateFavoriteAwareFingerprint(item: SyncItem): DataFingerprint {
		const checksum = calculateFavoriteAwareChecksum(item);

		let size: number;
		if (item.type === "image" || item.type === "files") {
			// 使用核心内容计算大小，确保与校验和计算一致
			const coreValue = extractFileCoreValue(item);
			size = coreValue.length;
		} else {
			// 其他类型保持原有逻辑
			size = JSON.stringify(item).length;
		}

		return {
			id: item.id,
			checksum,
			timestamp: item.lastModified || Date.now(),
			size,
			type: item.type,
		};
	}

	compareFingerprints(
		local: Map<string, DataFingerprint>,
		remote: Map<string, DataFingerprint>,
		deletedItemIds: string[] = [],
		localDataItems?: any[],
	): {
		added: DataFingerprint[];
		modified: DataFingerprint[];
		unchanged: string[];
		favoriteChanged: string[];
	} {
		const added: DataFingerprint[] = [];
		const modified: DataFingerprint[] = [];
		const unchanged: string[] = [];
		const favoriteChanged: string[] = [];
		const deletedSet = new Set(deletedItemIds);

		const localDataMap = new Map<string, any>();
		if (localDataItems) {
			for (const item of localDataItems) {
				localDataMap.set(item.id, item);
			}
		}

		// 开始比较本地和远程数据

		for (const [id, localFp] of local) {
			if (deletedSet.has(id)) {
				continue;
			}

			const remoteFp = remote.get(id);
			if (!remoteFp) {
				if (localFp.checksum && localFp.checksum.length > 0) {
					added.push(localFp);
				}
			} else {
				if (localFp.checksum !== remoteFp.checksum) {
					const localDataItem = localDataMap.get(id);

					// 校验和不匹配，需要处理

					if (
						localDataItem &&
						this.isChecksumDifferenceOnlyDueToFavorite(
							localDataItem,
							localFp,
							remoteFp,
						)
					) {
						favoriteChanged.push(id);
					} else {
						modified.push(localFp);
					}
				} else {
					unchanged.push(id);
				}
			}
		}

		return { added, modified, unchanged, favoriteChanged };
	}

	private isChecksumDifferenceOnlyDueToFavorite(
		localDataItem: any,
		localFp: DataFingerprint,
		remoteFp: DataFingerprint,
	): boolean {
		if (!localDataItem) {
			return false;
		}

		const contentChecksum = calculateContentChecksum(localDataItem);
		const favoriteAwareChecksum = calculateFavoriteAwareChecksum(localDataItem);

		if (
			(remoteFp.checksum === contentChecksum &&
				localFp.checksum !== contentChecksum) ||
			(localFp.checksum === contentChecksum &&
				remoteFp.checksum !== contentChecksum) ||
			(localFp.checksum === favoriteAwareChecksum &&
				remoteFp.checksum === contentChecksum) ||
			(localFp.checksum === contentChecksum &&
				remoteFp.checksum === favoriteAwareChecksum)
		) {
			return true;
		}

		return false;
	}

	compareFavoriteAwareFingerprints(
		local: Map<string, DataFingerprint>,
		remote: Map<string, DataFingerprint>,
		deletedItemIds: string[] = [],
		localDataItems?: any[],
	): {
		added: DataFingerprint[];
		modified: DataFingerprint[];
		unchanged: string[];
		favoriteChanged: string[];
	} {
		return this.compareFingerprints(
			local,
			remote,
			deletedItemIds,
			localDataItems,
		);
	}

	getCachedMetadata(): SyncMetadata | null {
		return this.metadataCache;
	}

	getCachedFingerprints(): Map<string, DataFingerprint> {
		return this.fingerprintCache;
	}

	clearFingerprintCache(): void {
		this.fingerprintCache.clear();
	}
}

/**
 * 增量同步管理器 - 负责处理增量同步逻辑
 */
class IncrementalSyncManager {
	private metadataManager: MetadataManager;
	private deviceId: string;
	private syncEngine: SyncEngineV2;

	constructor(
		metadataManager: MetadataManager,
		deviceId: string,
		syncEngine: SyncEngineV2,
	) {
		this.metadataManager = metadataManager;
		this.deviceId = deviceId;
		this.syncEngine = syncEngine;
	}

	/**
	 * 执行增量同步
	 */
	async performIncrementalSync(
		localData: SyncItem[],
		syncModeConfig: SyncModeConfig | null,
	): Promise<{
		syncData: SyncData;
		statistics: SyncStatistics;
	}> {
		const startTime = Date.now();

		const statistics: SyncStatistics = {
			totalItems: localData.length,
			addedItems: 0,
			modifiedItems: 0,
			deletedItems: 0,
			skippedItems: 0,
			conflictItems: 0,
			uploadSize: 0,
			downloadSize: 0,
			duration: 0,
		};

		// 1. 生成本地指纹
		const localFingerprints = new Map<string, DataFingerprint>();
		for (const item of localData) {
			localFingerprints.set(
				item.id,
				this.metadataManager.generateFingerprint(item),
			);
		}

		// 2. 下载远程指纹
		let remoteFingerprints = await this.metadataManager.downloadFingerprints();
		if (remoteFingerprints.size === 0) {
			// 尝试从缓存获取
			const cachedFingerprints = this.metadataManager.getCachedFingerprints();
			if (cachedFingerprints.size > 0) {
				remoteFingerprints = new Map(cachedFingerprints);
			} else {
				// 尝试从远程数据重建指纹
				const remoteData = await this.syncEngine.downloadRemoteData();
				if (remoteData?.items?.length) {
					remoteFingerprints =
						await this.rebuildFingerprintsFromRemoteData(remoteData);
					if (remoteFingerprints.size > 0) {
						await this.metadataManager.uploadFingerprints(remoteFingerprints);
					}
				}
			}
		}

		// 3. 检测本地删除操作
		const localDeletions = this.syncEngine.detectLocalDeletions(localData);

		// 4. 比较差异
		const diff = this.metadataManager.compareFingerprints(
			localFingerprints,
			remoteFingerprints,
			localDeletions,
		);
		statistics.addedItems = diff.added.length;
		statistics.modifiedItems = diff.modified.length;
		statistics.skippedItems = diff.unchanged.length;

		// 5. 筛选需要同步的项
		const itemsToSync: SyncItem[] = [];
		const deletedIds: string[] = [];

		// 添加新增和修改的项
		for (const fp of [...diff.added, ...diff.modified]) {
			const item = localData.find((i) => i.id === fp.id);
			if (item) {
				const isFavoriteChange =
					diff.favoriteChanged?.includes(item.id) || false;

				if (this.shouldSyncItem(item, syncModeConfig, isFavoriteChange)) {
					itemsToSync.push(item);
				}
			}
		}

		// 添加删除项
		for (const deletedId of localDeletions) {
			if (!deletedIds.includes(deletedId)) {
				deletedIds.push(deletedId);
			}
		}

		statistics.deletedItems = localDeletions.length;

		// 6. 创建同步数据
		const syncData: SyncData = {
			version: 2,
			timestamp: Date.now(),
			deviceId: this.deviceId,
			dataType: "incremental",
			items: itemsToSync,
			deleted: deletedIds,
			compression: "none",
			checksum: calculateStringChecksum(JSON.stringify(itemsToSync)),
		};

		// 7. 更新统计信息
		statistics.uploadSize = JSON.stringify(syncData).length;
		statistics.duration = Date.now() - startTime;

		return { syncData, statistics };
	}

	/**
	 * 判断是否应该同步该项
	 */
	private shouldSyncItem(
		item: SyncItem,
		syncModeConfig: SyncModeConfig | null,
		allowFavoriteChanges = false,
	): boolean {
		if (!syncModeConfig?.settings) return true;

		const settings = syncModeConfig.settings;

		// 收藏模式检查
		if (settings.onlyFavorites && !item.favorite) {
			// 如果是收藏状态变更，则允许同步
			return allowFavoriteChanges;
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
	}

	/**
	 * 包模式数据识别逻辑
	 */
	private identifyPackageItem(item: any): boolean {
		if (item.type !== "image" && item.type !== "files") {
			return false;
		}

		if (item._syncType === "package_files") {
			return true;
		}

		if (typeof item.value === "string") {
			try {
				const parsedValue = JSON.parse(item.value);
				if (
					parsedValue &&
					typeof parsedValue === "object" &&
					parsedValue.packageId &&
					parsedValue.originalPaths &&
					Array.isArray(parsedValue.originalPaths)
				) {
					return true;
				}
			} catch {
				// JSON解析失败
			}
		}

		if (
			item.value &&
			typeof item.value === "string" &&
			(item.value.includes("packageId") ||
				item.value.includes("originalPaths") ||
				item.value.includes("fileName"))
		) {
			return true;
		}

		// 改进：同时检查fileSize和checksum的存在性，更准确地识别文件包
		if (
			item.fileSize &&
			typeof item.fileSize === "number" &&
			item.fileSize > 0 &&
			item.checksum &&
			typeof item.checksum === "string" &&
			item.checksum.length > 0
		) {
			return true;
		}

		if (item.deviceId && item.deviceId !== this.deviceId) {
			return true;
		}

		return false;
	}

	/**
	 * 数据完整性检查
	 */
	private performDataIntegrityCheck(
		remoteData: SyncData,
		localData: SyncItem[],
	): { isComplete: boolean; issues: string[] } {
		const issues: string[] = [];

		if (!remoteData.items || remoteData.items.length === 0) {
			issues.push("远程数据项为空");
		}

		for (const item of remoteData.items) {
			if (!item.id) {
				issues.push(
					`发现缺少ID的远程数据项: ${JSON.stringify(item).substring(0, 100)}`,
				);
			}
			if (!item.type) {
				issues.push(`项 ${item.id} 缺少类型字段`);
			}
			if (item.value === undefined || item.value === null) {
				issues.push(`项 ${item.id} 缺少value字段`);
			}
		}

		const packageItems = remoteData.items.filter(
			(item) =>
				(item.type === "image" || item.type === "files") &&
				this.identifyPackageItem(item),
		);

		for (const packageItem of packageItems) {
			try {
				if (typeof packageItem.value === "string") {
					const parsedValue = JSON.parse(packageItem.value);
					if (!parsedValue.packageId) {
						issues.push(`包模式项 ${packageItem.id} 缺少packageId`);
					}
					if (
						!parsedValue.originalPaths ||
						!Array.isArray(parsedValue.originalPaths)
					) {
						issues.push(`包模式项 ${packageItem.id} 缺少originalPaths数组`);
					}
				}
			} catch (error) {
				issues.push(
					`包模式项 ${packageItem.id} 的value字段无法解析: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		const localIds = new Set(localData.map((item) => item.id));
		const remoteIds = new Set(remoteData.items.map((item) => item.id));
		const conflictingIds = [...localIds].filter((id) => remoteIds.has(id));

		if (conflictingIds.length > 0) {
			issues.push(
				`发现 ${conflictingIds.length} 个ID冲突: ${conflictingIds.join(", ")}`,
			);
		}

		return {
			isComplete: issues.length === 0,
			issues,
		};
	}

	/**
	 * 尝试数据恢复
	 */
	private async attemptDataRecovery(
		remoteData: SyncData,
		localData: SyncItem[],
		_integrityCheck: { isComplete: boolean; issues: string[] },
	): Promise<void> {
		for (let i = 0; i < remoteData.items.length; i++) {
			const item = remoteData.items[i];

			if (!item.id) {
				item.id = `recovered_${Date.now()}_${i}`;
			}

			if (!item.type) {
				if (typeof item.value === "string") {
					if (item.value.startsWith("http") || item.value.includes(".")) {
						item.type = "image";
					} else if (item.value.startsWith("[")) {
						item.type = "files";
					} else {
						item.type = "text";
					}
				} else {
					item.type = "text";
				}
			}

			if (item.value === undefined || item.value === null) {
				item.value = "";
			}
		}

		const packageItems = remoteData.items.filter(
			(item) =>
				(item.type === "image" || item.type === "files") &&
				this.identifyPackageItem(item),
		);

		for (const packageItem of packageItems) {
			try {
				if (typeof packageItem.value === "string") {
					const parsedValue = JSON.parse(packageItem.value);

					if (!parsedValue.packageId) {
						parsedValue.packageId = packageItem.id;
					}

					if (
						!parsedValue.originalPaths ||
						!Array.isArray(parsedValue.originalPaths)
					) {
						parsedValue.originalPaths = [];
					}

					packageItem.value = JSON.stringify(parsedValue);
				}
			} catch {
				// 包模式项修复失败
			}
		}

		const localMap = new Map(localData.map((item) => [item.id, item]));
		for (const remoteItem of remoteData.items) {
			const localItem = localMap.get(remoteItem.id);
			if (localItem && !remoteItem.value) {
				remoteItem.value = localItem.value;
			}
		}
	}

	/**
	 * 最终数据完整性检查
	 */
	private performFinalDataIntegrityCheck(
		mergedData: SyncItem[],
		remoteData: SyncData,
	): { isComplete: boolean; issues: string[] } {
		const issues: string[] = [];

		const mergedIds = new Set(mergedData.map((item) => item.id));
		const remoteIds = new Set(remoteData.items.map((item) => item.id));

		const missingRemoteItems = [...remoteIds].filter(
			(id) => !mergedIds.has(id),
		);
		if (missingRemoteItems.length > 0) {
			issues.push(
				`合并后数据缺少 ${missingRemoteItems.length} 个远程项: ${missingRemoteItems.join(", ")}`,
			);
		}

		for (const item of mergedData) {
			if (!item.id) {
				issues.push("合并后数据中发现缺少ID的项");
			}
			if (!item.type) {
				issues.push(`项 ${item.id} 缺少类型字段`);
			}
			if (item.value === undefined || item.value === null) {
				issues.push(`项 ${item.id} 缺少value字段`);
			}
		}

		const packageItems = mergedData.filter(
			(item) => item.type === "image" || item.type === "files",
		);

		for (const packageItem of packageItems) {
			if (packageItem._syncType) {
				issues.push(
					`包模式项 ${packageItem.id} 仍包含_syncType字段，可能未正确解包`,
				);
			}

			if (typeof packageItem.value === "string") {
				if (
					packageItem.type === "image" &&
					!packageItem.value.startsWith("[")
				) {
					if (
						!packageItem.value.includes("/") &&
						!packageItem.value.includes("\\")
					) {
						issues.push(
							`图片项 ${packageItem.id} 的value可能不是有效路径: ${packageItem.value}`,
						);
					}
				}

				if (
					packageItem.type === "files" ||
					(packageItem.type === "image" && packageItem.value.startsWith("["))
				) {
					try {
						const parsedValue = JSON.parse(packageItem.value);
						if (!Array.isArray(parsedValue)) {
							issues.push(
								`文件项 ${packageItem.id} 的value不是有效数组: ${packageItem.value}`,
							);
						}
					} catch (error) {
						issues.push(
							`文件项 ${packageItem.id} 的value无法解析为JSON: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
			}
		}

		return {
			isComplete: issues.length === 0,
			issues,
		};
	}

	/**
	 * 合并远程增量数据
	 */
	async mergeRemoteIncrementalData(
		remoteData: SyncData,
		localData: SyncItem[],
	): Promise<{
		mergedData: SyncItem[];
		conflicts: ConflictInfo[];
	}> {
		const conflicts: ConflictInfo[] = [];
		const localMap = new Map(localData.map((item) => [item.id, item]));
		const mergedData: SyncItem[] = [];

		const integrityCheck = this.performDataIntegrityCheck(
			remoteData,
			localData,
		);

		if (!integrityCheck.isComplete) {
			await this.attemptDataRecovery(remoteData, localData, integrityCheck);
		}

		const favoriteChanges = this.detectFavoriteChanges(remoteData, localData);

		const deletedIds = remoteData.deleted || [];
		for (const deletedId of deletedIds) {
			localMap.delete(deletedId);
		}

		const packageItems: any[] = [];
		const regularItems: any[] = [];
		const processedRemoteIds = new Set<string>();

		for (const remoteItem of remoteData.items) {
			const localItem = localMap.get(remoteItem.id);

			if (!localItem) {
				processedRemoteIds.add(remoteItem.id);
				const isPackageItem = this.identifyPackageItem(remoteItem);

				if (isPackageItem) {
					packageItems.push(remoteItem);
				} else {
					regularItems.push(remoteItem);
				}
			} else {
				const localTime = new Date(localItem.createTime).getTime();
				const remoteTime = new Date(remoteItem.createTime).getTime();

				const localFavorite = !!localItem.favorite;
				const remoteFavorite = !!remoteItem.favorite;

				if (localFavorite !== remoteFavorite) {
					let finalFavoriteState = localFavorite;

					if (this.syncEngine.checkTransitioningToFavoriteMode()) {
						finalFavoriteState = localFavorite;
					} else if (this.syncEngine.checkTransitioningFromFavoriteMode()) {
						finalFavoriteState = localFavorite;
					} else if (!localFavorite && remoteFavorite) {
						finalFavoriteState = false;
					} else if (localFavorite && !remoteFavorite) {
						finalFavoriteState = true;
					}

					const finalItem = {
						...localItem,
						favorite: finalFavoriteState,
					};

					mergedData.push(finalItem);
					continue;
				}

				let hasConflict = false;
				if (localItem.type === "image" || localItem.type === "files") {
					if (localItem.checksum !== remoteItem.checksum) {
						const localValueStr =
							typeof localItem.value === "string"
								? localItem.value
								: JSON.stringify(localItem.value);
						const remoteValueStr =
							typeof remoteItem.value === "string"
								? remoteItem.value
								: JSON.stringify(remoteItem.value);

						if (
							localItem._syncType === "package_files" &&
							remoteItem._syncType === "package_files"
						) {
							try {
								const localPackage = JSON.parse(localValueStr);
								const remotePackage = JSON.parse(remoteValueStr);

								if (
									localPackage.packageId === remotePackage.packageId &&
									localPackage.checksum === remotePackage.checksum
								) {
									mergedData.push(localItem);
									continue;
								}
							} catch {
								// 解析失败
							}
						}

						hasConflict = true;
					}
				} else {
					hasConflict = localItem.checksum !== remoteItem.checksum;
				}

				if (hasConflict) {
					let processedRemoteItem = remoteItem;

					const isPackageItem = this.identifyPackageItem(remoteItem);

					if (isPackageItem) {
						try {
							const unpackResult =
								await filePackageManager.unpackRemotePackageData(
									remoteItem,
									this.deviceId,
								);

							if (unpackResult.success && unpackResult.processedItem) {
								processedRemoteItem = unpackResult.processedItem;
							}
						} catch {
							// 解包失败
						}
					}

					const conflict: ConflictInfo = {
						itemId: remoteItem.id,
						type: "modify",
						localVersion: localItem,
						remoteVersion: processedRemoteItem,
						resolution: remoteTime > localTime ? "remote" : "local",
						reason: "内容冲突",
					};
					conflicts.push(conflict);

					if (localFavorite !== remoteFavorite) {
						mergedData.push(localItem);
					} else {
						if (remoteTime > localTime) {
							mergedData.push(processedRemoteItem);
						} else {
							mergedData.push(localItem);
						}
					}
				} else {
					mergedData.push(localItem);
				}
			}

			localMap.delete(remoteItem.id);
		}

		for (const remoteItem of remoteData.items) {
			if (!processedRemoteIds.has(remoteItem.id)) {
				const localItem = localMap.get(remoteItem.id);

				if (!localItem) {
					const isPackageItem = this.identifyPackageItem(remoteItem);

					if (isPackageItem) {
						packageItems.push(remoteItem);
					} else {
						regularItems.push(remoteItem);
					}
				}
			}
		}

		if (packageItems.length > 0) {
			for (const packageItem of packageItems) {
				try {
					const unpackResult = await filePackageManager.unpackRemotePackageData(
						packageItem,
						this.deviceId,
					);

					if (unpackResult && unpackResult !== packageItem) {
						mergedData.push(unpackResult);
					} else {
						mergedData.push(packageItem);
					}
				} catch {
					mergedData.push(packageItem);
				}
			}
		}

		if (regularItems.length > 0) {
			for (const regularItem of regularItems) {
				mergedData.push(regularItem);
			}
		}

		for (const localItem of localMap.values()) {
			mergedData.push(localItem);
		}

		const finalIntegrityCheck = this.performFinalDataIntegrityCheck(
			mergedData,
			remoteData,
		);

		if (!finalIntegrityCheck.isComplete) {
			// 静默处理完整性检查问题
		}

		this.processFavoriteChanges(favoriteChanges, mergedData);

		for (const change of favoriteChanges) {
			const mergedItem = mergedData.find((item) => item.id === change.itemId);
			if (mergedItem) {
				const favoriteAwareChecksum = calculateUnifiedChecksum(
					mergedItem,
					false,
					true,
				);
				mergedItem.checksum = favoriteAwareChecksum;
			}
		}

		return { mergedData, conflicts };
	}

	/**
	 * 检测收藏状态变化
	 */
	private detectFavoriteChanges(
		remoteData: SyncData,
		localData: SyncItem[],
	): Array<{
		itemId: string;
		localFavorite: boolean;
		remoteFavorite: boolean;
		changeType: "local_to_remote" | "remote_to_local" | "conflict";
	}> {
		const changes: Array<{
			itemId: string;
			localFavorite: boolean;
			remoteFavorite: boolean;
			changeType: "local_to_remote" | "remote_to_local" | "conflict";
		}> = [];

		const remoteMap = new Map(remoteData.items.map((item) => [item.id, item]));

		// 检查本地数据中的收藏状态变化
		for (const localItem of localData) {
			const remoteItem = remoteMap.get(localItem.id);
			if (remoteItem) {
				const localFavorite = !!localItem.favorite;
				const remoteFavorite = !!(remoteItem as any).favorite;

				if (localFavorite !== remoteFavorite) {
					// 优先保留本地收藏状态，特别是当本地取消收藏时
					let changeType: "local_to_remote" | "remote_to_local" | "conflict";

					// 特别处理本地取消收藏的情况
					if (!localFavorite && remoteFavorite) {
						// 本地未收藏，远程收藏 - 优先保留本地的未收藏状态
						changeType = "local_to_remote";
					} else if (localFavorite && !remoteFavorite) {
						// 本地收藏，远程未收藏 - 保持本地收藏状态
						changeType = "local_to_remote";
					} else {
						// 其他情况，检查时间戳
						const localTime = new Date(
							localItem.lastModified || localItem.createTime,
						).getTime();
						const remoteTime = new Date(
							(remoteItem as any).lastModified ||
								(remoteItem as any).createTime,
						).getTime();

						if (localTime > remoteTime) {
							changeType = "local_to_remote";
						} else if (remoteTime > localTime) {
							changeType = "remote_to_local";
						} else {
							changeType = "conflict";
						}
					}

					changes.push({
						itemId: localItem.id,
						localFavorite,
						remoteFavorite,
						changeType,
					});
				}
			}
		}

		return changes;
	}

	/**
	 * 处理收藏状态变化
	 */
	private processFavoriteChanges(
		favoriteChanges: Array<{
			itemId: string;
			localFavorite: boolean;
			remoteFavorite: boolean;
			changeType: "local_to_remote" | "remote_to_local" | "conflict";
		}>,
		mergedData: SyncItem[],
	): void {
		for (const change of favoriteChanges) {
			const mergedItem = mergedData.find((item) => item.id === change.itemId);
			if (mergedItem) {
				let finalFavoriteState: boolean;

				if (this.syncEngine.checkTransitioningToFavoriteMode()) {
					finalFavoriteState = change.localFavorite;
				} else if (this.syncEngine.checkTransitioningFromFavoriteMode()) {
					finalFavoriteState = change.localFavorite;
				} else {
					if (!change.localFavorite && change.remoteFavorite) {
						finalFavoriteState = false;
					} else if (change.localFavorite && !change.remoteFavorite) {
						finalFavoriteState = true;
					} else if (change.localFavorite && change.remoteFavorite) {
						finalFavoriteState = true;
					} else {
						finalFavoriteState = false;
					}
				}

				mergedItem.favorite = finalFavoriteState;
			}
		}
	}

	/**
	 * 从远程数据重建指纹数据
	 */
	private async rebuildFingerprintsFromRemoteData(
		remoteData: SyncData,
	): Promise<Map<string, DataFingerprint>> {
		const fingerprints = new Map<string, DataFingerprint>();

		if (!remoteData?.items?.length) {
			return fingerprints;
		}

		for (const item of remoteData.items) {
			try {
				const fingerprint = this.metadataManager.generateFingerprint(item);
				fingerprints.set(item.id, fingerprint);
			} catch {
				// 重建指纹失败
			}
		}

		return fingerprints;
	}
}

/**
 * 文件同步管理器 - 负责处理文件级别的同步
 */
class FileSyncManager {
	private webdavConfig: WebDAVConfig | null = null;
	private syncModeConfig: SyncModeConfig | null = null;

	/**
	 * 设置WebDAV配置
	 */
	setWebDAVConfig(config: WebDAVConfig): void {
		this.webdavConfig = config;
		filePackageManager.setWebDAVConfig(config);
	}

	/**
	 * 设置同步模式配置
	 */
	setSyncModeConfig(config: SyncModeConfig | null): void {
		this.syncModeConfig = config;
		filePackageManager.setSyncModeConfig(config);
	}

	/**
	 * 处理文件同步项
	 */
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

	/**
	 * 判断是否为文件项
	 */
	private isFileItem(item: SyncItem): boolean {
		return item.type === "image" || item.type === "files";
	}

	/**
	 * 处理图片项
	 */
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
				} catch {
					// JSON解析失败
				}

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
				} catch {
					// JSON解析失败
				}

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
				} catch {
					// JSON解析失败
				}
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
		} catch {
			// 处理图片项失败
		}

		return item;
	}

	/**
	 * 处理文件数组项
	 */
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
				} catch {
					// 获取文件大小失败
				}
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
		} catch {
			// 处理文件数组项失败
		}

		return item;
	}

	/**
	 * 获取文件大小
	 */
	private async getFileSize(filePath: string): Promise<number> {
		try {
			const { lstat } = await import("@tauri-apps/plugin-fs");
			const stat = await lstat(filePath);
			return stat.size || 0;
		} catch {
			return 0;
		}
	}

	/**
	 * 同步远程文件
	 */
	async syncRemoteFiles(items: SyncItem[]): Promise<void> {
		const packageItems = items.filter(
			(item) => item._syncType === "package_files" && this.isFileItem(item),
		);

		if (packageItems.length === 0 || !this.webdavConfig) {
			return;
		}

		const globalErrorTracker = getGlobalSyncErrorTracker();
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

			if (globalErrorTracker.hasFailedTooManyTimes(packageInfo.packageId)) {
				continue;
			}

			const syncPromise = (async () => {
				try {
					await filePackageManager.syncFilesIntelligently(
						packageInfo,
						this.webdavConfig!,
					);
				} catch (error) {
					if (packageInfo?.packageId) {
						const errorMsg = `同步远程文件失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`;
						globalErrorTracker.recordError(packageInfo.packageId, errorMsg);
					}
				}
			})();

			syncPromises.push(syncPromise);

			if (syncPromises.length >= MAX_CONCURRENT_SYNC) {
				await Promise.race(syncPromises);

				for (let j = syncPromises.length - 1; j >= 0; j--) {
					const promise = syncPromises[j];
					if (
						await promise.then(
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

enum ErrorType {
	NETWORK = "network",
	FILE_OPERATION = "file_operation",
	DATABASE = "database",
	PARSING = "parsing",
	VALIDATION = "validation",
	SYNC_CONFLICT = "sync_conflict",
	UNKNOWN = "unknown",
}

enum ErrorSeverity {
	FATAL = "fatal",
	NON_FATAL = "non_fatal",
	WARNING = "warning",
}

interface ErrorClassification {
	type: ErrorType;
	severity: ErrorSeverity;
	message: string;
	originalError: any;
}

/**
 * 高效同步引擎 V2
 */
export class SyncEngineV2 {
	private webdavConfig: WebDAVConfig | null = null;
	private deviceId: string = generateDeviceId();
	private isOnline = false;
	private lastSyncTime = 0;
	private syncModeConfig: SyncModeConfig | null = null;
	private isInitialized = false;

	// 核心组件
	private metadataManager: MetadataManager;
	private incrementalSyncManager: IncrementalSyncManager;
	private fileSyncManager: FileSyncManager;
	private conflictResolver: ConflictResolver;

	// 缓存和优化
	private syncInProgress = false;
	private lastRemoteData: SyncData | null = null;
	private lastRemoteDataTime = 0;
	private readonly REMOTE_DATA_TTL = 60 * 1000; // 60秒缓存

	// 删除检测相关
	private lastLocalSnapshot: Map<string, DataFingerprint> = new Map();

	// 收藏模式切换相关
	private isTransitioningToFavoriteMode = false;
	private isTransitioningFromFavoriteMode = false;

	private classifyError(error: any): ErrorClassification {
		const errorMessage = error instanceof Error ? error.message : String(error);

		if (
			errorMessage.includes("network") ||
			errorMessage.includes("connection") ||
			errorMessage.includes("timeout") ||
			errorMessage.includes("ECONNREFUSED") ||
			errorMessage.includes("ENOTFOUND")
		) {
			return {
				type: ErrorType.NETWORK,
				severity: ErrorSeverity.NON_FATAL,
				message: `网络错误: ${errorMessage}`,
				originalError: error,
			};
		}

		if (
			errorMessage.includes("file") ||
			errorMessage.includes("path") ||
			errorMessage.includes("directory") ||
			errorMessage.includes("ENOENT") ||
			errorMessage.includes("EACCES")
		) {
			return {
				type: ErrorType.FILE_OPERATION,
				severity: ErrorSeverity.NON_FATAL,
				message: `文件操作错误: ${errorMessage}`,
				originalError: error,
			};
		}

		if (
			errorMessage.includes("database") ||
			errorMessage.includes("sql") ||
			errorMessage.includes("query") ||
			errorMessage.includes("transaction")
		) {
			return {
				type: ErrorType.DATABASE,
				severity: ErrorSeverity.NON_FATAL,
				message: `数据库错误: ${errorMessage}`,
				originalError: error,
			};
		}

		if (
			errorMessage.includes("parse") ||
			errorMessage.includes("json") ||
			errorMessage.includes("syntax") ||
			errorMessage.includes("invalid format")
		) {
			return {
				type: ErrorType.PARSING,
				severity: ErrorSeverity.WARNING,
				message: `数据解析错误: ${errorMessage}`,
				originalError: error,
			};
		}

		if (
			errorMessage.includes("validation") ||
			errorMessage.includes("invalid") ||
			errorMessage.includes("missing") ||
			errorMessage.includes("required")
		) {
			return {
				type: ErrorType.VALIDATION,
				severity: ErrorSeverity.WARNING,
				message: `数据验证错误: ${errorMessage}`,
				originalError: error,
			};
		}

		if (
			errorMessage.includes("conflict") ||
			errorMessage.includes("merge") ||
			errorMessage.includes("concurrent")
		) {
			return {
				type: ErrorType.SYNC_CONFLICT,
				severity: ErrorSeverity.NON_FATAL,
				message: `同步冲突错误: ${errorMessage}`,
				originalError: error,
			};
		}

		return {
			type: ErrorType.UNKNOWN,
			severity: ErrorSeverity.NON_FATAL,
			message: `未知错误: ${errorMessage}`,
			originalError: error,
		};
	}

	private isFatalError(error: any): boolean {
		const classification = this.classifyError(error);
		const errorMessage = error instanceof Error ? error.message : String(error);

		if (
			errorMessage.includes("authentication") ||
			errorMessage.includes("unauthorized") ||
			errorMessage.includes("401") ||
			errorMessage.includes("403") ||
			errorMessage.includes("WebDAV配置未初始化")
		) {
			return true;
		}

		return classification.severity === ErrorSeverity.FATAL;
	}

	private logError(classification: ErrorClassification, context: string): void {
		const logData = {
			错误类型: classification.type,
			严重程度: classification.severity,
			错误消息: classification.message,
			上下文: context,
			原始错误:
				classification.originalError instanceof Error
					? classification.originalError.message
					: String(classification.originalError),
		};

		switch (classification.severity) {
			case ErrorSeverity.FATAL:
				console.error("💥 [SyncEngine] 致命错误:", logData);
				break;
			case ErrorSeverity.NON_FATAL:
				console.warn("⚠️ [SyncEngine] 非致命错误:", logData);
				break;
			case ErrorSeverity.WARNING:
				console.warn("ℹ️ [SyncEngine] 警告:", logData);
				break;
		}
	}

	constructor() {
		this.deviceId = generateDeviceId();
		this.metadataManager = new MetadataManager(this.deviceId);
		this.incrementalSyncManager = new IncrementalSyncManager(
			this.metadataManager,
			this.deviceId,
			this,
		);
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
		this.metadataManager.setWebDAVConfig(config);
		this.fileSyncManager.setWebDAVConfig(config);
		this.fileSyncManager.setSyncModeConfig(this.syncModeConfig);
		await this.metadataManager.downloadMetadata();
		this.isInitialized = true;
		return true;
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
			this.metadataManager.clearFingerprintCache();
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

	/**
	 * 执行双向同步
	 */
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

		let diffResult: {
			itemsToSync: any[];
			itemsToDownload: string[];
			deletedIds: string[];
		} = {
			itemsToSync: [],
			itemsToDownload: [],
			deletedIds: [],
		};

		try {
			let remoteData = await this.getCachedRemoteData();
			let remoteFingerprints =
				await this.metadataManager.downloadFingerprints();

			if (
				(!remoteData?.items?.length || remoteData.items.length === 0) &&
				remoteFingerprints.size > 0
			) {
				remoteData = await this.refreshRemoteDataCache();
				this.metadataManager.clearFingerprintCache();
				remoteFingerprints = await this.metadataManager.downloadFingerprints();
			}

			if (remoteData?.items?.length && remoteFingerprints.size === 0) {
				this.metadataManager.clearFingerprintCache();
				const retryFingerprints =
					await this.metadataManager.downloadFingerprints();
				if (retryFingerprints.size > 0) {
					remoteFingerprints = retryFingerprints;
				} else {
					remoteFingerprints =
						await this.rebuildFingerprintsFromRemoteData(remoteData);
					if (remoteFingerprints.size > 0) {
						await this.metadataManager.uploadFingerprints(remoteFingerprints);
					}
				}
			}

			const localLightweightData = await this.getLightweightLocalData(false);

			diffResult = await this.performSelectiveDiff(
				localLightweightData,
				remoteData,
				remoteFingerprints,
			);
			const { itemsToSync, itemsToDownload, deletedIds } = diffResult;

			const fullLocalData = await this.convertToSyncItemsSelective(itemsToSync);

			if (remoteData && itemsToDownload.length > 0) {
				const filteredRemoteData: SyncData = {
					...remoteData,
					items: remoteData.items.filter((item) =>
						itemsToDownload.includes(item.id),
					),
				};

				const { mergedData, conflicts } =
					await this.incrementalSyncManager.mergeRemoteIncrementalData(
						filteredRemoteData,
						fullLocalData,
					);

				if (conflicts.length > 0) {
					const resolvedConflicts =
						this.conflictResolver.resolveConflicts(conflicts);
					result.conflicts = resolvedConflicts;
				}

				const updateResult = await this.updateLocalData(mergedData);

				if (updateResult.errors.length > 0) {
					result.errors.push(...updateResult.errors);
				}

				await this.fileSyncManager.syncRemoteFiles(mergedData);

				result.downloaded = itemsToDownload.length;
			}

			if (itemsToSync.length > 0 || deletedIds.length > 0) {
				const actualUploadCount = fullLocalData.length;

				const syncData: SyncData = {
					version: 2,
					timestamp: Date.now(),
					deviceId: this.deviceId,
					dataType: "incremental",
					items: fullLocalData,
					deleted: deletedIds,
					compression: "none",
					checksum: calculateStringChecksum(JSON.stringify(fullLocalData)),
				};

				const uploadSuccess = await this.uploadSyncData(syncData);

				if (uploadSuccess) {
					result.uploaded = actualUploadCount;

					if (deletedIds.length > 0) {
						const deleteResult = await this.deleteRemoteFiles(deletedIds);

						if (deleteResult.failed > 0) {
							const errorMsg = `部分远程文件包删除失败: ${deleteResult.failed} 个`;
							const classification = this.classifyError(new Error(errorMsg));
							this.logError(classification, "远程文件包删除");

							if (deleteResult.failed > deletedIds.length / 2) {
								result.errors.push(errorMsg);
							}
						}

						await this.refreshRemoteDataCacheWithRetry();
						this.metadataManager.clearFingerprintCache();
					}

					const currentRemoteFingerprints =
						await this.metadataManager.downloadFingerprints();

					const localFingerprints = new Map<string, DataFingerprint>();
					for (const item of fullLocalData) {
						localFingerprints.set(
							item.id,
							this.metadataManager.generateFingerprint(item),
						);
					}

					for (const deletedId of deletedIds) {
						currentRemoteFingerprints.delete(deletedId);
					}

					for (const [id, fp] of localFingerprints) {
						currentRemoteFingerprints.set(id, fp);
					}

					await this.metadataManager.uploadFingerprints(
						currentRemoteFingerprints,
					);
				} else {
					const errorMsg = "上传同步数据失败";
					const classification = this.classifyError(new Error(errorMsg));
					this.logError(classification, "同步数据上传");

					if (this.isFatalError(new Error(errorMsg))) {
						result.errors.push(errorMsg);
					}
				}
			}

			await this.updateMetadata();

			if (deletedIds.length > 0) {
				await this.permanentlyDeleteItems(deletedIds);
			}

			const fatalErrors = result.errors.filter((error) =>
				this.isFatalError(error),
			);

			result.success = fatalErrors.length === 0;
			this.lastSyncTime = Date.now();

			if (
				this.isTransitioningToFavoriteMode ||
				this.isTransitioningFromFavoriteMode
			) {
				this.resetModeTransitionFlags();
			}

			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (error) {
				const classification = this.classifyError(error);
				this.logError(classification, "界面刷新");

				if (this.isFatalError(error)) {
					result.errors.push(
						`界面刷新失败: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		} catch (error) {
			const classification = this.classifyError(error);
			this.logError(classification, "同步过程");

			if (this.isFatalError(error)) {
				result.errors.push(
					`同步异常: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} finally {
			this.syncInProgress = false;
		}

		result.duration = Date.now() - startTime;

		return result;
	}

	private async getLightweightLocalData(
		includeDeletedForDetection = false,
	): Promise<any[]> {
		try {
			const localRawData = await getHistoryData(includeDeletedForDetection);
			const uniqueItems = this.deduplicateItems(localRawData as any[]);
			let filteredItems = uniqueItems;

			if (!includeDeletedForDetection) {
				filteredItems = this.filterItemsBySyncMode(uniqueItems, false);
			} else {
				filteredItems = this.filterItemsBySyncMode(uniqueItems, true);
			}

			const lightweightData = filteredItems.map((item) => {
				const checksum = calculateContentChecksum(item);

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
					value: item.value,
					createTime: item.createTime,
					lastModified: item.lastModified || Date.now(),
					favorite: item.favorite,
					deleted: item.deleted || false,
					checksum,
					size, // 添加size字段以保持一致性
				};
			});

			return lightweightData;
		} catch {
			return [];
		}
	}

	private async convertToSyncItemsSelective(items: any[]): Promise<SyncItem[]> {
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

		// 开始转换同步项

		for (const item of nonFileItems) {
			try {
				const syncItem = this.convertToSyncItem(item);
				syncItems.push(syncItem);
			} catch {
				// 处理非文件项失败
			}
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
				} catch {
					// 处理文件项失败
				}
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

	/**
	 * 执行选择性差异检测
	 */
	private async performSelectiveDiff(
		localData: any[],
		remoteData: SyncData | null,
		remoteFingerprints: Map<string, DataFingerprint>,
	): Promise<{
		itemsToSync: any[];
		itemsToDownload: string[];
		deletedIds: string[];
	}> {
		const itemsToSync: any[] = [];
		const itemsToDownload: string[] = [];
		const deletedIds: string[] = [];

		const localDataWithDeleted = await this.getLightweightLocalData(true);
		const localDeletions = this.detectLocalDeletions(localDataWithDeleted);

		// 添加本地删除操作到删除列表
		for (const deletedId of localDeletions) {
			if (!deletedIds.includes(deletedId)) {
				deletedIds.push(deletedId);
			}
		}

		const localFingerprints = new Map<string, DataFingerprint>();
		for (const item of localData) {
			const checksum = calculateContentChecksum(item);

			// 统一大小计算，确保与指纹生成逻辑一致
			let size: number;
			if (item.type === "image" || item.type === "files") {
				// 使用核心内容计算大小，确保与校验和计算一致
				const coreValue = extractFileCoreValue(item);
				size = coreValue.length;
			} else {
				size = JSON.stringify(item).length;
			}

			localFingerprints.set(item.id, {
				id: item.id,
				checksum,
				timestamp: item.lastModified || item.createTime,
				size,
				type: item.type,
			});
		}

		// 传递删除项信息和本地数据给指纹比较方法
		const diff = this.metadataManager.compareFingerprints(
			localFingerprints,
			remoteFingerprints,
			localDeletions, // 传递删除项ID列表
			localData, // 传递本地数据项，用于检测收藏状态变化
		);

		// 验证删除项是否正确地从指纹比较中排除
		const deletedItemsInUnchanged = diff.unchanged.filter((id) =>
			localDeletions.includes(id),
		);
		if (deletedItemsInUnchanged.length > 0) {
			// 删除项被错误归类为未变更项
		}

		// 如果指纹数据完整且远程数据为空，优先使用指纹数据
		let effectiveRemoteData = remoteData;
		if (
			remoteFingerprints.size > 0 &&
			(!remoteData?.items || remoteData.items.length === 0)
		) {
			const reconstructedRemoteItems: any[] = [];
			for (const [id, fp] of remoteFingerprints) {
				reconstructedRemoteItems.push({
					id,
					type: fp.type,
					createTime: fp.timestamp,
					lastModified: fp.timestamp,
					checksum: fp.checksum,
					size: fp.size,
				});
			}

			effectiveRemoteData = {
				version: 2,
				timestamp: Date.now(),
				deviceId: "unknown",
				dataType: "full",
				items: reconstructedRemoteItems,
				deleted: [],
				compression: "none",
				checksum: "",
			};
		}

		// 优化模式切换时的数据处理
		const isTransitioningFromFavorite =
			this.checkTransitioningFromFavoriteMode();

		// 确定需要上传的项
		for (const fp of [...diff.added, ...diff.modified]) {
			const item = localData.find((i) => i.id === fp.id);
			if (item) {
				const isFavoriteChange =
					diff.favoriteChanged?.includes(item.id) || false;

				if (this.syncModeConfig?.settings.onlyFavorites && !item.favorite) {
					if (isFavoriteChange) {
						itemsToSync.push(item);
					}
				} else if (isTransitioningFromFavorite && isFavoriteChange) {
					itemsToSync.push(item);
				} else {
					itemsToSync.push(item);
				}
			}
		}

		// 修复：额外处理收藏状态变更，确保收藏状态变更能够被正确同步到远程
		// 特别是在收藏模式下，用户取消收藏的操作需要被同步到远程
		if (diff.favoriteChanged && diff.favoriteChanged.length > 0) {
			// 处理收藏状态变更项

			for (const itemId of diff.favoriteChanged) {
				// 查找本地数据中的该项
				const localItem = localData.find((item) => item.id === itemId);

				if (localItem) {
					// 修复：强制添加所有收藏状态变更项到同步列表，无论是否在收藏模式下
					// 这样可以确保收藏状态变更能够被同步到远程
					const alreadyInSyncList = itemsToSync.some(
						(item) => item.id === itemId,
					);

					if (!alreadyInSyncList) {
						// 强制添加收藏状态变更项到同步列表
						itemsToSync.push(localItem);
					} else {
						// 如果已经在同步列表中，确保其收藏状态是最新的
						const existingItem = itemsToSync.find((item) => item.id === itemId);
						if (existingItem) {
							existingItem.favorite = localItem.favorite;

							// 更新同步列表中项的收藏状态
						}
					}

					// 修复：确保收藏状态变更项的校验和包含收藏状态
					// 这样可以确保收藏状态变更能够被正确检测和同步
					const favoriteAwareChecksum = calculateUnifiedChecksum(
						localItem,
						false,
						true,
					);

					// 更新本地指纹中的校验和
					const localFp = localFingerprints.get(itemId);
					if (localFp) {
						localFp.checksum = favoriteAwareChecksum;

						// 更新收藏状态变更项的校验和
					}
				}
			}
		}

		// 删除检测已完成

		// 移除已标记为删除的项目，避免操作冲突
		const filteredLocalData = localData.filter(
			(item) => !deletedIds.includes(item.id),
		);
		const filteredDiff = {
			added: diff.added.filter((fp) => !deletedIds.includes(fp.id)),
			modified: diff.modified.filter((fp) => !deletedIds.includes(fp.id)),
			unchanged: diff.unchanged.filter((id) => !deletedIds.includes(id)),
		};

		// 确定需要下载的项
		if (effectiveRemoteData) {
			const remoteIds = new Set(
				effectiveRemoteData.items.map((item) => item.id),
			);
			const remoteItemsMap = new Map(
				effectiveRemoteData.items.map((item) => [item.id, item]),
			);

			const isLocalDatabaseEmpty = localData.length === 0;
			const isFavoriteMode = this.syncModeConfig?.settings.onlyFavorites;

			if (isLocalDatabaseEmpty && effectiveRemoteData?.items?.length > 0) {
				for (const remoteItem of effectiveRemoteData.items) {
					if (
						!itemsToDownload.includes(remoteItem.id) &&
						!deletedIds.includes(remoteItem.id)
					) {
						let shouldDownload = true;

						if (this.checkTransitioningToFavoriteMode()) {
							shouldDownload = false;
						} else if (isFavoriteMode) {
							shouldDownload = false;
						}

						if (shouldDownload) {
							itemsToDownload.push(remoteItem.id);
						}
					}
				}
			}

			for (const fp of filteredDiff.modified) {
				if (deletedIds.includes(fp.id)) {
					continue;
				}

				if (remoteIds.has(fp.id)) {
					const localItem = filteredLocalData.find((i) => i.id === fp.id);
					const remoteItem = remoteItemsMap.get(fp.id);

					if (localItem && remoteItem) {
						const localTime = new Date(
							localItem.lastModified || localItem.createTime,
						).getTime();
						const remoteTime = new Date(
							(remoteItem as any).lastModified ||
								(remoteItem as any).createTime,
						).getTime();

						let shouldDownload = remoteTime > localTime;

						if (this.checkTransitioningToFavoriteMode()) {
							shouldDownload = false;
						}

						if (
							shouldDownload &&
							!itemsToSync.some((item) => item.id === fp.id)
						) {
							itemsToDownload.push(fp.id);
						}
					}
				}
			}
		}

		// 更新本地快照
		this.updateLocalSnapshot(
			localData.map((item) => {
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
					value: item.value,
					group: item.group || "",
					search: item.search || "",
					count: item.count || 0,
					width: item.width || 0,
					height: item.height || 0,
					favorite: item.favorite,
					createTime: item.createTime,
					note: item.note || "",
					subtype: item.subtype || "",
					lastModified: item.lastModified,
					deviceId: this.deviceId,
					size,
					checksum: item.checksum,
				};
			}),
		);

		// 简化操作冲突检测和解决逻辑
		const uploadIds = new Set(itemsToSync.map((item) => item.id));
		const downloadIds = new Set(itemsToDownload);
		const deleteIds = new Set(deletedIds);

		const uploadDownloadOverlap = [...uploadIds].filter((id) =>
			downloadIds.has(id),
		);
		const uploadDeleteOverlap = [...uploadIds].filter((id) =>
			deleteIds.has(id),
		);
		const downloadDeleteOverlap = [...downloadIds].filter((id) =>
			deleteIds.has(id),
		);

		// 只在有冲突时才输出详细日志
		if (
			uploadDeleteOverlap.length > 0 ||
			downloadDeleteOverlap.length > 0 ||
			uploadDownloadOverlap.length > 0
		) {
			// 检测到操作冲突

			// 解决上传与删除的冲突：优先保留删除操作
			for (const conflictId of uploadDeleteOverlap) {
				const index = itemsToSync.findIndex((item) => item.id === conflictId);
				if (index !== -1) {
					itemsToSync.splice(index, 1);
				}
			}

			// 解决下载与删除的冲突：优先保留删除操作
			for (const conflictId of downloadDeleteOverlap) {
				const index = itemsToDownload.indexOf(conflictId);
				if (index !== -1) {
					itemsToDownload.splice(index, 1);
				}
			}

			// 解决上传与下载的冲突：优先保留上传操作（本地变更优先）
			for (const conflictId of uploadDownloadOverlap) {
				const index = itemsToDownload.indexOf(conflictId);
				if (index !== -1) {
					itemsToDownload.splice(index, 1);
				}
			}

			// 验证冲突解决结果
			const finalUploadIds = new Set(itemsToSync.map((item) => item.id));
			const finalDownloadIds = new Set(itemsToDownload);
			const finalDeleteIds = new Set(deletedIds);

			const finalUploadDownloadOverlap = [...finalUploadIds].filter((id) =>
				finalDownloadIds.has(id),
			);
			const finalUploadDeleteOverlap = [...finalUploadIds].filter((id) =>
				finalDeleteIds.has(id),
			);
			const finalDownloadDeleteOverlap = [...finalDownloadIds].filter((id) =>
				finalDeleteIds.has(id),
			);

			if (
				finalUploadDownloadOverlap.length === 0 &&
				finalUploadDeleteOverlap.length === 0 &&
				finalDownloadDeleteOverlap.length === 0
			) {
				// 操作冲突已解决
			}
		}

		// 修复：处理收藏状态变化，避免收藏状态变化被误判为内容修改
		if (diff.favoriteChanged && diff.favoriteChanged.length > 0) {
			// 处理收藏状态变化项
			for (const itemId of diff.favoriteChanged) {
				// 检查该项是否在待上传列表中
				const uploadIndex = itemsToSync.findIndex((item) => item.id === itemId);
				if (uploadIndex !== -1) {
					// 如果该项已经在待上传列表中，检查是否只是收藏状态变化
					const localItem = localData.find((i) => i.id === itemId);

					if (localItem) {
						// 重新计算包含收藏状态的校验和
						const favoriteAwareChecksum = calculateUnifiedChecksum(
							localItem,
							false,
							true,
						);

						// 更新校验和
						const localFp = localFingerprints.get(itemId);
						if (localFp) {
							localFp.checksum = favoriteAwareChecksum;
						}
					}
				}
			}
		}

		return { itemsToSync, itemsToDownload, deletedIds };
	}

	private deduplicateItems(items: any[]): any[] {
		const uniqueItems: any[] = [];
		const seenKeys = new Set<string>();

		for (const item of items) {
			const key = `${item.type}:${item.value}`;
			if (!seenKeys.has(key)) {
				seenKeys.add(key);
				uniqueItems.push(item);
			}
		}

		return uniqueItems;
	}

	private filterItemsBySyncMode(
		items: any[],
		includeDeleted = false,
		_handleModeTransition = false,
		syncFavoriteChanges = false,
	): any[] {
		if (!this.syncModeConfig?.settings) {
			return items;
		}

		const settings = this.syncModeConfig.settings;

		return items.filter((item) => {
			if (
				!includeDeleted &&
				(item.deleted === true || (item.deleted as any) === 1)
			) {
				return false;
			}

			if (settings.onlyFavorites) {
				if (syncFavoriteChanges) {
					return true;
				}

				if (this.checkTransitioningToFavoriteMode()) {
					return true;
				}

				if (!item.favorite) {
					return false;
				}
			}

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
	}

	private convertToSyncItem(item: any): SyncItem {
		const checksum = item.checksum || calculateContentChecksum(item);

		let size: number;
		if (item.type === "image" || item.type === "files") {
			// 使用核心内容计算大小，确保与校验和计算一致
			const coreValue = extractFileCoreValue(item);
			size = coreValue.length;
		} else {
			// 其他类型保持原有逻辑
			size = JSON.stringify(item).length;
		}

		return {
			id: item.id,
			type: item.type,
			group: item.group,
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

	async downloadRemoteData(): Promise<SyncData | null> {
		if (!this.webdavConfig) return null;

		try {
			const filePath = this.getFullPath("sync-data.json");
			const result = await downloadSyncData(this.webdavConfig, filePath);

			if (result.success && result.data) {
				return JSON.parse(result.data);
			}
		} catch {
			// 下载远程数据失败
		}

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

			if (!result.success) {
				return false;
			}
			return true;
		} catch {
			return false;
		}
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
			} catch (error) {
				failedCount++;
				const errorMsg = `更新本地数据失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`;

				const classification = this.classifyError(error);
				this.logError(classification, "本地数据更新");

				if (this.isFatalError(error)) {
					errors.push(errorMsg);
				}
			}
		}

		return { success: successCount, failed: failedCount, errors };
	}

	private async insertOrUpdateItem(item: SyncItem): Promise<void> {
		try {
			// 确定用于查询的值，对于文件包使用核心内容
			let queryValue = item.value;
			if (item.type === "image" || item.type === "files") {
				queryValue = extractFileCoreValue(item);
			}

			const localItem: any = {
				id: item.id,
				type: item.type,
				group: item.group,
				value: item.value,
				search: item.search,
				count: item.fileSize || item.count, // 优先使用fileSize，回退到count
				width: item.width,
				height: item.height,
				favorite: item.favorite,
				createTime: item.createTime,
				note: item.note,
				subtype: item.subtype,
				// 添加按需下载相关字段
				lazyDownload: item.lazyDownload,
				fileSize: item.fileSize,
				fileType: item.fileType,
			};

			// 首先尝试按ID查询现有记录
			const existingById = (await selectSQL("history", {
				id: item.id,
			})) as any[];

			if (existingById && existingById.length > 0) {
				const existing = existingById[0];
				const updateItem = {
					...localItem,
					id: existing.id,
					favorite: this.resolveFavoriteStatus(existing, item),
					count: Math.max(existing.count || 0, item.count || 0),
					createTime: existing.createTime,
				};

				await updateSQL("history", updateItem);
				return;
			}

			// 如果按ID找不到，再尝试按内容和类型查询
			const existingRecords = (await selectSQL("history", {
				type: item.type,
				value: queryValue,
			})) as any[];

			if (existingRecords && existingRecords.length > 0) {
				const existing = existingRecords[0];
				const updateItem = {
					...localItem,
					id: existing.id, // 使用现有记录的ID
					favorite: this.resolveFavoriteStatus(existing, item),
					count: Math.max(existing.count || 0, item.count || 0),
					createTime: existing.createTime,
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
			if (!existingIsFavorite && incomingIsFavorite) {
				result = false;
			} else if (existingIsFavorite && !incomingIsFavorite) {
				result = true;
			} else if (existingIsFavorite && incomingIsFavorite) {
				result = true;
			} else {
				result = false;
			}

			if (this.syncModeConfig?.settings.onlyFavorites) {
				if (!existingIsFavorite) {
					result = false;
				}
			}
		}

		if (existingIsFavorite === incomingIsFavorite) {
			// 时间戳不同但收藏状态相同
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

	private async updateMetadata(): Promise<void> {
		const metadata: SyncMetadata = {
			lastSyncTime: Date.now(),
			deviceId: this.deviceId,
			syncVersion: 2,
			conflictResolution: "merge",
			networkQuality: "medium",
			performanceMetrics: {
				avgUploadSpeed: 0,
				avgDownloadSpeed: 0,
				avgLatency: 0,
			},
		};

		await this.metadataManager.uploadMetadata(metadata);
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

	private async getCachedRemoteData(
		forceRefresh = false,
	): Promise<SyncData | null> {
		const now = Date.now();

		if (
			!forceRefresh &&
			this.lastRemoteData &&
			now - this.lastRemoteDataTime < this.REMOTE_DATA_TTL
		) {
			return this.lastRemoteData;
		}

		const remoteData = await this.downloadRemoteData();

		this.lastRemoteData = remoteData;
		this.lastRemoteDataTime = now;

		return remoteData;
	}

	private async refreshRemoteDataCache(): Promise<SyncData | null> {
		return await this.getCachedRemoteData(true);
	}

	private async refreshRemoteDataCacheWithRetry(): Promise<SyncData | null> {
		const maxRetries = 3;
		let retryDelay = 1000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			const remoteData = await this.getCachedRemoteData(true);

			if (remoteData?.items && remoteData.items.length > 0) {
				return remoteData;
			}

			const remoteFingerprints =
				await this.metadataManager.downloadFingerprints();
			if (remoteFingerprints.size > 0) {
				if (attempt === maxRetries) {
					const rebuiltData =
						await this.rebuildSyncDataFromFingerprints(remoteFingerprints);
					if (rebuiltData) {
						this.lastRemoteData = rebuiltData;
						this.lastRemoteDataTime = Date.now();
						return rebuiltData;
					}
				}
			}

			if (attempt < maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
				retryDelay *= 2;
			}
		}

		return null;
	}

	private async rebuildSyncDataFromFingerprints(
		fingerprints: Map<string, DataFingerprint>,
	): Promise<SyncData | null> {
		if (!fingerprints || fingerprints.size === 0) {
			return null;
		}

		try {
			const syncData: SyncData = {
				version: 2,
				timestamp: Date.now(),
				deviceId: this.deviceId,
				dataType: "full",
				items: [],
				deleted: [],
				compression: "none",
				checksum: "",
			};

			for (const [id, fingerprint] of fingerprints) {
				const basicItem: SyncItem = {
					id,
					type: fingerprint.type as "text" | "image" | "files" | "html" | "rtf",
					value: "",
					group: "text" as "text" | "image" | "files",
					search: "",
					count: 0,
					favorite: false,
					createTime: fingerprint.timestamp.toString(),
					lastModified: fingerprint.timestamp,
					deviceId: this.deviceId,
					size: fingerprint.size,
					checksum: fingerprint.checksum,
				};
				syncData.items.push(basicItem);
			}

			syncData.checksum = calculateStringChecksum(
				JSON.stringify(syncData.items),
			);

			return syncData;
		} catch {
			return null;
		}
	}

	clearCache(): void {
		this.lastRemoteData = null;
		this.lastRemoteDataTime = 0;
		this.metadataManager.clearFingerprintCache();
	}

	private async rebuildFingerprintsFromRemoteData(
		remoteData: SyncData,
	): Promise<Map<string, DataFingerprint>> {
		const fingerprints = new Map<string, DataFingerprint>();

		if (!remoteData?.items?.length) {
			return fingerprints;
		}

		for (const item of remoteData.items) {
			try {
				const fingerprint = this.metadataManager.generateFingerprint(item);
				fingerprints.set(item.id, fingerprint);
			} catch {
				// 重建指纹失败
			}
		}

		return fingerprints;
	}

	canSync(): boolean {
		return this.isOnline && !!this.webdavConfig && !this.syncInProgress;
	}

	getLastLocalSnapshotSize(): number {
		return this.lastLocalSnapshot.size;
	}

	private updateLocalSnapshot(localData: SyncItem[]): void {
		const newSnapshot = new Map<string, DataFingerprint>();
		for (const item of localData) {
			newSnapshot.set(item.id, this.metadataManager.generateFingerprint(item));
		}
		this.lastLocalSnapshot = newSnapshot;
	}

	isInLocalSnapshot(itemId: string): boolean {
		return this.lastLocalSnapshot.has(itemId);
	}

	detectLocalDeletions(currentLocalData: SyncItem[]): string[] {
		const deletedIds: string[] = [];

		for (const item of currentLocalData) {
			if (item.deleted === true || (item.deleted as any) === 1) {
				deletedIds.push(item.id);
			}
		}

		return deletedIds;
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

			// 部分删除操作失败
		} catch {
			// 彻底删除失败
		}
	}

	private async deleteRemoteFiles(
		deletedIds: string[],
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const results = { success: 0, failed: 0, errors: [] as string[] };

		if (!this.webdavConfig || deletedIds.length === 0) {
			return results;
		}

		try {
			const remoteFingerprints =
				await this.metadataManager.downloadFingerprints();

			const filePackagesToDelete: any[] = [];

			for (const deletedId of deletedIds) {
				const fingerprint = remoteFingerprints.get(deletedId);
				if (
					fingerprint &&
					(fingerprint.type === "image" || fingerprint.type === "files")
				) {
					const packageInfo = {
						packageId: deletedId,
						itemId: deletedId,
						itemType: fingerprint.type,
						fileName: `${deletedId}.zip`,
						originalPaths: [],
						size: fingerprint.size,
						checksum: fingerprint.checksum,
						compressedSize: 0,
					};
					filePackagesToDelete.push(packageInfo);
				}
			}

			if (filePackagesToDelete.length === 0) {
				return results;
			}

			const deleteResults = await filePackageManager.deleteRemotePackages(
				filePackagesToDelete,
				this.webdavConfig,
			);

			return deleteResults;
		} catch (error) {
			const classification = this.classifyError(error);
			this.logError(classification, "远程文件删除");

			if (this.isFatalError(error)) {
				results.errors.push(
					`删除远程文件失败: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			return results;
		}
	}
}

// 创建全局同步引擎实例
export const syncEngineV2 = new SyncEngineV2();

// 为了保持向后兼容，导出原有的接口
export const syncEngine = syncEngineV2;
export { SyncEngineV2 as SyncEngine };
