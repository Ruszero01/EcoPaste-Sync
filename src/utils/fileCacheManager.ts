import { downloadSyncData } from "@/plugins/webdav";
import type { WebDAVConfig } from "@/plugins/webdav";

/**
 * 文件缓存管理器 - 处理按需下载和本地缓存
 */
export class FileCacheManager {
	private static instance: FileCacheManager;
	private cache: Map<
		string,
		{ data: Uint8Array; timestamp: number; lastAccess: number }
	> = new Map();
	private readonly CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7天缓存
	private readonly MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB缓存限制
	private currentCacheSize = 0;

	private constructor() {}

	public static getInstance(): FileCacheManager {
		if (!FileCacheManager.instance) {
			FileCacheManager.instance = new FileCacheManager();
		}
		return FileCacheManager.instance;
	}

	/**
	 * 获取缓存文件（按需下载）
	 */
	public async getFile(
		webdavConfig: WebDAVConfig,
		filePath: string,
		onProgress?: (progress: number) => void,
	): Promise<Uint8Array | null> {
		// 1. 检查本地缓存
		const cached = this.getCachedFile(filePath);
		if (cached) {
			return cached;
		}

		// 2. 按需下载
		try {
			const downloadedData = await this.downloadFile(
				webdavConfig,
				filePath,
				onProgress,
			);

			if (downloadedData) {
				// 3. 缓存到本地
				this.cacheFile(filePath, downloadedData);
				return downloadedData;
			}
		} catch (error) {
			console.error("按需下载文件失败:", error);
		}

		return null;
	}

	/**
	 * 检查文件是否已缓存
	 */
	public isFileCached(filePath: string): boolean {
		const cached = this.cache.get(filePath);
		if (!cached) return false;

		// 检查缓存是否过期
		const now = Date.now();
		if (now - cached.timestamp > this.CACHE_DURATION) {
			this.cache.delete(filePath);
			this.currentCacheSize -= cached.data.length;
			return false;
		}

		return true;
	}

	/**
	 * 清理过期缓存
	 */
	public cleanupExpiredCache(): void {
		const now = Date.now();
		const expiredKeys: string[] = [];

		for (const [key, cached] of this.cache) {
			if (now - cached.timestamp > this.CACHE_DURATION) {
				expiredKeys.push(key);
			}
		}

		for (const key of expiredKeys) {
			const cached = this.cache.get(key)!;
			this.cache.delete(key);
			this.currentCacheSize -= cached.data.length;
		}

		if (expiredKeys.length > 0) {
		}
	}

	/**
	 * 获取缓存统计信息
	 */
	public getCacheStats() {
		return {
			fileCount: this.cache.size,
			totalSize: this.currentCacheSize,
			maxSize: this.MAX_CACHE_SIZE,
			usagePercentage: (
				(this.currentCacheSize / this.MAX_CACHE_SIZE) *
				100
			).toFixed(2),
		};
	}

	/**
	 * 预加载文件（可选功能）
	 */
	public async preloadFile(
		webdavConfig: WebDAVConfig,
		filePath: string,
	): Promise<boolean> {
		if (this.isFileCached(filePath)) {
			return true;
		}

		try {
			const data = await this.downloadFile(webdavConfig, filePath);
			if (data) {
				this.cacheFile(filePath, data);
				return true;
			}
		} catch (error) {
			console.warn("预加载文件失败:", filePath, error);
		}

		return false;
	}

	// 私有方法

	private getCachedFile(filePath: string): Uint8Array | null {
		const cached = this.cache.get(filePath);
		if (!cached) return null;

		// 更新最后访问时间
		cached.lastAccess = Date.now();
		return cached.data;
	}

	private cacheFile(filePath: string, data: Uint8Array): void {
		// 检查缓存大小限制
		if (this.currentCacheSize + data.length > this.MAX_CACHE_SIZE) {
			this.evictLRU(data.length);
		}

		// 缓存文件
		this.cache.set(filePath, {
			data,
			timestamp: Date.now(),
			lastAccess: Date.now(),
		});

		this.currentCacheSize += data.length;
	}

	private async downloadFile(
		webdavConfig: WebDAVConfig,
		filePath: string,
		onProgress?: (progress: number) => void,
	): Promise<Uint8Array | null> {
		try {
			const result = await downloadSyncData(webdavConfig, filePath);

			if (result.success && result.data) {
				// 转换base64为Uint8Array
				const base64Data = result.data;
				const binaryString = atob(base64Data);
				const bytes = new Uint8Array(binaryString.length);

				for (let i = 0; i < binaryString.length; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}

				onProgress?.(100);
				return bytes;
			}
		} catch (error) {
			console.error("下载文件失败:", error);
		}

		return null;
	}

	private evictLRU(neededSize: number): void {
		// 按最后访问时间排序，删除最久未访问的文件
		const entries = Array.from(this.cache.entries()).sort(
			(a, b) => a[1].lastAccess - b[1].lastAccess,
		);

		let freedSpace = 0;
		for (const [key, cached] of entries) {
			if (freedSpace >= neededSize) break;

			this.cache.delete(key);
			this.currentCacheSize -= cached.data.length;
			freedSpace += cached.data.length;
		}
	}
}

// 导出单例实例
export const fileCacheManager = FileCacheManager.getInstance();
