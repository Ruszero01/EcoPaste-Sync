import type { WebDAVConfig } from "@/plugins/webdav";
import type { SyncItem } from "@/types/sync";
import { fileSegmentManager } from "./fileSegmentManager";

/**
 * 分段下载服务 - 处理分段存储的文件按需下载
 */
export class SegmentDownloadService {
	private static instance: SegmentDownloadService;

	private constructor() {}

	public static getInstance(): SegmentDownloadService {
		if (!SegmentDownloadService.instance) {
			SegmentDownloadService.instance = new SegmentDownloadService();
		}
		return SegmentDownloadService.instance;
	}

	/**
	 * 获取分段存储的文件内容
	 */
	public async getFileContent(
		syncItem: SyncItem,
		webdavConfig: WebDAVConfig,
		onProgress?: (progress: number) => void,
	): Promise<Uint8Array | null> {
		try {
			// 检查是否为分段存储的文件
			if (syncItem._syncType !== "segmented_files") {
				return null;
			}

			const segmentReferences = syncItem._segmentReferences;
			if (!segmentReferences || !Array.isArray(segmentReferences)) {
				console.error("分段引用信息无效");
				return null;
			}

			onProgress?.(0);

			// 对于分段存储，目前返回第一个文件的完整数据
			// 实际应用中可能需要根据具体需求返回特定文件或组合数据
			const firstRef = segmentReferences[0];
			if (!firstRef) {
				return null;
			}

			onProgress?.(25);

			// 从分段获取文件数据
			const fileData = await fileSegmentManager.getFileFromSegment(
				firstRef.segmentId,
				firstRef.fileIndex,
			);

			onProgress?.(75);

			if (!fileData) {
				console.error(`从分段恢复文件失败: ${firstRef.originalPath}`);
				return null;
			}

			onProgress?.(100);
			return new Uint8Array(fileData);
		} catch (error) {
			console.error("分段文件下载失败:", error);
			return null;
		}
	}

	/**
	 * 预加载分段文件
	 */
	public async preloadFile(
		syncItem: SyncItem,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		if (syncItem._syncType !== "segmented_files") {
			return true; // 非分段存储文件默认可用
		}

		const segmentReferences = syncItem._segmentReferences;
		if (!segmentReferences || !Array.isArray(segmentReferences)) {
			return false;
		}

		try {
			// 预加载第一个分段
			const firstRef = segmentReferences[0];
			if (firstRef) {
				await fileSegmentManager.downloadSegment(firstRef.segmentId);
			}
			return true;
		} catch (error) {
			console.warn("预加载分段文件失败:", error);
			return false;
		}
	}

	/**
	 * 检查分段文件是否可用
	 */
	public isFileAvailable(syncItem: SyncItem): boolean {
		if (syncItem._syncType !== "segmented_files") {
			return true; // 非分段存储文件默认可用
		}

		const segmentReferences = syncItem._segmentReferences;
		if (!segmentReferences || !Array.isArray(segmentReferences)) {
			return false;
		}

		// 检查第一个分段是否已缓存
		const firstRef = segmentReferences[0];
		if (firstRef) {
			// 这里需要实现分段缓存检查逻辑
			// 暂时返回true，实际需要检查分段是否已下载
			return true;
		}

		return false;
	}

	/**
	 * 获取文件大小信息
	 */
	public getFileSize(syncItem: SyncItem): number {
		return syncItem.fileSize || 0;
	}

	/**
	 * 获取文件类型信息
	 */
	public getFileType(syncItem: SyncItem): string {
		return syncItem.fileType || syncItem.type;
	}

	/**
	 * 批量下载多个分段文件
	 */
	public async downloadMultipleFiles(
		syncItems: SyncItem[],
		webdavConfig: WebDAVConfig,
		onOverallProgress?: (completed: number, total: number) => void,
	): Promise<Map<string, Uint8Array | null>> {
		const results = new Map<string, Uint8Array | null>();
		let completed = 0;

		// 分组下载：按分段ID分组，避免重复下载同一个分段
		const segmentGroups = new Map<string, SyncItem[]>();

		for (const item of syncItems) {
			if (item._syncType === "segmented_files") {
				const segmentReferences = item._segmentReferences;
				if (segmentReferences && segmentReferences.length > 0) {
					const segmentId = segmentReferences[0].segmentId;
					if (!segmentGroups.has(segmentId)) {
						segmentGroups.set(segmentId, []);
					}
					segmentGroups.get(segmentId)!.push(item);
				}
			}
		}

		// 下载每个分段
		for (const [segmentId, items] of segmentGroups) {
			try {
				// 下载分段数据
				const segmentData = await fileSegmentManager.downloadSegment(segmentId);

				if (segmentData) {
					// 为该分段的所有文件创建数据副本
					for (const item of items) {
						const segmentReferences = item._segmentReferences;
						if (segmentReferences && segmentReferences.length > 0) {
							const fileIndex = segmentReferences[0].fileIndex;
							const fileData = segmentData.slice(
								fileIndex.offset,
								fileIndex.offset + fileIndex.size,
							);
							results.set(item.id, new Uint8Array(fileData));
						}
					}
				}

				completed += items.length;
				onOverallProgress?.(completed, syncItems.length);
			} catch (error) {
				console.error(`下载分段失败: ${segmentId}`, error);

				// 标记该分段的所有文件为失败
				for (const item of items) {
					results.set(item.id, null);
				}

				completed += items.length;
				onOverallProgress?.(completed, syncItems.length);
			}
		}

		return results;
	}

	/**
	 * 清理缓存
	 */
	public cleanupCache(): void {
		fileSegmentManager.clearCache();
	}

	/**
	 * 获取缓存统计
	 */
	public getCacheStats() {
		return fileSegmentManager.getCacheStats();
	}
}

// 导出单例实例
export const segmentDownloadService = SegmentDownloadService.getInstance();
