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
import { emit } from "@tauri-apps/api/event";

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
			// 下载元数据失败
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
			// 上传元数据失败
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
			// 下载指纹数据失败
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
			// 上传指纹数据失败
		}

		return false;
	}

	/**
	 * 生成数据指纹
	 */
	generateFingerprint(item: SyncItem): DataFingerprint {
		// 修复：对于图片和文件项，使用原始value计算校验和，而不是JSON.stringify整个对象
		let checksumSource: string;
		if (item.type === "image" || item.type === "files") {
			// 对于文件项，只使用value字段计算校验和，避免因为_syncType等字段的变化导致误判
			checksumSource =
				typeof item.value === "string"
					? item.value
					: JSON.stringify(item.value);
		} else {
			// 对于其他类型，使用整个对象的JSON字符串
			checksumSource = JSON.stringify(item);
		}

		return {
			id: item.id,
			checksum: item.checksum || calculateStringChecksum(checksumSource),
			timestamp: item.lastModified || Date.now(),
			size: item.size || checksumSource.length,
			type: item.type,
		};
	}

	/**
	 * 比较指纹差异
	 */
	compareFingerprints(
		local: Map<string, DataFingerprint>,
		remote: Map<string, DataFingerprint>,
	): {
		added: DataFingerprint[];
		modified: DataFingerprint[];
		deleted: string[];
		unchanged: string[];
	} {
		const added: DataFingerprint[] = [];
		const modified: DataFingerprint[] = [];
		const deleted: string[] = [];
		const unchanged: string[] = [];

		// 检查本地新增和修改的项
		for (const [id, localFp] of local) {
			const remoteFp = remote.get(id);
			if (!remoteFp) {
				added.push(localFp);
				// 移除详细的新增项日志
			} else {
				// 修复：对于文件项，需要特殊处理校验和比较
				if (localFp.type === "image" || localFp.type === "files") {
					// 对于文件项，如果校验和不匹配，记录详细信息
					if (localFp.checksum !== remoteFp.checksum) {
						// 移除详细的文件项变更日志
						modified.push(localFp);
					} else {
						unchanged.push(id);
						// 移除详细的文件项未变更日志
					}
				} else {
					// 对于非文件项，直接比较校验和
					if (localFp.checksum !== remoteFp.checksum) {
						// 移除详细的非文件项变更日志
						modified.push(localFp);
					} else {
						unchanged.push(id);
						// 移除详细的非文件项未变更日志
					}
				}
			}
		}

		// 检查删除的项
		// 移除删除检测开始日志

		// 记录远程数据中但本地数据中没有的项
		const potentialDeletions: string[] = [];
		for (const [id] of remote) {
			if (!local.has(id)) {
				potentialDeletions.push(id);
			}
		}

		// 确认删除项
		for (const id of potentialDeletions) {
			deleted.push(id);
			// 移除详细的确认删除项日志
		}

		// 移除详细的删除检测完成日志

		return { added, modified, deleted, unchanged };
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

		// 修复：如果远程指纹数据为空，尝试多种方式获取
		if (remoteFingerprints.size === 0) {
			// 1. 首先尝试从缓存获取
			const cachedFingerprints = this.metadataManager.getCachedFingerprints();
			if (cachedFingerprints.size > 0) {
				remoteFingerprints = new Map(cachedFingerprints);
			} else {
				// 2. 如果缓存也为空，尝试从远程数据重建指纹
				const remoteData = await this.syncEngine.downloadRemoteData();
				if (remoteData?.items?.length) {
					remoteFingerprints =
						await this.rebuildFingerprintsFromRemoteData(remoteData);
					if (remoteFingerprints.size > 0) {
						// 上传重建的指纹数据
						await this.metadataManager.uploadFingerprints(remoteFingerprints);
					}
				}
			}
		}

		// 3. 比较差异
		const diff = this.metadataManager.compareFingerprints(
			localFingerprints,
			remoteFingerprints,
		);
		statistics.addedItems = diff.added.length;
		statistics.modifiedItems = diff.modified.length;
		statistics.deletedItems = diff.deleted.length;
		statistics.skippedItems = diff.unchanged.length;

		// 4. 筛选需要同步的项
		const itemsToSync: SyncItem[] = [];
		const deletedIds: string[] = [];

		// 添加新增和修改的项
		for (const fp of [...diff.added, ...diff.modified]) {
			const item = localData.find((i) => i.id === fp.id);
			if (item && this.shouldSyncItem(item, syncModeConfig)) {
				itemsToSync.push(item);
			}
		}

		// 添加远程检测到的删除项
		deletedIds.push(...diff.deleted);

		// 检测本地删除操作（基于上次快照）
		if (this.syncEngine.getLastLocalSnapshotSize() > 0) {
			const localDeletions = this.syncEngine.detectLocalDeletions(localData);
			for (const deletedId of localDeletions) {
				if (!deletedIds.includes(deletedId)) {
					deletedIds.push(deletedId);
				}
			}
		}

		// 5. 创建同步数据
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

		// 6. 更新统计信息
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
	): boolean {
		if (!syncModeConfig?.settings) return true;

		const settings = syncModeConfig.settings;

		// 收藏模式检查
		if (settings.onlyFavorites && !item.favorite) {
			return false;
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

		// 处理删除的项
		const deletedIds = remoteData.deleted || [];
		for (const deletedId of deletedIds) {
			localMap.delete(deletedId);
		}

		// 处理新增和修改的项
		for (const remoteItem of remoteData.items) {
			const localItem = localMap.get(remoteItem.id);

			if (!localItem) {
				// 新增项
				mergedData.push(remoteItem);
			} else {
				// 检查冲突
				const localTime = new Date(localItem.createTime).getTime();
				const remoteTime = new Date(remoteItem.createTime).getTime();

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
					// 有冲突
					const conflict: ConflictInfo = {
						itemId: remoteItem.id,
						type: "modify",
						localVersion: localItem,
						remoteVersion: remoteItem,
						resolution: remoteTime > localTime ? "remote" : "local",
						reason: "内容冲突",
					};
					conflicts.push(conflict);

					// 使用时间戳较新的版本
					if (remoteTime > localTime) {
						mergedData.push(remoteItem);
					} else {
						mergedData.push(localItem);
					}
				} else {
					// 无冲突，使用本地版本
					mergedData.push(localItem);
				}
			}

			// 从本地映射中移除已处理的项
			localMap.delete(remoteItem.id);
		}

		// 添加剩余的本地项（未被远程数据影响的项）
		for (const localItem of localMap.values()) {
			mergedData.push(localItem);
		}

		return { mergedData, conflicts };
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

		const errors: string[] = [];

		for (const item of packageItems) {
			try {
				let packageInfo: any;
				try {
					packageInfo = JSON.parse(item.value);
				} catch {
					continue;
				}

				const syncResult = await filePackageManager.syncFilesIntelligently(
					packageInfo,
					this.webdavConfig,
				);

				if (syncResult.hasChanges) {
					// 更新本地数据库中的文件路径
					try {
						await this.updateFilePathsInDatabase(item.id, syncResult.paths);
					} catch (dbError) {
						const errorMsg = `更新数据库失败 (ID: ${item.id}): ${dbError instanceof Error ? dbError.message : String(dbError)}`;
						errors.push(errorMsg);
					}
				} else {
				}
			} catch {
				errors.push(`同步远程文件失败 (ID: ${item.id})`);

				// 即使单个文件同步失败，也继续处理其他文件
				// 这样可以避免单个文件处理失败影响整个同步流程
			}
		}

		// 如果有错误，记录但不中断整个流程
		if (errors.length > 0) {
		}
	}

	/**
	 * 更新数据库中的文件路径
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
		this.syncModeConfig = config;
		this.fileSyncManager.setSyncModeConfig(config);
	}

	/**
	 * 获取设备ID
	 */
	getDeviceId(): string {
		return this.deviceId;
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
	 * 执行双向同步 - 重构后的高效同步流程
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
			// 1. 优先获取云端数据和指纹，避免不必要的本地数据处理
			let remoteData = await this.getCachedRemoteData();
			let remoteFingerprints =
				await this.metadataManager.downloadFingerprints();

			// 修复：检测远程数据缓存问题，如果远程数据为空但指纹数据不为空，强制刷新缓存
			if (
				(!remoteData?.items?.length || remoteData.items.length === 0) &&
				remoteFingerprints.size > 0
			) {
				remoteData = await this.refreshRemoteDataCache();

				// 修复：强制清除指纹缓存并重新获取指纹数据以确保一致性
				this.metadataManager.clearFingerprintCache();
				remoteFingerprints = await this.metadataManager.downloadFingerprints();
			}

			// 修复：确保远程数据和指纹数据的一致性
			if (remoteData?.items?.length && remoteFingerprints.size === 0) {
				// 修复：强制清除指纹缓存，确保获取最新数据
				this.metadataManager.clearFingerprintCache();
				const retryFingerprints =
					await this.metadataManager.downloadFingerprints();
				if (retryFingerprints.size > 0) {
					// 如果重新获取成功，更新remoteFingerprints引用
					remoteFingerprints = retryFingerprints;
				} else {
					// 修复：如果仍然无法获取指纹数据，尝试从远程数据重建指纹
					remoteFingerprints =
						await this.rebuildFingerprintsFromRemoteData(remoteData);
					if (remoteFingerprints.size > 0) {
						// 上传重建的指纹数据
						await this.metadataManager.uploadFingerprints(remoteFingerprints);
					}
				}
			}

			// 2. 轻量级获取本地数据，只获取基本信息用于比较
			const localLightweightData = await this.getLightweightLocalData();

			// 3. 快速比较差异，确定需要同步的项
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
				await this.updateLocalData(mergedData);

				// 同步远程文件
				await this.fileSyncManager.syncRemoteFiles(mergedData);

				result.downloaded = itemsToDownload.length;
			}

			// 6. 上传本地变更
			if (itemsToSync.length > 0 || deletedIds.length > 0) {
				// 修复：只上传真正需要同步的项目，而不是所有本地数据
				// fullLocalData 已经是经过选择性处理的数据，只包含需要同步的项目
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
					// 修复：使用实际需要上传的项目数作为上传计数
					result.uploaded = actualUploadCount;

					// 删除远程文件包
					if (deletedIds.length > 0) {
						const deleteResult = await this.deleteRemoteFiles(deletedIds);

						if (deleteResult.failed > 0) {
							result.errors.push(
								`部分远程文件包删除失败: ${deleteResult.failed} 个`,
							);
						}

						// 删除操作完成后，刷新缓存
						await this.refreshRemoteDataCacheWithRetry();
						this.metadataManager.clearFingerprintCache();
					}

					// 更新指纹数据
					// 修复：重新获取最新的远程指纹数据，然后合并本地指纹
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

					// 修复：从远程指纹中移除已删除的项目
					for (const deletedId of deletedIds) {
						currentRemoteFingerprints.delete(deletedId);
					}

					// 合并本地指纹到远程指纹中
					for (const [id, fp] of localFingerprints) {
						currentRemoteFingerprints.set(id, fp);
					}

					// 上传合并后的指纹数据
					const uploadSuccess = await this.metadataManager.uploadFingerprints(
						currentRemoteFingerprints,
					);
					if (!uploadSuccess) {
						result.errors.push("指纹数据上传失败");
					}
				} else {
					result.errors.push("上传同步数据失败");
				}
			}

			// 7. 更新元数据
			await this.updateMetadata();

			result.success = result.errors.length === 0;
			this.lastSyncTime = Date.now();

			// 触发界面刷新
			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch {
				result.errors.push("界面刷新失败");
			}
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

	/**
	 * 轻量级获取本地数据，只获取基本信息用于比较
	 */
	private async getLightweightLocalData(): Promise<any[]> {
		try {
			// 直接从数据库获取原始数据，不进行完整转换
			const localRawData = await getHistoryData();

			// 只进行基本的去重和过滤，不进行文件处理
			const uniqueItems = this.deduplicateItems(localRawData as any[]);
			const filteredItems = this.filterItemsBySyncMode(uniqueItems);

			// 只提取基本信息用于比较
			const lightweightData = filteredItems.map((item) => ({
				id: item.id,
				type: item.type,
				value: item.value,
				createTime: item.createTime,
				lastModified: item.lastModified || Date.now(),
				favorite: item.favorite,
				// 只计算基本校验和，不进行文件处理
				checksum: calculateStringChecksum(
					typeof item.value === "string"
						? item.value
						: JSON.stringify(item.value),
				),
			}));

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
	 * 执行选择性差异检测 - 优化版本，主要依赖指纹数据
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

		// 生成本地指纹
		const localFingerprints = new Map<string, DataFingerprint>();
		for (const item of localData) {
			localFingerprints.set(item.id, {
				id: item.id,
				checksum: item.checksum,
				timestamp: item.lastModified || item.createTime,
				size:
					typeof item.value === "string"
						? item.value.length
						: JSON.stringify(item.value).length,
				type: item.type,
			});
		}

		// 依赖指纹数据进行差异检测
		const diff = this.metadataManager.compareFingerprints(
			localFingerprints,
			remoteFingerprints,
		);

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

		// 确定需要上传的项
		for (const fp of [...diff.added, ...diff.modified]) {
			const item = localData.find((i) => i.id === fp.id);
			if (item) {
				itemsToSync.push(item);
			}
		}

		// 检测本地删除操作，确保删除操作优先
		if (this.getLastLocalSnapshotSize() > 0) {
			const localDeletions = this.detectLocalDeletions(localData);
			for (const deletedId of localDeletions) {
				if (!deletedIds.includes(deletedId)) {
					deletedIds.push(deletedId);
				}
			}
		}

		// 在处理远程数据前，先移除已标记为删除的项目，避免操作冲突
		const filteredLocalData = localData.filter(
			(item) => !deletedIds.includes(item.id),
		);
		const filteredDiff = {
			added: diff.added.filter((fp) => !deletedIds.includes(fp.id)),
			modified: diff.modified.filter((fp) => !deletedIds.includes(fp.id)),
			deleted: diff.deleted.filter((id) => !deletedIds.includes(id)),
			unchanged: diff.unchanged.filter((id) => !deletedIds.includes(id)),
		};

		// 确定需要下载和删除的项
		if (effectiveRemoteData) {
			const remoteIds = new Set(
				effectiveRemoteData.items.map((item) => item.id),
			);
			const remoteItemsMap = new Map(
				effectiveRemoteData.items.map((item) => [item.id, item]),
			);

			// 正确区分下载和删除操作，避免与本地删除冲突
			for (const deletedId of filteredDiff.deleted) {
				// 如果该项已经被标记为本地删除，则不再处理为下载
				if (deletedIds.includes(deletedId)) {
					continue;
				}

				if (remoteIds.has(deletedId)) {
					// 远程有该项，本地没有，且未被标记为本地删除，这是需要下载的新增项
					itemsToDownload.push(deletedId);
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

						// 只有当远程版本较新时才需要下载
						if (remoteTime > localTime) {
							// 确保不会被同时标记为上传和下载
							if (!itemsToSync.some((item) => item.id === fp.id)) {
								itemsToDownload.push(fp.id);
							}
						}
					}
				}
			}
		} else {
			// 没有远程数据，所有diff.deleted都是需要删除的项
			for (const deletedId of filteredDiff.deleted) {
				if (!deletedIds.includes(deletedId)) {
					deletedIds.push(deletedId);
				}
			}
		}

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

		// 简化差异检测统计日志，只在有变更时输出详细信息

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

		return { itemsToSync, itemsToDownload, deletedIds };
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
	 */
	private filterItemsBySyncMode(items: any[]): any[] {
		if (!this.syncModeConfig?.settings) {
			return items;
		}

		const settings = this.syncModeConfig.settings;

		return items.filter((item) => {
			// 收藏模式检查
			if (settings.onlyFavorites && !item.favorite) {
				return false;
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
	 */
	private convertToSyncItem(item: any): SyncItem {
		// 修复：对于文件项，只使用value字段计算校验和，避免因为其他字段的变化导致误判
		let checksum: string;
		let size: number;

		if (item.type === "image" || item.type === "files") {
			// 对于文件项，只使用value字段计算校验和和大小
			const valueStr =
				typeof item.value === "string"
					? item.value
					: JSON.stringify(item.value);
			checksum = calculateStringChecksum(valueStr);
			size = valueStr.length;
		} else {
			// 对于其他类型，使用整个对象的JSON字符串
			const itemStr = JSON.stringify(item);
			checksum = calculateStringChecksum(item.value);
			size = itemStr.length;
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
			size: size,
			checksum: checksum,
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
	private async updateLocalData(data: SyncItem[]): Promise<void> {
		const errors: string[] = [];

		for (const item of data) {
			try {
				await this.insertOrUpdateItem(item);
			} catch (error) {
				errors.push(
					`更新本地数据失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// 如果有错误，记录但不中断整个流程
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

			// 检查是否已存在
			const existingRecords = (await selectSQL("history", {
				type: item.type,
				value: item.value,
			})) as any[];

			if (existingRecords && existingRecords.length > 0) {
				const existing = existingRecords[0];
				const updateItem = {
					...localItem,
					id: existing.id,
					favorite: this.resolveFavoriteStatus(existing, item),
					count: Math.max(existing.count || 0, item.count || 0),
					createTime: existing.createTime,
				};
				await updateSQL("history", updateItem);
			} else {
				await this.insertForSync("history", localItem);
			}
		} catch (error) {
			// 重新抛出错误，让上层处理
			throw new Error(
				`插入或更新项失败 (ID: ${item.id}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * 解决收藏状态冲突
	 */
	private resolveFavoriteStatus(existing: any, incoming: SyncItem): boolean {
		const existingIsFavorite =
			existing.favorite === true || existing.favorite === 1;
		const incomingIsFavorite = incoming.favorite;

		// 如果任何一个版本是收藏的，则标记为收藏
		if (existingIsFavorite || incomingIsFavorite) {
			return true;
		}

		// 如果同步模式是收藏模式，且新数据是收藏的，则以新数据为准
		if (this.syncModeConfig?.settings?.onlyFavorites && incomingIsFavorite) {
			return true;
		}

		return existingIsFavorite;
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
	 * 检测本地删除操作（供IncrementalSyncManager调用）
	 */
	detectLocalDeletions(currentLocalData: SyncItem[]): string[] {
		const currentIds = new Set(currentLocalData.map((item) => item.id));
		const deletedIds: string[] = [];

		for (const [id] of this.lastLocalSnapshot) {
			if (!currentIds.has(id)) {
				deletedIds.push(id);
			}
		}

		return deletedIds;
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
	}
}

// 创建全局同步引擎实例
export const syncEngineV2 = new SyncEngineV2();

// 为了保持向后兼容，导出原有的接口
export const syncEngine = syncEngineV2;
export { SyncEngineV2 as SyncEngine };
