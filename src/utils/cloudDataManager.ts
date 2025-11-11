import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import type { WebDAVConfig } from "@/plugins/webdav";
import type {
	CloudItemFingerprint,
	CloudSyncIndex,
	SyncDiffResult,
} from "@/types/sync";
import { calculateChecksum } from "@/utils/shared";

/**
 * 云端数据管理器
 * 负责云端索引和数据文件的上传、下载、缓存和差异检测
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
	 * 检测同步差异
	 */
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

		return this.detectDiff(localFingerprints, remoteIndex, deletedSet);
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
	 * 生成本地项目指纹
	 */
	private generateLocalFingerprints(
		localItems: any[],
	): Map<string, CloudItemFingerprint> {
		const fingerprintMap = new Map<string, CloudItemFingerprint>();

		for (const item of localItems) {
			const fingerprint = this.generateItemFingerprint(item);
			fingerprintMap.set(item.id, fingerprint);
		}

		return fingerprintMap;
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

		const favoriteAwareChecksum = calculateChecksum(
			JSON.stringify({
				favorite: !!item.favorite,
			}),
		);

		const size = JSON.stringify(item).length;

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

	/**
	 * 检测差异（核心算法）
	 */
	private detectDiff(
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
			} else if (localFp && this.needsDownload(localFp, remoteFp)) {
				result.toDownload.push(remoteFp);
			}
		}

		return result;
	}

	/**
	 * 判断是否需要下载
	 */
	private needsDownload(
		localFp: CloudItemFingerprint,
		remoteFp: CloudItemFingerprint,
	): boolean {
		if (remoteFp.deleted) return false;

		return (
			remoteFp.timestamp > localFp.timestamp &&
			remoteFp.checksum !== localFp.checksum
		);
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
	 * 获取完整文件路径
	 */
	private getFullPath(filename: string): string {
		if (!this.webdavConfig) return filename;

		const basePath = this.webdavConfig.path || "";
		return basePath && basePath !== "/"
			? `${basePath.replace(/\/$/, "")}/${filename}`
			: filename;
	}
}

// 导出单例实例
export const cloudDataManager = new CloudDataManager();
