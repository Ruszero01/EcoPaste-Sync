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
 * 统一的校验和计算函数
 * 确保不同同步模式下同一项的校验和一致
 */
export function calculateUnifiedChecksum(
	item: any,
	includeMetadata = false,
	includeFavorite = true,
): string {
	// 提取核心字段，排除同步相关的临时字段
	const coreFields: any = {
		id: item.id,
		type: item.type,
		value: item.value,
	};

	if (includeMetadata) {
		coreFields.createTime = item.createTime;
		coreFields.favorite = !!item.favorite;
		coreFields.note = item.note || "";
	}

	// 统一收藏状态处理逻辑
	if (includeFavorite) {
		coreFields.favorite = !!item.favorite;
	}

	// 按固定顺序序列化，避免属性顺序影响
	const sortedKeys = Object.keys(coreFields).sort();
	const orderedObject: any = {};

	for (const key of sortedKeys) {
		orderedObject[key] = coreFields[key];
	}

	// 使用稳定的JSON序列化
	const checksumSource = JSON.stringify(orderedObject);
	const checksum = calculateStringChecksum(checksumSource);

	return checksum;
}

/**
 * 计算不包含收藏状态的校验和
 * 用于比较内容变化，忽略收藏状态差异
 */
export function calculateContentChecksum(item: any): string {
	return calculateUnifiedChecksum(item, false, false);
}

/**
 * 计算包含收藏状态的校验和
 * 用于检测收藏状态变化
 */
export function calculateFavoriteAwareChecksum(item: any): string {
	return calculateUnifiedChecksum(item, false, true);
}

// 全局事件发射器
let syncEventEmitter: (() => void) | null = null;

// 设置默认的同步事件监听器，确保不会因为没有监听器而失败
const setDefaultSyncListener = () => {
	if (!syncEventEmitter) {
		syncEventEmitter = () => {
			// 默认监听器，什么都不做，只是防止报错
		};
	}
};

/**
 * 设置同步事件监听器
 */
export const setSyncEventListener = (listener: () => void) => {
	if (syncEventEmitter === listener) {
		return;
	}
	syncEventEmitter = listener;
};

// 数据指纹接口
interface DataFingerprint {
	id: string;
	checksum: string;
	timestamp: number;
	size: number;
	type: string;
}

// 同步统计信息
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
 * 元数据管理器 - 负责管理同步元数据和指纹信息
 */
class MetadataManager {
	private webdavConfig: WebDAVConfig | null = null;
	private metadataCache: SyncMetadata | null = null;
	private fingerprintCache: Map<string, DataFingerprint> = new Map();

	constructor(deviceId: string) {
		// deviceId 参数保留用于未来扩展
		void deviceId;
	}

	/**
	 * 设置WebDAV配置
	 */
	setWebDAVConfig(config: WebDAVConfig): void {
		this.webdavConfig = config;
	}

	/**
	 * 获取元数据文件路径
	 */
	private getMetadataFilePath(): string {
		if (!this.webdavConfig) return "/metadata.json";
		const basePath = this.webdavConfig.path.startsWith("/")
			? this.webdavConfig.path
			: `/${this.webdavConfig.path}`;
		return `${basePath}/metadata.json`;
	}

	/**
	 * 获取指纹文件路径
	 */
	private getFingerprintFilePath(): string {
		if (!this.webdavConfig) return "/fingerprints.json";
		const basePath = this.webdavConfig.path.startsWith("/")
			? this.webdavConfig.path
			: `/${this.webdavConfig.path}`;
		return `${basePath}/fingerprints.json`;
	}

	/**
	 * 下载元数据
	 */
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
			// 下载元数据失败，静默处理
		}

		return null;
	}

	/**
	 * 上传元数据
	 */
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
			// 上传元数据失败，静默处理
		}

		return false;
	}

	/**
	 * 下载指纹数据
	 */
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
			// 下载指纹数据失败，静默处理
		}

		return new Map();
	}

	/**
	 * 上传指纹数据
	 */
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
			// 上传指纹数据失败，静默处理
		}

		return false;
	}

	/**
	 * 生成数据指纹
	 * 始终使用不包含收藏状态的校验和，确保收藏模式切换前后校验和一致
	 */
	generateFingerprint(item: SyncItem): DataFingerprint {
		const checksum = calculateContentChecksum(item);

		// 计算数据大小
		let size: number;
		if (item.type === "image" || item.type === "files") {
			size =
				typeof item.value === "string"
					? item.value.length
					: JSON.stringify(item.value).length;
		} else {
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

	/**
	 * 生成包含收藏状态的数据指纹
	 * 用于检测收藏状态变化
	 */
	generateFavoriteAwareFingerprint(item: SyncItem): DataFingerprint {
		const checksum = calculateFavoriteAwareChecksum(item);

		// 计算数据大小
		let size: number;
		if (item.type === "image" || item.type === "files") {
			size =
				typeof item.value === "string"
					? item.value.length
					: JSON.stringify(item.value).length;
		} else {
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

	/**
	 * 比较指纹差异
	 * 支持删除项和收藏状态变化的智能判断
	 */
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

		// 创建本地数据项的映射，便于查找
		const localDataMap = new Map<string, any>();
		if (localDataItems) {
			for (const item of localDataItems) {
				localDataMap.set(item.id, item);
			}
		}

		// 检查本地新增和修改的项
		for (const [id, localFp] of local) {
			// 跳过已标记为删除的项
			if (deletedSet.has(id)) {
				continue;
			}

			const remoteFp = remote.get(id);
			if (!remoteFp) {
				// 如果本地项有有效的校验和，则认为是新增
				if (localFp.checksum && localFp.checksum.length > 0) {
					added.push(localFp);
				}
			} else {
				// 检查校验和差异
				if (localFp.checksum !== remoteFp.checksum) {
					const localDataItem = localDataMap.get(id);

					// 检查是否只是收藏状态变化导致的校验和差异
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

	/**
	 * 检查校验和差异是否仅由收藏状态变化引起
	 */
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

		// 检查四种可能的收藏状态变化模式
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

	/**
	 * 比较包含收藏状态的指纹差异
	 * 用于检测收藏状态变化
	 */
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

	/**
	 * 获取缓存的元数据
	 */
	getCachedMetadata(): SyncMetadata | null {
		return this.metadataCache;
	}

	/**
	 * 获取缓存的指纹数据
	 */
	getCachedFingerprints(): Map<string, DataFingerprint> {
		return this.fingerprintCache;
	}

	/**
	 * 清除指纹数据缓存
	 */
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
	 * 允许收藏状态变更在收藏模式下同步
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
	 * 改进的包模式数据识别逻辑
	 * 不仅依赖_syncType字段，还基于数据类型和内容进行判断
	 */
	private identifyPackageItem(item: any): boolean {
		// 首先检查基本类型
		if (item.type !== "image" && item.type !== "files") {
			return false;
		}

		// 方法1：检查_syncType字段（原有逻辑）
		if (item._syncType === "package_files") {
			return true;
		}

		// 方法2：检查value字段是否包含包信息（容错逻辑）
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
					// 识别为包模式数据，静默处理
					return true;
				}
			} catch {
				// JSON解析失败，继续其他检查
			}
		}

		// 方法3：检查是否包含包特征字段（容错逻辑）
		if (
			item.value &&
			typeof item.value === "string" &&
			(item.value.includes("packageId") ||
				item.value.includes("originalPaths") ||
				item.value.includes("fileName"))
		) {
			// 通过特征字段识别为包模式数据
			return true;
		}

		// 方法4：检查文件大小和校验和字段（容错逻辑）
		if (
			item.fileSize &&
			item.checksum &&
			typeof item.fileSize === "number" &&
			item.fileSize > 0
		) {
			// 通过文件属性识别为包模式数据
			return true;
		}

		// 方法5：检查设备ID是否与当前设备不同（跨设备同步特征）
		if (item.deviceId && item.deviceId !== this.deviceId) {
			// 通过设备ID识别为包模式数据
			return true;
		}

		return false;
	}

	/**
	 * 数据完整性检查
	 * 检查远程数据与本地数据的一致性，识别潜在问题
	 */
	private performDataIntegrityCheck(
		remoteData: SyncData,
		localData: SyncItem[],
	): { isComplete: boolean; issues: string[] } {
		const issues: string[] = [];

		// 检查1：远程数据项是否为空
		if (!remoteData.items || remoteData.items.length === 0) {
			issues.push("远程数据项为空");
		}

		// 检查2：检查远程数据项的基本字段
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

		// 检查3：检查包模式数据的一致性
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
				issues.push(`包模式项 ${packageItem.id} 的value字段无法解析: ${error}`);
			}
		}

		// 检查4：检查本地数据与远程数据的ID冲突
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
	 * 当检测到数据不完整时，尝试多种恢复策略
	 */
	private async attemptDataRecovery(
		remoteData: SyncData,
		localData: SyncItem[],
		_integrityCheck: { isComplete: boolean; issues: string[] },
	): Promise<void> {
		// 策略1：修复缺少基本字段的问题
		for (let i = 0; i < remoteData.items.length; i++) {
			const item = remoteData.items[i];

			// 修复缺少ID的项
			if (!item.id) {
				item.id = `recovered_${Date.now()}_${i}`;
			}

			// 修复缺少类型的项
			if (!item.type) {
				// 尝试从value推断类型
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

			// 修复缺少value的项
			if (item.value === undefined || item.value === null) {
				item.value = "";
			}
		}

		// 策略2：修复包模式数据的问题
		const packageItems = remoteData.items.filter(
			(item) =>
				(item.type === "image" || item.type === "files") &&
				this.identifyPackageItem(item),
		);

		for (const packageItem of packageItems) {
			try {
				if (typeof packageItem.value === "string") {
					const parsedValue = JSON.parse(packageItem.value);

					// 修复缺少packageId的问题
					if (!parsedValue.packageId) {
						parsedValue.packageId = packageItem.id;
					}

					// 修复缺少originalPaths的问题
					if (
						!parsedValue.originalPaths ||
						!Array.isArray(parsedValue.originalPaths)
					) {
						parsedValue.originalPaths = [];
					}

					// 更新修复后的值
					packageItem.value = JSON.stringify(parsedValue);
				}
			} catch {
				// 静默处理包模式项修复失败
			}
		}

		// 策略3：从本地数据补充远程数据
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
	 * 在合并完成后进行最终验证
	 */
	private performFinalDataIntegrityCheck(
		mergedData: SyncItem[],
		remoteData: SyncData,
	): { isComplete: boolean; issues: string[] } {
		const issues: string[] = [];

		// 检查1：合并后数据是否包含所有远程项
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

		// 检查2：检查合并后数据的基本字段
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

		// 检查3：检查包模式数据是否正确解包
		const packageItems = mergedData.filter(
			(item) => item.type === "image" || item.type === "files",
		);

		for (const packageItem of packageItems) {
			// 检查是否仍然包含_syncType字段（应该已被移除）
			if (packageItem._syncType) {
				issues.push(
					`包模式项 ${packageItem.id} 仍包含_syncType字段，可能未正确解包`,
				);
			}

			// 检查value字段是否有效
			if (typeof packageItem.value === "string") {
				// 对于单个图片，value应该是路径字符串
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

				// 对于文件数组，value应该是有效的JSON数组
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
							`文件项 ${packageItem.id} 的value无法解析为JSON: ${error}`,
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
	 * 修复：增加对收藏状态变化的处理
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

		// 增强的数据完整性检查
		const integrityCheck = this.performDataIntegrityCheck(
			remoteData,
			localData,
		);

		// 如果检测到数据不完整，尝试修复
		if (!integrityCheck.isComplete) {
			await this.attemptDataRecovery(remoteData, localData, integrityCheck);
		}

		// 检查收藏状态变化
		const favoriteChanges = this.detectFavoriteChanges(remoteData, localData);

		// 处理删除的项
		const deletedIds = remoteData.deleted || [];
		for (const deletedId of deletedIds) {
			localMap.delete(deletedId);
		}

		// 性能优化：分离包模式数据和非包模式数据，实现并发处理
		const packageItems: any[] = [];
		const regularItems: any[] = [];
		const processedRemoteIds = new Set<string>();

		// 预处理：分类包模式数据和非包模式数据
		for (const remoteItem of remoteData.items) {
			const localItem = localMap.get(remoteItem.id);

			if (!localItem) {
				// 新增项 - 分类处理
				processedRemoteIds.add(remoteItem.id);

				// 改进的包模式数据识别逻辑
				const isPackageItem = this.identifyPackageItem(remoteItem);

				if (isPackageItem) {
					packageItems.push(remoteItem);
				} else {
					regularItems.push(remoteItem);
				}
			} else {
				// 检查冲突
				const localTime = new Date(localItem.createTime).getTime();
				const remoteTime = new Date(remoteItem.createTime).getTime();

				// 修复：优先检查收藏状态冲突
				const localFavorite = !!localItem.favorite;
				const remoteFavorite = !!remoteItem.favorite;

				// 修复：如果收藏状态不同，优先保留本地收藏状态
				if (localFavorite !== remoteFavorite) {
					// 修复：在收藏模式切换时，特别处理收藏状态冲突
					let finalFavoriteState = localFavorite;

					// 如果是从全部模式切换到收藏模式，完全忽略远程收藏状态
					if (this.syncEngine.checkTransitioningToFavoriteMode()) {
						finalFavoriteState = localFavorite;
					}
					// 如果是从收藏模式切换到全部模式，完全忽略远程非收藏状态
					else if (this.syncEngine.checkTransitioningFromFavoriteMode()) {
						finalFavoriteState = localFavorite;
					}
					// 修复：特别处理本地取消收藏的情况
					else if (!localFavorite && remoteFavorite) {
						// 本地未收藏，远程收藏 - 优先保留本地的未收藏状态
						finalFavoriteState = false;
					}
					// 修复：本地收藏，远程未收藏
					else if (localFavorite && !remoteFavorite) {
						// 本地收藏，远程未收藏 - 保持本地收藏状态
						finalFavoriteState = true;
					}

					// 优先保留本地收藏状态
					const finalItem = {
						...localItem,
						favorite: finalFavoriteState,
					};

					mergedData.push(finalItem);
					continue;
				}

				// 修复：对于文件项，需要特殊处理冲突检测
				let hasConflict = false;
				if (localItem.type === "image" || localItem.type === "files") {
					// 对于文件项，如果校验和不匹配，需要进一步检查
					if (localItem.checksum !== remoteItem.checksum) {
						// 检查是否是格式转换导致的假冲突
						const localValueStr =
							typeof localItem.value === "string"
								? localItem.value
								: JSON.stringify(localItem.value);
						const remoteValueStr =
							typeof remoteItem.value === "string"
								? remoteItem.value
								: JSON.stringify(remoteItem.value);

						// 如果本地和远程的value都是包格式，且包信息相同，则认为无冲突
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
								// 解析失败，按常规冲突处理
							}
						}

						hasConflict = true;
					}
				} else {
					// 对于非文件项，直接比较校验和
					hasConflict = localItem.checksum !== remoteItem.checksum;
				}

				if (hasConflict) {
					// 有冲突 - 检查是否需要解包远程包模式数据
					let processedRemoteItem = remoteItem;

					// 改进的包模式数据识别逻辑
					const isPackageItem = this.identifyPackageItem(remoteItem);

					if (isPackageItem) {
						try {
							// 解包远程包模式数据
							const unpackResult =
								await filePackageManager.unpackRemotePackageData(
									remoteItem,
									this.deviceId,
								);

							if (unpackResult.success && unpackResult.processedItem) {
								processedRemoteItem = unpackResult.processedItem;
							}
						} catch {
							// 解包失败，使用原始数据
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

					// 修复：优先保留本地版本，特别是当收藏状态不同时
					if (localFavorite !== remoteFavorite) {
						// 如果收藏状态不同，优先保留本地版本
						mergedData.push(localItem);
					} else {
						// 收藏状态相同，使用时间戳较新的版本
						if (remoteTime > localTime) {
							mergedData.push(processedRemoteItem);
						} else {
							mergedData.push(localItem);
						}
					}
				} else {
					// 无冲突，使用本地版本
					mergedData.push(localItem);
				}
			}

			// 从本地映射中移除已处理的项
			localMap.delete(remoteItem.id);
		}

		// 处理未被预处理的远程项（确保所有远程项都被处理）
		for (const remoteItem of remoteData.items) {
			if (!processedRemoteIds.has(remoteItem.id)) {
				const localItem = localMap.get(remoteItem.id);

				if (!localItem) {
					// 这些应该是已经被处理过的新增项，但以防万一有遗漏
					// 改进的包模式数据识别逻辑
					const isPackageItem = this.identifyPackageItem(remoteItem);

					if (isPackageItem) {
						packageItems.push(remoteItem);
					} else {
						regularItems.push(remoteItem);
					}
				}
			}
		}

		// 处理新增的包模式数据
		if (packageItems.length > 0) {
			for (const packageItem of packageItems) {
				try {
					// 解包远程包模式数据
					const unpackResult = await filePackageManager.unpackRemotePackageData(
						packageItem,
						this.deviceId,
					);

					if (unpackResult && unpackResult !== packageItem) {
						// 解包成功，添加到合并结果
						mergedData.push(unpackResult);
					} else {
						// 解包失败或无需解包，使用原始数据
						mergedData.push(packageItem);
					}
				} catch {
					// 解包异常，使用原始数据
					mergedData.push(packageItem);
				}
			}
		}

		// 处理新增的常规模式数据
		if (regularItems.length > 0) {
			for (const regularItem of regularItems) {
				// 直接添加到合并结果
				mergedData.push(regularItem);
			}
		}

		// 添加剩余的本地项（未被远程数据影响的项）
		for (const localItem of localMap.values()) {
			mergedData.push(localItem);
		}

		// 最终数据完整性验证
		const finalIntegrityCheck = this.performFinalDataIntegrityCheck(
			mergedData,
			remoteData,
		);

		// 如果最终检查仍有问题，静默处理
		if (!finalIntegrityCheck.isComplete) {
			// 静默处理完整性检查问题
		}

		// 处理收藏状态变化
		this.processFavoriteChanges(favoriteChanges, mergedData);

		// 确保收藏状态变更后的数据校验和正确
		// 这样可以避免收藏状态变更被误判为内容修改
		for (const change of favoriteChanges) {
			const mergedItem = mergedData.find((item) => item.id === change.itemId);
			if (mergedItem) {
				// 重新计算包含收藏状态的校验和
				const favoriteAwareChecksum = calculateUnifiedChecksum(
					mergedItem,
					false,
					true,
				);

				// 更新校验和
				mergedItem.checksum = favoriteAwareChecksum;
			}
		}

		return { mergedData, conflicts };
	}

	/**
	 * 检测收藏状态变化
	 * 修复：优先保留本地收藏状态，避免远程数据覆盖本地的收藏状态变更
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
				const remoteFavorite = !!remoteItem.favorite;

				if (localFavorite !== remoteFavorite) {
					// 修复：优先保留本地收藏状态，特别是当本地取消收藏时
					let changeType: "local_to_remote" | "remote_to_local" | "conflict";

					// 修复：特别处理本地取消收藏的情况
					if (!localFavorite && remoteFavorite) {
						// 本地未收藏，远程收藏 - 优先保留本地的未收藏状态
						// 这解决了用户取消收藏后，远程数据覆盖本地状态的问题
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
							remoteItem.lastModified || remoteItem.createTime,
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
	 * 修复：优先保留本地收藏状态，避免远程数据覆盖本地的收藏状态变更
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

				// 修复：在收藏模式切换时，完全忽略远程收藏状态
				if (this.syncEngine.checkTransitioningToFavoriteMode()) {
					// 从全部模式切换到收藏模式，完全忽略远程收藏状态
					finalFavoriteState = change.localFavorite;
				} else if (this.syncEngine.checkTransitioningFromFavoriteMode()) {
					// 从收藏模式切换到全部模式，完全忽略远程收藏状态
					finalFavoriteState = change.localFavorite;
				} else {
					// 正常情况下的收藏状态处理
					if (!change.localFavorite && change.remoteFavorite) {
						// 本地未收藏，远程收藏 - 优先保留本地的未收藏状态
						// 这解决了用户取消收藏后，远程数据覆盖本地状态的问题
						finalFavoriteState = false;
					} else if (change.localFavorite && !change.remoteFavorite) {
						// 本地收藏，远程未收藏 - 保持本地收藏状态
						finalFavoriteState = true;
					} else if (change.localFavorite && change.remoteFavorite) {
						// 双方都是收藏 - 保持收藏状态
						finalFavoriteState = true;
					} else {
						// 双方都未收藏 - 保持未收藏状态
						finalFavoriteState = false;
					}
				}

				// 更新合并后项的收藏状态
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
				// 重建指纹失败，跳过该项
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
		if (!this.isFileItem(item)) {
			return item;
		}

		if (!this.webdavConfig) {
			return item;
		}

		try {
			if (item.type === "image") {
				return await this.processImageItem(item);
			}
			if (item.type === "files") {
				return await this.processFilesItem(item);
			}
		} catch {
			// 处理文件同步项失败
		}

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
			// 检查是否已经是包模式
			if (item._syncType === "package_files") {
				return item;
			}

			// 获取图片路径
			let imagePath = item.value;

			// 修复：检查是否是JSON格式的字符串（这可能是错误的数据格式）
			if (typeof imagePath === "string" && imagePath.startsWith("{")) {
				// 尝试解析JSON，看是否是包信息
				try {
					const parsed = JSON.parse(imagePath);
					if (parsed.packageId && parsed.originalPaths) {
						// 修复_syncType，并保持原始的包格式
						return {
							...item,
							_syncType: "package_files",
						};
					}
				} catch {
					// JSON解析失败，跳过处理
				}

				// 尝试从JSON中提取原始路径
				try {
					const parsed = JSON.parse(imagePath);
					if (
						parsed.originalPaths &&
						Array.isArray(parsed.originalPaths) &&
						parsed.originalPaths.length > 0
					) {
						const recoveredPath = parsed.originalPaths[0];
						if (typeof recoveredPath === "string" && recoveredPath.length > 0) {
							// 使用恢复的路径创建新的图片项
							return {
								...item,
								value: recoveredPath,
								_syncType: undefined, // 重置同步类型，让它重新处理
							};
						}
					}
				} catch {
					// 恢复图片路径失败，跳过处理
				}

				// 无法恢复，跳过处理
				return item;
			}

			// 处理数组格式的路径
			if (typeof imagePath === "string" && imagePath.startsWith("[")) {
				try {
					const parsed = JSON.parse(imagePath);
					if (Array.isArray(parsed) && parsed.length > 0) {
						// 查找有效的文件路径
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
					// 解析失败，使用原始路径
				}
			}

			// 验证最终路径的有效性
			if (typeof imagePath !== "string") {
				return item;
			}

			// 检查路径是否包含JSON片段（这是问题的根源）
			if (
				imagePath.includes('{"') ||
				imagePath.includes('"}') ||
				imagePath.includes("packageId")
			) {
				return item;
			}

			// 检查文件大小限制
			const maxSize = this.syncModeConfig?.fileLimits?.maxImageSize || 5; // 默认5MB
			const fileSize = await this.getFileSize(imagePath);

			if (fileSize > maxSize * 1024 * 1024) {
				return item; // 超过大小限制，跳过处理
			}

			// 使用文件包管理器处理
			const paths = Array.isArray(imagePath) ? imagePath : [imagePath];

			const packageInfo = await filePackageManager.smartUploadPackage(
				item.id,
				item.type,
				paths,
				this.webdavConfig!,
			);

			if (packageInfo) {
				// 修复：确保返回的图片项格式正确
				return {
					...item,
					value: JSON.stringify(packageInfo),
					_syncType: "package_files",
					fileSize: packageInfo.size,
					fileType: "image",
				};
			}
		} catch {
			// 错误已在上层处理
		}

		return item;
	}

	/**
	 * 处理文件数组项
	 */
	private async processFilesItem(item: SyncItem): Promise<SyncItem | null> {
		try {
			// 检查是否已经是包模式
			if (item._syncType === "package_files") {
				return item;
			}

			// 解析文件路径
			let filePaths: string[];
			try {
				const parsedValue = JSON.parse(item.value);

				// 确保解析后的结果是数组
				if (!Array.isArray(parsedValue)) {
					// 尝试处理对象格式的文件项
					if (typeof parsedValue === "object" && parsedValue !== null) {
						// 检查是否有originalPaths属性
						if (
							parsedValue.originalPaths &&
							Array.isArray(parsedValue.originalPaths)
						) {
							filePaths = parsedValue.originalPaths.filter(
								(path: any) => typeof path === "string",
							);
						}
						// 检查是否有paths属性
						else if (parsedValue.paths && Array.isArray(parsedValue.paths)) {
							filePaths = parsedValue.paths.filter(
								(path: any) => typeof path === "string",
							);
						}
						// 检查是否是单个文件路径
						else if (parsedValue.path && typeof parsedValue.path === "string") {
							filePaths = [parsedValue.path];
						}
						// 检查是否是文件名
						else if (
							parsedValue.fileName &&
							typeof parsedValue.fileName === "string"
						) {
							filePaths = [parsedValue.fileName];
						}
						// 如果都无法提取，返回
						else {
							return item;
						}
					} else {
						return item;
					}
				} else {
					// 确保数组中的每个元素都是字符串
					filePaths = parsedValue.filter((path) => typeof path === "string");
				}

				if (filePaths.length === 0) {
					return item;
				}
			} catch {
				return item;
			}

			// 检查文件大小限制
			const maxSize = this.syncModeConfig?.fileLimits?.maxFileSize || 10; // 默认10MB
			const validPaths: string[] = [];
			const invalidPaths: string[] = [];

			for (const filePath of filePaths) {
				try {
					const fileSize = await this.getFileSize(filePath);
					if (fileSize <= maxSize * 1024 * 1024) {
						validPaths.push(filePath);
					} else {
						invalidPaths.push(filePath);
					}
				} catch {
					invalidPaths.push(filePath);
				}
			}

			if (validPaths.length === 0) {
				return item;
			}

			// 使用文件包管理器处理
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
		const errors: string[] = [];
		const MAX_CONCURRENT_SYNC = 3; // 限制并发同步数量
		const syncPromises: Promise<void>[] = [];

		// 开始同步远程文件

		// 分批处理文件，避免同时处理过多文件导致卡死
		for (let i = 0; i < packageItems.length; i++) {
			const item = packageItems[i];

			// 检查全局错误状态
			let packageInfo: any;
			try {
				packageInfo = JSON.parse(item.value);
			} catch {
				continue;
			}

			if (globalErrorTracker.hasFailedTooManyTimes(packageInfo.packageId)) {
				// 跳过已失败过多的文件
				continue;
			}

			// 创建同步Promise
			const syncPromise = (async () => {
				try {
					await filePackageManager.syncFilesIntelligently(
						packageInfo,
						this.webdavConfig!,
					);
				} catch (error) {
					const errorMsg = `同步远程文件失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`;
					errors.push(errorMsg);

					// 记录到全局错误跟踪器
					if (packageInfo?.packageId) {
						globalErrorTracker.recordError(packageInfo.packageId, errorMsg);
					}
				}
			})();

			syncPromises.push(syncPromise);

			// 控制并发数量
			if (syncPromises.length >= MAX_CONCURRENT_SYNC) {
				// 等待至少一个Promise完成
				await Promise.race(syncPromises);

				// 移除已完成的Promise
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

		// 等待所有剩余的同步完成
		await Promise.allSettled(syncPromises);

		// 如果有错误，记录但不中断整个流程
		if (errors.length > 0) {
			// 部分文件同步失败
		}

		// 输出错误跟踪器统计信息
		const stats = globalErrorTracker.getStats();
		if (stats.permanentlyFailed > 0) {
			// 只在有永久失败时输出统计信息
		}
	}

	/**
	 * 更新数据库中的文件路径
	 * @deprecated 此方法已弃用，更新逻辑移至filePackageManager.syncFilesIntelligently中
	 */
	private async updateFilePathsInDatabase(
		itemId: string,
		filePaths: string[],
	): Promise<void> {
		try {
			await updateSQL("history", {
				id: itemId,
				value: JSON.stringify(filePaths),
			});
		} catch {
			// 更新文件路径失败
		}
	}
}

/**
 * 冲突解决器 - 负责处理同步冲突
 */
class ConflictResolver {
	/**
	 * 解决冲突
	 */
	resolveConflicts(conflicts: ConflictInfo[]): ConflictInfo[] {
		const resolvedConflicts: ConflictInfo[] = [];

		for (const conflict of conflicts) {
			const resolvedConflict = this.resolveConflict(conflict);
			resolvedConflicts.push(resolvedConflict);
		}

		return resolvedConflicts;
	}

	/**
	 * 解决单个冲突
	 */
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

	/**
	 * 解决修改冲突
	 */
	private resolveModifyConflict(conflict: ConflictInfo): ConflictInfo {
		const localTime = new Date(conflict.localVersion.createTime).getTime();
		const remoteTime = new Date(conflict.remoteVersion.createTime).getTime();

		// 使用时间戳较新的版本
		if (remoteTime > localTime) {
			return {
				...conflict,
				resolution: "remote",
				reason: "远程版本较新",
			};
		}
		if (localTime > remoteTime) {
			return {
				...conflict,
				resolution: "local",
				reason: "本地版本较新",
			};
		}

		// 时间戳相同，使用本地版本
		return {
			...conflict,
			resolution: "local",
			reason: "时间戳相同，保留本地版本",
		};
	}

	/**
	 * 解决删除冲突
	 */
	private resolveDeleteConflict(conflict: ConflictInfo): ConflictInfo {
		// 删除冲突优先保留数据
		return {
			...conflict,
			resolution: "local",
			reason: "删除冲突，保留本地数据",
		};
	}

	/**
	 * 解决创建冲突
	 */
	private resolveCreateConflict(conflict: ConflictInfo): ConflictInfo {
		// 创建冲突使用远程版本
		return {
			...conflict,
			resolution: "remote",
			reason: "创建冲突，使用远程版本",
		};
	}
}

/**
 * 错误类型枚举
 */
enum ErrorType {
	NETWORK = "network",
	FILE_OPERATION = "file_operation",
	DATABASE = "database",
	PARSING = "parsing",
	VALIDATION = "validation",
	SYNC_CONFLICT = "sync_conflict",
	UNKNOWN = "unknown",
}

/**
 * 错误严重程度枚举
 */
enum ErrorSeverity {
	FATAL = "fatal", // 致命错误，必须停止同步
	NON_FATAL = "non_fatal", // 非致命错误，可以忽略
	WARNING = "warning", // 警告，仅记录日志
}

/**
 * 错误分类结果接口
 */
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

	/**
	 * 错误分类方法 - 对错误进行分类和严重程度判断
	 */
	private classifyError(error: any): ErrorClassification {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// 网络相关错误
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

		// 文件操作错误
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

		// 数据库错误
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

		// 解析错误
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

		// 验证错误
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

		// 同步冲突错误
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

		// 默认为未知错误，但标记为非致命
		return {
			type: ErrorType.UNKNOWN,
			severity: ErrorSeverity.NON_FATAL,
			message: `未知错误: ${errorMessage}`,
			originalError: error,
		};
	}

	/**
	 * 判断错误是否致命
	 */
	private isFatalError(error: any): boolean {
		const classification = this.classifyError(error);

		// 目前所有错误都被分类为非致命或警告
		// 只有在特定情况下才认为是致命错误
		// 例如：WebDAV配置完全错误或认证失败
		const errorMessage = error instanceof Error ? error.message : String(error);

		// 认证失败或配置错误 - 这些是致命错误
		if (
			errorMessage.includes("authentication") ||
			errorMessage.includes("unauthorized") ||
			errorMessage.includes("401") ||
			errorMessage.includes("403") ||
			errorMessage.includes("WebDAV配置未初始化")
		) {
			return true;
		}

		// 如果错误分类为致命，则返回true
		return classification.severity === ErrorSeverity.FATAL;
	}

	/**
	 * 记录错误日志 - 根据错误严重程度使用不同的日志级别
	 */
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
				// biome-ignore lint/suspicious/noConsoleLog: 允许在警告日志时使用日志
				console.log("ℹ️ [SyncEngine] 警告:", logData);
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

		// 设置默认同步事件监听器
		setDefaultSyncListener();
	}

	/**
	 * 初始化同步引擎
	 */
	async initialize(config: WebDAVConfig): Promise<boolean> {
		if (this.isInitialized && this.webdavConfig) {
			const isSameConfig =
				this.webdavConfig.url === config.url &&
				this.webdavConfig.username === config.username &&
				this.webdavConfig.path === config.path;

			if (isSameConfig) {
				return true;
			}
		}

		this.webdavConfig = config;
		this.isOnline = true;

		// 初始化各个组件
		this.metadataManager.setWebDAVConfig(config);
		this.fileSyncManager.setWebDAVConfig(config);
		this.fileSyncManager.setSyncModeConfig(this.syncModeConfig);

		// 下载元数据
		await this.metadataManager.downloadMetadata();

		this.isInitialized = true;
		return true;
	}

	/**
	 * 设置同步模式配置
	 */
	setSyncModeConfig(config: SyncModeConfig): void {
		// 检查配置是否真的发生了变化，避免不必要的处理
		if (this.syncModeConfig) {
			const configString = JSON.stringify(config);
			const currentConfigString = JSON.stringify(this.syncModeConfig);
			if (configString === currentConfigString) {
				return; // 配置没有变化，直接返回
			}
		}

		// 检查文件模式是否发生变化
		const fileModeChanged =
			this.syncModeConfig?.settings.includeImages !==
				config.settings.includeImages ||
			this.syncModeConfig?.settings.includeFiles !==
				config.settings.includeFiles;

		// 检查收藏模式是否发生变化
		const favoriteModeChanged =
			this.syncModeConfig?.settings.onlyFavorites !==
			config.settings.onlyFavorites;

		// 如果收藏模式发生变化，需要特殊处理
		if (favoriteModeChanged) {
			this.handleFavoriteModeChange(
				this.syncModeConfig?.settings.onlyFavorites || false,
				config.settings.onlyFavorites,
			);
		}

		this.syncModeConfig = config;
		this.fileSyncManager.setSyncModeConfig(config);

		// 如果文件模式或收藏模式发生变化，清除缓存以确保数据重新计算
		if (fileModeChanged || favoriteModeChanged) {
			this.clearCache();
			this.metadataManager.clearFingerprintCache();
		}
	}

	/**
	 * 处理收藏模式变化
	 * 当用户切换收藏模式时，需要特殊处理以确保数据一致性
	 */
	private handleFavoriteModeChange(
		previousOnlyFavorites: boolean,
		currentOnlyFavorites: boolean,
	): void {
		// 从全部模式切换到收藏模式
		if (!previousOnlyFavorites && currentOnlyFavorites) {
			this.isTransitioningToFavoriteMode = true;
		}
		// 从收藏模式切换到全部模式
		else if (previousOnlyFavorites && !currentOnlyFavorites) {
			this.isTransitioningFromFavoriteMode = true;
		}
	}

	/**
	 * 获取设备ID
	 */
	getDeviceId(): string {
		return this.deviceId;
	}

	/**
	 * 检查是否正在从全部模式切换到收藏模式
	 */
	checkTransitioningToFavoriteMode(): boolean {
		return this.isTransitioningToFavoriteMode;
	}

	/**
	 * 检查是否正在从收藏模式切换到全部模式
	 */
	checkTransitioningFromFavoriteMode(): boolean {
		return this.isTransitioningFromFavoriteMode;
	}

	/**
	 * 重置模式切换标记
	 */
	resetModeTransitionFlags(): void {
		this.isTransitioningToFavoriteMode = false;
		this.isTransitioningFromFavoriteMode = false;
	}

	/**
	 * 获取完整文件路径
	 */
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
		// 防止并发同步
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

		// 声明在方法作用域内，以便在末尾日志中访问
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
			// 1. 获取云端数据和指纹
			let remoteData = await this.getCachedRemoteData();
			let remoteFingerprints =
				await this.metadataManager.downloadFingerprints();

			// 检测数据不一致并修复
			if (
				(!remoteData?.items?.length || remoteData.items.length === 0) &&
				remoteFingerprints.size > 0
			) {
				remoteData = await this.refreshRemoteDataCache();
				this.metadataManager.clearFingerprintCache();
				remoteFingerprints = await this.metadataManager.downloadFingerprints();
			}

			// 确保远程数据和指纹数据的一致性
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

			// 2. 获取本地数据
			const localLightweightData = await this.getLightweightLocalData(false);

			// 3. 比较差异，确定需要同步的项
			diffResult = await this.performSelectiveDiff(
				localLightweightData,
				remoteData,
				remoteFingerprints,
			);
			const { itemsToSync, itemsToDownload, deletedIds } = diffResult;

			// 4. 只对需要同步的数据进行完整处理和转换
			const fullLocalData = await this.convertToSyncItemsSelective(itemsToSync);

			// 5. 下载远程数据并合并
			if (remoteData && itemsToDownload.length > 0) {
				// 筛选出需要下载的远程数据项
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

				// 解决冲突
				if (conflicts.length > 0) {
					const resolvedConflicts =
						this.conflictResolver.resolveConflicts(conflicts);
					result.conflicts = resolvedConflicts;
				}

				// 更新本地数据
				const updateResult = await this.updateLocalData(mergedData);

				// 将致命错误添加到结果中
				if (updateResult.errors.length > 0) {
					result.errors.push(...updateResult.errors);
				}

				// 同步远程文件
				await this.fileSyncManager.syncRemoteFiles(mergedData);

				result.downloaded = itemsToDownload.length;
			}

			// 6. 上传本地变更
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

					// 删除远程文件包
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

						// 删除操作完成后，刷新缓存
						await this.refreshRemoteDataCacheWithRetry();
						this.metadataManager.clearFingerprintCache();
					}

					// 更新指纹数据
					const currentRemoteFingerprints =
						await this.metadataManager.downloadFingerprints();

					// 创建本地指纹映射
					const localFingerprints = new Map<string, DataFingerprint>();
					for (const item of fullLocalData) {
						localFingerprints.set(
							item.id,
							this.metadataManager.generateFingerprint(item),
						);
					}

					// 从远程指纹中移除已删除的项目
					for (const deletedId of deletedIds) {
						currentRemoteFingerprints.delete(deletedId);
					}

					// 合并本地指纹到远程指纹中
					for (const [id, fp] of localFingerprints) {
						currentRemoteFingerprints.set(id, fp);
					}

					// 上传合并后的指纹数据
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

			// 7. 更新元数据
			await this.updateMetadata();

			// 8. 清理已同步的软删除项
			if (deletedIds.length > 0) {
				await this.permanentlyDeleteItems(deletedIds);
			}

			// 只考虑致命错误，忽略非致命错误
			const fatalErrors = result.errors.filter((error) =>
				this.isFatalError(error),
			);

			result.success = fatalErrors.length === 0;
			this.lastSyncTime = Date.now();

			// 重置模式切换标记
			if (
				this.isTransitioningToFavoriteMode ||
				this.isTransitioningFromFavoriteMode
			) {
				this.resetModeTransitionFlags();
			}

			// 触发界面刷新
			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (error) {
				const classification = this.classifyError(error);
				this.logError(classification, "界面刷新");

				// 界面刷新错误通常是非致命的
				if (this.isFatalError(error)) {
					result.errors.push(
						`界面刷新失败: ${error instanceof Error ? error.message : String(error)}`,
					);
				} else {
					// 非致命错误只记录日志，不添加到结果中
					// biome-ignore lint/suspicious/noConsoleLog: 允许在非致命错误处理时使用日志
					console.log("ℹ️ [SyncEngine] 界面刷新非致命错误:", {
						错误: error instanceof Error ? error.message : String(error),
						错误分类: classification.type,
						严重程度: classification.severity,
					});
				}
			}
		} catch (error) {
			const classification = this.classifyError(error);
			this.logError(classification, "同步过程");

			// 只有致命错误才添加到结果中
			if (this.isFatalError(error)) {
				result.errors.push(
					`同步异常: ${error instanceof Error ? error.message : String(error)}`,
				);
			} else {
				// 非致命错误只记录日志，不添加到结果中
				// biome-ignore lint/suspicious/noConsoleLog: 允许在非致命错误处理时使用日志
				console.log("ℹ️ [SyncEngine] 同步过程非致命错误:", {
					错误: error instanceof Error ? error.message : String(error),
					错误分类: classification.type,
					严重程度: classification.severity,
				});
			}
		} finally {
			this.syncInProgress = false;
		}

		result.duration = Date.now() - startTime;

		return result;
	}

	/**
	 * 轻量级获取本地数据，只获取基本信息用于比较
	 */
	private async getLightweightLocalData(
		includeDeletedForDetection = false,
	): Promise<any[]> {
		try {
			// 修复：在删除检测阶段，需要包含软删除的项
			const localRawData = await getHistoryData(includeDeletedForDetection);

			// 只进行基本的去重，不进行过滤（保留软删除项用于检测）
			const uniqueItems = this.deduplicateItems(localRawData as any[]);

			// 修复：分离删除检测和数据过滤逻辑
			let filteredItems = uniqueItems;

			// 如果不是删除检测阶段，才进行同步模式过滤
			if (!includeDeletedForDetection) {
				filteredItems = this.filterItemsBySyncMode(uniqueItems, false);
			} else {
				// 删除检测阶段，包含软删除项但仍然应用其他过滤条件
				filteredItems = this.filterItemsBySyncMode(uniqueItems, true);
			}

			// 只提取基本信息用于比较
			const lightweightData = filteredItems.map((item) => {
				// 修复：始终使用不包含收藏状态的校验和，确保收藏模式切换前后校验和一致
				// 这样可以避免收藏模式切换导致同一条数据被误判为新增项
				const checksum = calculateContentChecksum(item);

				return {
					id: item.id,
					type: item.type,
					value: item.value,
					createTime: item.createTime,
					lastModified: item.lastModified || Date.now(),
					favorite: item.favorite,
					deleted: item.deleted || false, // 确保包含软删除标记
					// 使用统一的校验和计算方式
					checksum,
				};
			});

			return lightweightData;
		} catch {
			return [];
		}
	}

	/**
	 * 选择性转换为同步项，只处理需要同步的数据
	 */
	private async convertToSyncItemsSelective(items: any[]): Promise<SyncItem[]> {
		const syncItems: SyncItem[] = [];

		// 分离文件项和非文件项
		const fileItems: any[] = [];
		const nonFileItems: any[] = [];

		for (const item of items) {
			if (item.type === "image" || item.type === "files") {
				fileItems.push(item);
			} else {
				nonFileItems.push(item);
			}
		}

		// 快速处理非文件项
		for (const item of nonFileItems) {
			try {
				const syncItem = this.convertToSyncItem(item);
				syncItems.push(syncItem);
			} catch {
				// 处理非文件项失败
			}
		}

		// 并行处理文件项（限制并发数）
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
					// 错误已在上层处理
				}
			})();

			fileProcessPromises.push(promise);

			// 控制并发数
			if (fileProcessPromises.length >= MAX_CONCURRENT_FILE_PROCESSING) {
				await Promise.race(fileProcessPromises);
				// 移除已完成的promise
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

		// 等待所有文件处理完成
		await Promise.allSettled(fileProcessPromises);

		return syncItems;
	}

	/**
	 * 执行选择性差异检测 - 修复版本，基于用户实际删除操作而不是简单的数据条目数对比
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

		// 修复：获取包含软删除项的完整数据用于删除检测
		const localDataWithDeleted = await this.getLightweightLocalData(true);

		// 修复：先检测本地删除操作，确保删除项不参与指纹比较
		const localDeletions = this.detectLocalDeletions(localDataWithDeleted);

		// 早期检测本地软删除操作

		// 将检测到的本地删除操作添加到删除列表
		for (const deletedId of localDeletions) {
			if (!deletedIds.includes(deletedId)) {
				deletedIds.push(deletedId);
			}
		}

		// 生成本地指纹
		const localFingerprints = new Map<string, DataFingerprint>();
		for (const item of localData) {
			// 修复：始终使用不包含收藏状态的校验和，确保收藏模式切换前后校验和一致
			// 这样可以避免收藏模式切换导致同一条数据被误判为新增项
			const checksum = calculateContentChecksum(item);

			// 生成本地指纹

			localFingerprints.set(item.id, {
				id: item.id,
				checksum,
				timestamp: item.lastModified || item.createTime,
				size:
					typeof item.value === "string"
						? item.value.length
						: JSON.stringify(item.value).length,
				type: item.type,
			});
		}

		// 修复：传递删除项信息和本地数据给指纹比较方法，确保删除项不参与比较并支持收藏状态变化检测
		const diff = this.metadataManager.compareFingerprints(
			localFingerprints,
			remoteFingerprints,
			localDeletions, // 传递删除项ID列表
			localData, // 传递本地数据项，用于检测收藏状态变化
		);

		// 差异检测完成

		// 校验和一致性检查完成

		// 修复：验证删除项是否正确地从指纹比较中排除
		const deletedItemsInUnchanged = diff.unchanged.filter((id) =>
			localDeletions.includes(id),
		);
		if (deletedItemsInUnchanged.length > 0) {
			// 检测到删除项被错误归类为未变更项
		}

		// 如果指纹数据完整且远程数据为空，优先使用指纹数据
		let effectiveRemoteData = remoteData;
		if (
			remoteFingerprints.size > 0 &&
			(!remoteData?.items || remoteData.items.length === 0)
		) {
			// 基于指纹数据重建远程数据项的基本信息
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

			// 使用重建的远程数据进行后续处理
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

		// 修复：优化模式切换时的数据处理，避免收藏状态变化被误判为内容修改
		// 特别处理从收藏模式切换到全部模式的情况
		const isTransitioningFromFavorite =
			this.checkTransitioningFromFavoriteMode();

		// 确定需要上传的项
		for (const fp of [...diff.added, ...diff.modified]) {
			const item = localData.find((i) => i.id === fp.id);
			if (item) {
				// 检查是否是收藏状态变更项
				const isFavoriteChange =
					diff.favoriteChanged?.includes(item.id) || false;

				// 修复：在收藏模式下，检查是否是收藏状态变更
				if (this.syncModeConfig?.settings.onlyFavorites && !item.favorite) {
					if (isFavoriteChange) {
						// 收藏模式下同步收藏状态变更
						itemsToSync.push(item);
					} else {
						// 收藏模式下跳过非收藏项上传
						// 修复：跳过非收藏项，不添加到同步列表，确保完全过滤
						// 不添加到itemsToSync，自然跳过后续处理
					}
				}
				// 修复：从收藏模式切换到全部模式时的特殊处理
				else if (isTransitioningFromFavorite && isFavoriteChange) {
					// 从收藏模式切换到全部模式，处理收藏状态变化
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

		// 删除检测已在指纹比较前完成

		// 删除检测已完全基于软删除标记

		// 在处理远程数据前，先移除已标记为删除的项目，避免操作冲突
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

			// 修复：当本地数据库为空时，需要特殊处理收藏模式切换
			const isLocalDatabaseEmpty = localData.length === 0;
			const isFavoriteMode = this.syncModeConfig?.settings.onlyFavorites;

			if (isLocalDatabaseEmpty && effectiveRemoteData?.items?.length > 0) {
				for (const remoteItem of effectiveRemoteData.items) {
					if (
						!itemsToDownload.includes(remoteItem.id) &&
						!deletedIds.includes(remoteItem.id)
					) {
						// 修复：在收藏模式切换时，避免下载远程数据覆盖本地收藏状态
						let shouldDownload = true;

						// 如果是从全部模式切换到收藏模式，需要特别处理
						if (this.checkTransitioningToFavoriteMode()) {
							// 在收藏模式切换时，完全跳过下载远程数据，避免覆盖本地状态
							shouldDownload = false;

							// 收藏模式切换，跳过所有远程数据下载
						}
						// 修复：收藏模式下，如果本地数据为空，需要特殊处理
						else if (isFavoriteMode) {
							// 收藏模式下，本地数据为空表示用户已取消所有收藏
							// 这种情况下，不应该下载任何远程数据，避免覆盖用户的取消收藏操作
							shouldDownload = false;

							// 收藏模式下本地为空，跳过所有远程数据下载
						}

						if (shouldDownload) {
							itemsToDownload.push(remoteItem.id);

							// 标记远程项为需要下载
						}
					}
				}
			}

			// 对于修改的项，需要比较时间戳决定是否下载
			for (const fp of filteredDiff.modified) {
				// 如果该项已经被标记为本地删除，则不再处理
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
							remoteItem.lastModified || remoteItem.createTime,
						).getTime();

						// 修复：在收藏模式切换时，优先保留本地收藏状态
						let shouldDownload = remoteTime > localTime;

						// 如果是从全部模式切换到收藏模式，需要特殊处理收藏状态
						if (this.checkTransitioningToFavoriteMode()) {
							// 在收藏模式切换时，完全跳过下载远程数据，避免覆盖本地状态
							shouldDownload = false;

							// 收藏模式切换，跳过远程数据下载
						}

						// 只有当需要下载且不会被同时标记为上传和下载时才添加到下载列表
						if (
							shouldDownload &&
							!itemsToSync.some((item) => item.id === fp.id)
						) {
							itemsToDownload.push(fp.id);

							// 标记修改项为需要下载
						}
					}
				}
			}
		}

		// 最终同步操作统计完成

		// 更新本地快照
		this.updateLocalSnapshot(
			localData.map((item) => ({
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
				size:
					typeof item.value === "string"
						? item.value.length
						: JSON.stringify(item.value).length,
				checksum: item.checksum,
			})),
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
			// 检测到操作冲突，开始解决

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

			// 对于收藏状态变化的项，需要确保它们被正确处理
			// 这些项不应该被标记为需要上传，因为只是收藏状态变化
			for (const itemId of diff.favoriteChanged) {
				// 检查该项是否在待上传列表中
				const uploadIndex = itemsToSync.findIndex((item) => item.id === itemId);
				if (uploadIndex !== -1) {
					// 如果该项已经在待上传列表中，检查是否只是收藏状态变化
					const item = itemsToSync[uploadIndex];
					const localItem = localData.find((i) => i.id === itemId);

					if (localItem) {
						// 重新计算包含收藏状态的校验和
						const favoriteAwareChecksum = calculateUnifiedChecksum(
							localItem,
							false,
							true,
						);

						// 更新本地指纹中的校验和
						const localFp = localFingerprints.get(itemId);
						if (localFp) {
							localFp.checksum = favoriteAwareChecksum;
						}

						// biome-ignore lint/suspicious/noConsoleLog: 允许在收藏状态处理时使用日志
						console.log("⭐ [SyncEngine] 更新收藏状态变化项的校验和:", {
							项ID: itemId,
							项类型: item.type,
							收藏状态: localItem.favorite,
							原校验和: item.checksum,
							新校验和: favoriteAwareChecksum,
						});
					}
				}
			}
		}

		return { itemsToSync, itemsToDownload, deletedIds };
	}

	/**
	 * 检查是否需要检测收藏状态变化
	 * 修复：简化方法，现在收藏状态变化检测已在compareFingerprints中完成
	 */
	private shouldCheckFavoriteChanges(): boolean {
		// 如果当前是收藏模式，或者最近切换过收藏模式，则需要检测收藏状态变化
		return !!this.syncModeConfig?.settings.onlyFavorites;
	}

	/**
	 * 去重处理
	 */
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

	/**
	 * 根据同步模式过滤项
	 * 修复：添加一个选项来控制是否过滤软删除项，用于删除检测阶段
	 * 修复：增加对模式切换的特殊处理
	 * 修复：收藏模式下只同步收藏项到远程，但允许收藏状态变更同步
	 * 修复：确保收藏模式下非收藏项被完全过滤掉，避免重复处理
	 * 修复：优化收藏模式下的同步策略，只上传不下载
	 */
	private filterItemsBySyncMode(
		items: any[],
		includeDeleted = false,
		_handleModeTransition = false, // 重命名避免未使用警告
		syncFavoriteChanges = false, // 重命名参数：是否同步收藏状态变更
	): any[] {
		if (!this.syncModeConfig?.settings) {
			return items;
		}

		const settings = this.syncModeConfig.settings;

		return items.filter((item) => {
			// 修复：只有在非删除检测阶段才过滤掉已标记为软删除的项
			// 修复：使用双重检查确保能正确识别数据库中存储为数字1的软删除标记
			if (
				!includeDeleted &&
				(item.deleted === true || (item.deleted as any) === 1)
			) {
				return false;
			}

			// 修复：收藏模式下的特殊处理
			if (settings.onlyFavorites) {
				// 如果是专门同步收藏状态变更，则允许非收藏项通过
				if (syncFavoriteChanges) {
					// biome-ignore lint/suspicious/noConsoleLog: 允许在关键过滤逻辑时使用日志
					console.log("⭐ [SyncEngine] 收藏模式下同步收藏状态变更:", {
						项ID: item.id,
						项类型: item.type,
						收藏状态: item.favorite,
						处理方式: "允许通过，用于同步收藏状态变更",
					});
					return true;
				}

				// 修复：在收藏模式切换时，允许所有项通过过滤但不上传到远程
				if (this.checkTransitioningToFavoriteMode()) {
					// biome-ignore lint/suspicious/noConsoleLog: 允许在关键过滤逻辑时使用日志
					console.log("⭐ [SyncEngine] 收藏模式切换，允许项通过本地过滤:", {
						项ID: item.id,
						项类型: item.type,
						收藏状态: item.favorite,
						处理方式: "允许通过本地过滤，但不会上传到远程",
					});
					return true;
				}

				// 修复：正常收藏模式下，只同步收藏项到远程
				// 修复：确保收藏模式下非收藏项被完全过滤掉，避免重复处理
				if (!item.favorite) {
					// biome-ignore lint/suspicious/noConsoleLog: 允许在关键过滤逻辑时使用日志
					console.log("⭐ [SyncEngine] 收藏模式下过滤非收藏项:", {
						项ID: item.id,
						项类型: item.type,
						收藏状态: item.favorite,
						处理方式: "完全过滤掉，避免重复处理",
					});

					// 收藏模式下，非收藏项不应该被同步到远程
					// 修复：确保非收藏项被完全过滤掉，避免在后续同步中被重复处理
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
		});
	}

	/**
	 * 转换为同步项
	 * 修复：始终使用不包含收藏状态的校验和，确保收藏模式切换前后校验和一致
	 */
	private convertToSyncItem(item: any): SyncItem {
		// 修复：始终使用不包含收藏状态的校验和，确保收藏模式切换前后校验和一致
		// 这样可以避免收藏模式切换导致同一条数据被误判为新增项
		const checksum = item.checksum || calculateContentChecksum(item);

		// 计算数据大小
		let size: number;
		if (item.type === "image" || item.type === "files") {
			// 对于文件项，使用value字段的长度
			size =
				typeof item.value === "string"
					? item.value.length
					: JSON.stringify(item.value).length;
		} else {
			// 对于其他类型，使用整个对象的JSON字符串长度
			size = JSON.stringify(item).length;
		}

		// 转换为同步项

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
			deleted: item.deleted || false, // 确保包含软删除标记
		};
	}

	/**
	 * 下载远程数据
	 */
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

	/**
	 * 上传同步数据
	 */
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

	/**
	 * 更新本地数据
	 */
	private async updateLocalData(
		data: SyncItem[],
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const errors: string[] = [];
		let successCount = 0;
		let failedCount = 0;

		// 开始更新本地数据

		for (const item of data) {
			try {
				await this.insertOrUpdateItem(item);
				successCount++;

				// 项更新成功
			} catch (error) {
				failedCount++;
				const errorMsg = `更新本地数据失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`;

				// 使用错误分类系统处理错误
				const classification = this.classifyError(error);
				this.logError(classification, "本地数据更新");

				// 只有致命错误才添加到错误列表中
				if (this.isFatalError(error)) {
					errors.push(errorMsg);
				}

				// 项更新失败
			}
		}

		// 本地数据更新完成

		// 返回详细的更新结果
		return { success: successCount, failed: failedCount, errors };
	}

	/**
	 * 插入或更新项
	 */
	private async insertOrUpdateItem(item: SyncItem): Promise<void> {
		try {
			const localItem: any = {
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
			};

			// 检查项是否已存在

			// 检查是否已存在
			const existingRecords = (await selectSQL("history", {
				type: item.type,
				value: item.value,
			})) as any[];

			// 数据库查询结果

			if (existingRecords && existingRecords.length > 0) {
				const existing = existingRecords[0];
				const updateItem = {
					...localItem,
					id: existing.id,
					favorite: this.resolveFavoriteStatus(existing, item),
					count: Math.max(existing.count || 0, item.count || 0),
					createTime: existing.createTime,
				};

				// 更新现有项

				await updateSQL("history", updateItem);

				// 项更新成功
			} else {
				// 插入新项

				await this.insertForSync("history", localItem);

				// 项插入成功
			}
		} catch (error) {
			// 插入或更新项失败
			void error; // 避免未使用变量警告

			// 重新抛出错误，让上层处理
			throw new Error(
				`插入或更新项失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * 解决收藏状态冲突
	 * 修复：优先保留本地收藏状态，避免远程数据覆盖本地的收藏状态变更
	 */
	private resolveFavoriteStatus(existing: any, incoming: SyncItem): boolean {
		const existingIsFavorite =
			existing.favorite === true || existing.favorite === 1;
		const incomingIsFavorite = incoming.favorite;

		// 解决收藏状态冲突
		let result: boolean;
		let strategy: string;

		// 修复：在收藏模式切换时，完全忽略远程收藏状态
		if (this.checkTransitioningToFavoriteMode()) {
			// 从全部模式切换到收藏模式，完全忽略远程收藏状态
			result = existingIsFavorite;
			strategy = "从全部模式切换到收藏模式，完全忽略远程收藏状态，保持本地状态";
		} else if (this.checkTransitioningFromFavoriteMode()) {
			// 从收藏模式切换到全部模式，完全忽略远程收藏状态
			result = existingIsFavorite;
			strategy = "从收藏模式切换到全部模式，完全忽略远程收藏状态，保持本地状态";
		} else {
			// 正常情况下的收藏状态处理
			// 修复：优先保留本地收藏状态，特别是当本地取消收藏时
			// 这解决了用户取消收藏后，远程数据覆盖本地状态的问题
			if (!existingIsFavorite && incomingIsFavorite) {
				// 本地未收藏，远程收藏 - 优先保留本地的未收藏状态
				result = false;
				strategy =
					"本地取消收藏，优先保留本地未收藏状态，避免远程收藏数据覆盖本地状态";
			} else if (existingIsFavorite && !incomingIsFavorite) {
				// 本地收藏，远程未收藏 - 保持本地收藏状态
				result = true;
				strategy = "本地收藏，保持本地收藏状态";
			} else if (existingIsFavorite && incomingIsFavorite) {
				// 双方都是收藏 - 保持收藏状态
				result = true;
				strategy = "双方都是收藏，保持收藏状态";
			} else {
				// 双方都未收藏 - 保持未收藏状态
				result = false;
				strategy = "双方都未收藏，保持未收藏状态";
			}

			// 修复：在收藏模式下，特别强化本地收藏状态的优先级
			if (this.syncModeConfig?.settings.onlyFavorites) {
				// 在收藏模式下，如果本地未收藏，强制保持未收藏状态
				// 这样可以避免远程收藏数据覆盖本地的取消收藏操作
				if (!existingIsFavorite) {
					result = false;
					strategy = "收藏模式下强制保持本地未收藏状态，避免远程收藏数据覆盖";
				}
			}
		}

		// 修复：只有在收藏状态完全相同的情况下，才考虑时间戳
		// 这样可以避免时间戳比较导致的收藏状态覆盖问题
		if (existingIsFavorite === incomingIsFavorite) {
			const existingTime = new Date(
				existing.lastModified || existing.createTime,
			).getTime();
			const incomingTime = new Date(
				incoming.lastModified || incoming.createTime,
			).getTime();

			// 如果收藏状态相同，但时间戳不同，记录但不改变收藏状态
			if (existingTime !== incomingTime) {
				// 收藏状态相同但时间戳不同
			}
		}

		// 收藏状态冲突解决结果
		// 使用strategy变量避免未使用警告
		void strategy;

		return result;
	}

	/**
	 * 用于同步的插入操作
	 */
	private async insertForSync(tableName: string, item: any): Promise<void> {
		try {
			const { insertWithDeduplicationForSync } = await import("@/database");
			await insertWithDeduplicationForSync(tableName as any, item);
		} catch (error) {
			// 重新抛出错误，让上层处理
			throw new Error(
				`插入数据失败 (表: ${tableName}, ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * 更新元数据
	 */
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

	/**
	 * 获取同步状态
	 */
	getSyncStatus() {
		return {
			isOnline: this.isOnline,
			isSyncing: false,
			lastSyncTime: this.lastSyncTime,
			pendingCount: 0,
			errorCount: 0,
			syncProgress: 0,
		};
	}

	/**
	 * 获取缓存的本地数据
	 */

	/**
	 * 获取缓存的远程数据
	 */
	private async getCachedRemoteData(
		forceRefresh = false,
	): Promise<SyncData | null> {
		const now = Date.now();

		// 检查缓存是否有效
		if (
			!forceRefresh &&
			this.lastRemoteData &&
			now - this.lastRemoteDataTime < this.REMOTE_DATA_TTL
		) {
			return this.lastRemoteData;
		}

		// 重新获取数据
		const remoteData = await this.downloadRemoteData();

		// 更新缓存
		this.lastRemoteData = remoteData;
		this.lastRemoteDataTime = now;

		return remoteData;
	}

	/**
	 * 刷新远程数据缓存 - 确保获取最新的远程数据
	 */
	private async refreshRemoteDataCache(): Promise<SyncData | null> {
		return await this.getCachedRemoteData(true);
	}

	/**
	 * 带重试机制的远程数据缓存刷新 - 专门用于删除操作后
	 */
	private async refreshRemoteDataCacheWithRetry(): Promise<SyncData | null> {
		const maxRetries = 3;
		let retryDelay = 1000; // 1秒延迟

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			// 强制刷新远程数据
			const remoteData = await this.getCachedRemoteData(true);

			// 检查数据是否有效
			if (remoteData?.items && remoteData.items.length > 0) {
				return remoteData;
			}

			// 如果数据为空，尝试使用指纹数据验证
			const remoteFingerprints =
				await this.metadataManager.downloadFingerprints();
			if (remoteFingerprints.size > 0) {
				// 如果是最后一次尝试，尝试从指纹数据重建远程数据
				if (attempt === maxRetries) {
					const rebuiltData =
						await this.rebuildSyncDataFromFingerprints(remoteFingerprints);
					if (rebuiltData) {
						// 更新缓存
						this.lastRemoteData = rebuiltData;
						this.lastRemoteDataTime = Date.now();
						return rebuiltData;
					}
				}
			}

			// 如果不是最后一次尝试，等待后重试
			if (attempt < maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
				// 增加延迟时间，指数退避
				retryDelay *= 2;
			}
		}

		return null;
	}

	/**
	 * 从指纹数据重建同步数据
	 */
	private async rebuildSyncDataFromFingerprints(
		fingerprints: Map<string, DataFingerprint>,
	): Promise<SyncData | null> {
		if (!fingerprints || fingerprints.size === 0) {
			return null;
		}

		try {
			// 创建基本的同步数据结构
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

			// 从指纹数据重建基本的项目信息
			for (const [id, fingerprint] of fingerprints) {
				const basicItem: SyncItem = {
					id,
					type: fingerprint.type as "text" | "image" | "files" | "html" | "rtf",
					value: "", // 指纹数据不包含完整内容
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

			// 计算校验和
			syncData.checksum = calculateStringChecksum(
				JSON.stringify(syncData.items),
			);

			return syncData;
		} catch {
			return null;
		}
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.lastRemoteData = null;
		this.lastRemoteDataTime = 0;
		// 修复：同时清除指纹缓存
		this.metadataManager.clearFingerprintCache();
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
				// 重建指纹失败，跳过该项
			}
		}

		return fingerprints;
	}

	/**
	 * 检查是否可以同步
	 */
	canSync(): boolean {
		return this.isOnline && !!this.webdavConfig && !this.syncInProgress;
	}

	/**
	 * 获取上次本地快照大小
	 */
	getLastLocalSnapshotSize(): number {
		return this.lastLocalSnapshot.size;
	}

	/**
	 * 更新本地快照
	 */
	private updateLocalSnapshot(localData: SyncItem[]): void {
		const newSnapshot = new Map<string, DataFingerprint>();
		for (const item of localData) {
			newSnapshot.set(item.id, this.metadataManager.generateFingerprint(item));
		}
		this.lastLocalSnapshot = newSnapshot;
	}

	/**
	 * 检查项是否在本地快照中
	 */
	isInLocalSnapshot(itemId: string): boolean {
		return this.lastLocalSnapshot.has(itemId);
	}

	/**
	 * 检测本地删除操作（供IncrementalSyncManager调用）
	 * 修复：基于软删除标记检测删除操作，而不是基于数据差异
	 */
	detectLocalDeletions(currentLocalData: SyncItem[]): string[] {
		const deletedIds: string[] = [];

		// 遍历当前本地数据，查找标记为删除的项
		for (const item of currentLocalData) {
			// 修复：使用双重检查确保能正确识别数据库中存储为数字1的软删除标记
			if (item.deleted === true || (item.deleted as any) === 1) {
				deletedIds.push(item.id);

				// 检测到软删除项
			}
		}

		// 软删除检测完成

		return deletedIds;
	}

	/**
	 * 标记项为软删除
	 * 当用户删除数据时调用此方法，而不是直接从数据库删除
	 */
	async markItemAsDeleted(itemId: string): Promise<boolean> {
		try {
			// 标记项为软删除

			// 更新数据库中的删除标记
			await updateSQL("history", {
				id: itemId,
				deleted: true, // 标记为软删除
			});

			return true;
		} catch (error) {
			// 标记软删除失败
			void error; // 避免未使用变量警告
			return false;
		}
	}

	/**
	 * 彻底删除已标记为软删除的项
	 * 在同步完成后调用此方法清理本地数据
	 */
	async permanentlyDeleteItems(itemIds: string[]): Promise<void> {
		if (itemIds.length === 0) {
			return;
		}

		try {
			// 彻底删除已同步的软删除项

			// 使用新的数据库删除函数，真正从数据库中删除这些项
			const { deleteFromDatabase } = await import("@/database");
			const result = await deleteFromDatabase("history", itemIds);

			// 彻底删除操作完成

			// 如果有失败的删除操作，记录但不抛出异常
			if (result.failed > 0) {
				// 部分删除操作失败
			}
		} catch (error) {
			// 彻底删除失败
			void error; // 避免未使用变量警告
		}
	}

	/**
	 * 删除远程文件包
	 */
	private async deleteRemoteFiles(
		deletedIds: string[],
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const results = { success: 0, failed: 0, errors: [] as string[] };

		if (!this.webdavConfig || deletedIds.length === 0) {
			return results;
		}

		try {
			// 获取远程指纹数据以确定哪些是文件项
			const remoteFingerprints =
				await this.metadataManager.downloadFingerprints();

			const filePackagesToDelete: any[] = [];

			// 筛选出需要删除的文件包
			for (const deletedId of deletedIds) {
				const fingerprint = remoteFingerprints.get(deletedId);
				if (
					fingerprint &&
					(fingerprint.type === "image" || fingerprint.type === "files")
				) {
					// 构造包信息
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
			// 使用错误分类系统处理错误
			const classification = this.classifyError(error);
			this.logError(classification, "远程文件删除");

			// 只有致命错误才添加到错误列表中
			if (this.isFatalError(error)) {
				results.errors.push(
					`删除远程文件失败: ${error instanceof Error ? error.message : String(error)}`,
				);
			} else {
				// 远程文件删除非致命错误
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
