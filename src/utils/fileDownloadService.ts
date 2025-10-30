import type { WebDAVConfig } from "@/plugins/webdav";
import type { SyncItem } from "@/types/sync";
import { fileCacheManager } from "./fileCacheManager";

/**
 * 文件下载服务 - 处理按需下载和文件恢复
 */
export class FileDownloadService {
	private static instance: FileDownloadService;

	private constructor() {}

	public static getInstance(): FileDownloadService {
		if (!FileDownloadService.instance) {
			FileDownloadService.instance = new FileDownloadService();
		}
		return FileDownloadService.instance;
	}

	/**
	 * 获取文件内容（按需下载）
	 */
	public async getFileContent(
		syncItem: SyncItem,
		webdavConfig: WebDAVConfig,
		onProgress?: (progress: number) => void,
	): Promise<Uint8Array | null> {
		try {
			// 检查是否为按需下载的文件
			if (!syncItem.lazyDownload) {
				return null;
			}

			let filePath: string;

			// 根据文件类型确定下载路径
			if (syncItem.type === "image") {
				// 检查是否是分段存储的图片（JSON metadata格式）
				if (syncItem.value?.startsWith("[")) {
					try {
						const segmentData = JSON.parse(syncItem.value);
						if (segmentData?.[0]?.originalPath) {
							// 这是分段存储的图片，使用ImageSyncService处理下载
							const { imageSyncService } = await import(
								"@/services/imageSyncService"
							);
							const downloadedImagePath =
								await imageSyncService.downloadAndSaveImage(
									segmentData[0],
									webdavConfig,
								);

							if (downloadedImagePath) {
								// 读取下载的文件并返回数据
								const { readFile } = await import("@tauri-apps/plugin-fs");
								const fileData = await readFile(downloadedImagePath);
								return new Uint8Array(fileData);
							}
							return null;
						}
					} catch (error) {
						console.error("解析图片分段数据失败:", error);
						return null;
					}
				}
				// 兼容旧格式，直接使用文件路径
				filePath = syncItem.value;
			} else if (syncItem.type === "files") {
				// 文件数组的情况，可能需要处理多个文件
				// 这里简化处理，返回第一个文件的路径
				try {
					const filePaths = JSON.parse(syncItem.value);
					if (Array.isArray(filePaths) && filePaths.length > 0) {
						filePath = filePaths[0];
					} else {
						return null;
					}
				} catch {
					return null;
				}
			} else {
				return null;
			}

			onProgress?.(0);

			// 使用缓存管理器获取文件
			const fileData = await fileCacheManager.getFile(
				webdavConfig,
				filePath,
				(progress) => {
					onProgress?.(progress);
				},
			);

			onProgress?.(100);
			return fileData;
		} catch (error) {
			console.error("文件下载失败:", error);
			return null;
		}
	}

	/**
	 * 预加载文件（可选功能）
	 */
	public async preloadFile(
		syncItem: SyncItem,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		if (!syncItem.lazyDownload) {
			return true; // 非按需下载文件默认可用
		}

		let filePath: string;

		if (syncItem.type === "image") {
			// 检查是否是分段存储的图片（JSON metadata格式）
			if (syncItem.value?.startsWith("[")) {
				try {
					const segmentData = JSON.parse(syncItem.value);
					if (segmentData?.[0]?.originalPath) {
						// 这是分段存储的图片，使用ImageSyncService处理
						const { imageSyncService } = await import(
							"@/services/imageSyncService"
						);
						const downloadedImagePath =
							await imageSyncService.downloadAndSaveImage(
								segmentData[0],
								webdavConfig,
							);
						return downloadedImagePath !== null;
					}
				} catch (error) {
					console.error("解析图片分段数据失败:", error);
					return false;
				}
			}
			filePath = syncItem.value;
		} else if (syncItem.type === "files") {
			try {
				const filePaths = JSON.parse(syncItem.value);
				if (Array.isArray(filePaths) && filePaths.length > 0) {
					filePath = filePaths[0];
				} else {
					return false;
				}
			} catch {
				return false;
			}
		} else {
			return false;
		}

		return await fileCacheManager.preloadFile(webdavConfig, filePath);
	}

	/**
	 * 检查文件是否可用（已缓存）
	 */
	public isFileAvailable(syncItem: SyncItem): boolean {
		if (!syncItem.lazyDownload) {
			return true; // 非按需下载文件默认可用
		}

		let filePath: string;

		if (syncItem.type === "image") {
			filePath = syncItem.value;
		} else if (syncItem.type === "files") {
			try {
				const filePaths = JSON.parse(syncItem.value);
				if (Array.isArray(filePaths) && filePaths.length > 0) {
					filePath = filePaths[0];
				} else {
					return false;
				}
			} catch {
				return false;
			}
		} else {
			return false;
		}

		return fileCacheManager.isFileCached(filePath);
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
	 * 清理缓存
	 */
	public cleanupCache(): void {
		fileCacheManager.cleanupExpiredCache();
	}

	/**
	 * 获取缓存统计
	 */
	public getCacheStats() {
		return fileCacheManager.getCacheStats();
	}
}

// 导出单例实例
export const fileDownloadService = FileDownloadService.getInstance();
