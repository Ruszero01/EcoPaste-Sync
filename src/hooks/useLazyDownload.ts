import { getServerConfig } from "@/plugins/webdav";
import type { SyncItem } from "@/types/sync";
import { fileDownloadService } from "@/utils/fileDownloadService";
import { useCallback, useState } from "react";

/**
 * 文件按需下载 Hook
 */
export const useLazyDownload = () => {
	const [downloadingItems, setDownloadingItems] = useState<Set<string>>(
		new Set(),
	);
	const [downloadProgress, setDownloadProgress] = useState<
		Record<string, number>
	>({});
	const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>(
		{},
	);

	/**
	 * 下载文件内容
	 */
	const downloadFile = useCallback(
		async (
			syncItem: SyncItem,
			onProgress?: (progress: number) => void,
		): Promise<Uint8Array | null> => {
			const webdavConfig = await getServerConfig();
			if (!webdavConfig) {
				const error = "WebDAV 配置未设置";
				setDownloadErrors((prev) => ({ ...prev, [syncItem.id]: error }));
				return null;
			}

			// 检查是否已经在下载中
			if (downloadingItems.has(syncItem.id)) {
				return null;
			}

			// 清除之前的错误
			setDownloadErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[syncItem.id];
				return newErrors;
			});

			// 标记为下载中
			setDownloadingItems((prev) => new Set(prev).add(syncItem.id));

			try {
				const fileData = await fileDownloadService.getFileContent(
					syncItem,
					webdavConfig,
					(progress) => {
						setDownloadProgress((prev) => ({
							...prev,
							[syncItem.id]: progress,
						}));
						onProgress?.(progress);
					},
				);

				if (fileData) {
					// 下载完成，清除进度
					setDownloadProgress((prev) => {
						const newProgress = { ...prev };
						delete newProgress[syncItem.id];
						return newProgress;
					});
				}

				return fileData;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "下载失败";
				setDownloadErrors((prev) => ({ ...prev, [syncItem.id]: errorMessage }));
				return null;
			} finally {
				// 清除下载状态
				setDownloadingItems((prev) => {
					const newSet = new Set(prev);
					newSet.delete(syncItem.id);
					return newSet;
				});
			}
		},
		[downloadingItems],
	);

	/**
	 * 预加载文件
	 */
	const preloadFile = useCallback(
		async (syncItem: SyncItem): Promise<boolean> => {
			const webdavConfig = await getServerConfig();
			if (!webdavConfig) return false;

			try {
				return await fileDownloadService.preloadFile(syncItem, webdavConfig);
			} catch (error) {
				console.warn("预加载文件失败:", error);
				return false;
			}
		},
		[],
	);

	/**
	 * 检查文件是否可用
	 */
	const isFileAvailable = useCallback((syncItem: SyncItem): boolean => {
		return fileDownloadService.isFileAvailable(syncItem);
	}, []);

	/**
	 * 获取文件大小
	 */
	const getFileSize = useCallback((syncItem: SyncItem): number => {
		return fileDownloadService.getFileSize(syncItem);
	}, []);

	/**
	 * 获取文件类型
	 */
	const getFileType = useCallback((syncItem: SyncItem): string => {
		return fileDownloadService.getFileType(syncItem);
	}, []);

	/**
	 * 批量下载多个文件
	 */
	const downloadMultipleFiles = useCallback(
		async (
			syncItems: SyncItem[],
			onOverallProgress?: (completed: number, total: number) => void,
		): Promise<Map<string, Uint8Array | null>> => {
			const results = new Map<string, Uint8Array | null>();
			let completed = 0;

			// 并发下载（限制并发数）
			const concurrentLimit = 3;
			const chunks = [];
			for (let i = 0; i < syncItems.length; i += concurrentLimit) {
				chunks.push(syncItems.slice(i, i + concurrentLimit));
			}

			for (const chunk of chunks) {
				const promises = chunk.map(async (item) => {
					const data = await downloadFile(item);
					results.set(item.id, data);
					completed++;
					onOverallProgress?.(completed, syncItems.length);
					return { id: item.id, data };
				});

				await Promise.all(promises);
			}

			return results;
		},
		[downloadFile],
	);

	/**
	 * 清理缓存
	 */
	const cleanupCache = useCallback(() => {
		fileDownloadService.cleanupCache();
	}, []);

	/**
	 * 获取缓存统计
	 */
	const getCacheStats = useCallback(() => {
		return fileDownloadService.getCacheStats();
	}, []);

	/**
	 * 重置错误状态
	 */
	const clearError = useCallback((itemId: string) => {
		setDownloadErrors((prev) => {
			const newErrors = { ...prev };
			delete newErrors[itemId];
			return newErrors;
		});
	}, []);

	/**
	 * 清除所有错误
	 */
	const clearAllErrors = useCallback(() => {
		setDownloadErrors({});
	}, []);

	return {
		// 状态
		isDownloading: (itemId: string) => downloadingItems.has(itemId),
		getDownloadProgress: (itemId: string) => downloadProgress[itemId] || 0,
		getDownloadError: (itemId: string) => downloadErrors[itemId],
		downloadErrors,

		// 操作
		downloadFile,
		preloadFile,
		isFileAvailable,
		getFileSize,
		getFileType,
		downloadMultipleFiles,
		cleanupCache,
		getCacheStats,
		clearError,
		clearAllErrors,
	};
};
