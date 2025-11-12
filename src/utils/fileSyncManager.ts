import { downloadFile, uploadFile } from "@/plugins/webdav";
import type { WebDAVConfig } from "@/plugins/webdav";
import type { HistoryItem, SyncItem } from "@/types/sync";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { lstat } from "@tauri-apps/plugin-fs";

interface FileMetadata {
	fileName: string;
	originalPath: string;
	remotePath: string;
	size: number;
	timestamp: number;
	md5?: string; // 用于文件完整性校验
}

/**
 * 文件同步管理器
 * 新架构：
 * - sync-data.json: 记录所有元数据
 * - files/: 直接保存原始文件，使用 ${itemId}_${timestamp}_${originalName} 命名
 */
export class FileSyncManager {
	private webdavConfig: WebDAVConfig | null = null;
	private cacheDir: string | null = null;

	setWebDAVConfig(config: WebDAVConfig | null): void {
		this.webdavConfig = config;
	}

	/**
	 * 获取本地缓存目录
	 */
	private async getCacheDir(): Promise<string> {
		if (!this.cacheDir) {
			const dataDir = await appDataDir();
			this.cacheDir = await join(dataDir, "files", "cache");
		}
		return this.cacheDir;
	}

	/**
	 * 构建远程文件路径
	 */
	private buildRemotePath(
		itemId: string,
		fileName: string,
		timestamp: number,
	): string {
		const basePath = this.webdavConfig?.path || "";
		const remoteFileName = `${itemId}_${timestamp}_${fileName}`;
		return basePath && basePath !== "/"
			? `${basePath.replace(/\/$/, "")}/files/${remoteFileName}`
			: `files/${remoteFileName}`;
	}

	/**
	 * 从远程路径解析文件信息
	 */
	private parseRemotePath(remotePath: string): {
		itemId: string;
		timestamp: number;
		fileName: string;
	} | null {
		const fileName = remotePath.split(/[/\\]/).pop() || "";
		const match = fileName.match(/^([^_]+)_(\d+)_(.+)$/);
		if (match) {
			return {
				itemId: match[1],
				timestamp: Number.parseInt(match[2], 10),
				fileName: match[3],
			};
		}
		return null;
	}

	/**
	 * 上传文件
	 * @param itemId 剪切板项ID
	 * @param localPaths 本地文件路径数组
	 * @returns 文件元数据数组
	 */
	async uploadFiles(
		itemId: string,
		localPaths: string[],
	): Promise<FileMetadata[]> {
		if (!this.webdavConfig || localPaths.length === 0) {
			return [];
		}

		const metadata: FileMetadata[] = [];
		const timestamp = Date.now();

		for (const localPath of localPaths) {
			try {
				// 检查文件大小限制
				const size = await this.getFileSize(localPath);
				const maxSize = 10 * 1024 * 1024; // 10MB
				if (size > maxSize) {
					console.warn(`文件过大，跳过: ${localPath}`);
					continue;
				}

				const fileName = localPath.split(/[/\\]/).pop() || "unknown";
				const remotePath = this.buildRemotePath(itemId, fileName, timestamp);

				// 上传文件
				const success = await uploadFile(
					this.webdavConfig,
					localPath,
					remotePath,
				);
				if (success) {
					metadata.push({
						fileName,
						originalPath: localPath,
						remotePath,
						size,
						timestamp,
					});
				} else {
					console.warn(`文件上传失败: ${localPath}`);
				}
			} catch (error) {
				console.error(`处理文件失败: ${localPath}`, error);
			}
		}

		return metadata;
	}

	/**
	 * 下载文件
	 * 按照设计逻辑：
	 * 1. 检查原始路径有效性
	 * 2. 比对文件时间，保留最新版本
	 * 3. 路径无效时下载到缓存目录
	 */
	async downloadFile(metadata: FileMetadata): Promise<string> {
		const { originalPath, remotePath, timestamp } = metadata;

		// 1. 检查原始路径是否有效
		const originalPathValid = await this.isValidPath(originalPath);

		if (originalPathValid) {
			// 2. 检查本地文件是否存在
			if (await exists(originalPath)) {
				try {
					const localStat = await lstat(originalPath);

					// 3. 比对时间戳，保留最新文件
					if (localStat.mtime?.getTime()! >= timestamp) {
						// 本地文件较新，不需要下载
						return originalPath;
					}

					// 本地文件较旧，下载覆盖
					const success = await downloadFile(
						this.webdavConfig!,
						remotePath,
						originalPath,
					);
					if (success) {
						return originalPath;
					}
				} catch (error) {
					console.warn(`检查本地文件失败: ${originalPath}`, error);
				}
			} else {
				// 路径有效但文件不存在，直接下载
				const success = await downloadFile(
					this.webdavConfig!,
					remotePath,
					originalPath,
				);
				if (success) {
					return originalPath;
				}
			}
		}

		// 4. 原始路径无效，下载到缓存目录
		const cacheDir = await this.getCacheDir();
		const fileName = originalPath.split(/[/\\]/).pop() || "unknown";
		const cacheFileName = `${timestamp}_${fileName}`;
		const cachePath = await join(cacheDir, cacheFileName);

		const success = await downloadFile(
			this.webdavConfig!,
			remotePath,
			cachePath,
		);

		if (success) {
			return cachePath;
		}

		throw new Error(`下载文件失败: ${remotePath}`);
	}

	/**
	 * 批量下载文件
	 */
	async downloadFiles(metadataList: FileMetadata[]): Promise<string[]> {
		const downloadedPaths: string[] = [];

		for (const metadata of metadataList) {
			try {
				const localPath = await this.downloadFile(metadata);
				downloadedPaths.push(localPath);
			} catch (error) {
				console.error(`下载文件失败: ${metadata.remotePath}`, error);
			}
		}

		return downloadedPaths;
	}

	/**
	 * 检查路径是否有效
	 */
	private async isValidPath(path: string): Promise<boolean> {
		try {
			// 检查父目录是否存在
			const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			if (lastSlash === -1) return false;

			const parentDir = path.substring(0, lastSlash);
			return await exists(parentDir);
		} catch {
			return false;
		}
	}

	/**
	 * 获取文件大小
	 */
	private async getFileSize(filePath: string): Promise<number> {
		try {
			const stat = await lstat(filePath);
			return stat.size;
		} catch {
			return 0;
		}
	}

	/**
	 * 从 SyncItem 提取文件元数据
	 */
	extractFileMetadata(item: SyncItem): FileMetadata[] {
		if (!item.value || (item.type !== "image" && item.type !== "files")) {
			return [];
		}

		try {
			const parsed = JSON.parse(item.value);
			if (Array.isArray(parsed) && typeof parsed[0] === "object") {
				// 新格式：文件元数据数组
				return parsed as FileMetadata[];
			}

			if (Array.isArray(parsed)) {
				// 旧格式：文件路径数组，无法转换为元数据
				console.warn("检测到旧格式文件路径，无法提取元数据");
				return [];
			}
		} catch (error) {
			console.error("解析文件元数据失败:", error);
		}

		return [];
	}

	/**
	 * 将文件元数据转换回 SyncItem 格式
	 */
	async createSyncItemWithFiles(
		item: SyncItem,
		localPaths: string[],
	): Promise<SyncItem> {
		if (localPaths.length === 0) {
			return item;
		}

		const metadata = await this.uploadFiles(item.id, localPaths);
		if (metadata.length === 0) {
			return item;
		}

		return {
			...item,
			value: JSON.stringify(metadata),
			_syncType: "files",
		};
	}

	/**
	 * 从原始数据中提取文件路径数组
	 * 支持多种数据格式：单个文件路径、文件路径数组、复合对象等
	 */
	private extractFilePaths(originalItem: HistoryItem): string[] {
		if (!originalItem.value) {
			return [];
		}

		const filePaths: string[] = [];

		try {
			// 尝试解析为JSON
			const parsed = JSON.parse(originalItem.value);

			if (Array.isArray(parsed)) {
				// 处理数组格式
				for (const item of parsed) {
					if (typeof item === "string") {
						// 简单字符串路径
						if (item.trim()) {
							filePaths.push(item);
						}
					} else if (typeof item === "object" && item !== null) {
						// 处理对象格式，优先使用 originalPath，然后是 path，最后是 fileName
						if (item.originalPath && typeof item.originalPath === "string") {
							filePaths.push(item.originalPath);
						} else if (item.path && typeof item.path === "string") {
							filePaths.push(item.path);
						} else if (item.fileName && typeof item.fileName === "string") {
							filePaths.push(item.fileName);
						}
					}
				}
			} else if (typeof parsed === "object" && parsed !== null) {
				// 处理单个对象格式，优先使用 originalPath，然后是 path，最后是 fileName
				if (parsed.originalPath && typeof parsed.originalPath === "string") {
					filePaths.push(parsed.originalPath);
				} else if (parsed.path && typeof parsed.path === "string") {
					filePaths.push(parsed.path);
				} else if (parsed.fileName && typeof parsed.fileName === "string") {
					filePaths.push(parsed.fileName);
				} else if (parsed.paths && Array.isArray(parsed.paths)) {
					// 处理 {paths: ["...", "..."]} 格式
					for (const path of parsed.paths) {
						if (typeof path === "string" && path.trim()) {
							filePaths.push(path);
						}
					}
				} else if (
					parsed.originalPaths &&
					Array.isArray(parsed.originalPaths)
				) {
					// 处理 {originalPaths: ["...", "..."]} 格式
					for (const path of parsed.originalPaths) {
						if (typeof path === "string" && path.trim()) {
							filePaths.push(path);
						}
					}
				}
			}
		} catch {
			// JSON解析失败，可能是简单的文件路径字符串
			const value = originalItem.value.trim();
			if (value) {
				// 检查是否是文件路径（包含路径分隔符或文件扩展名）
				if (
					value.includes("/") ||
					value.includes("\\") ||
					value.includes(".")
				) {
					filePaths.push(value);
				}
			}
		}

		// 去重并过滤无效路径
		const uniquePaths = [...new Set(filePaths)].filter((path) => {
			return path && path.length > 0 && !path.includes("://");
		});

		return uniquePaths;
	}

	/**
	 * 处理需要上传的文件包
	 * 支持多种文件场景：单文件、文件数组、复合文件结构等
	 */
	async handleFilePackageUploads(
		localRawData: HistoryItem[],
		cloudResult: {
			itemsToAdd: SyncItem[];
			itemsToUpdate: SyncItem[];
			itemsToDelete: string[];
		},
	): Promise<{ uploaded: number; errors: string[] }> {
		const result = { uploaded: 0, errors: [] as string[] };

		if (!this.webdavConfig) {
			return result;
		}

		// 获取需要处理文件的项目
		const fileItems = [
			...cloudResult.itemsToAdd,
			...cloudResult.itemsToUpdate,
		].filter((item) => item.type === "image" || item.type === "files");

		// 去重：基于项目ID，避免重复处理同一个项目
		const uniqueItems = fileItems.filter(
			(item, index, self) => index === self.findIndex((t) => t.id === item.id),
		);

		for (const syncItem of uniqueItems) {
			try {
				// 从本地原始数据中找到对应的完整数据
				const originalItem = localRawData.find(
					(data) => data.id === syncItem.id,
				);
				if (!originalItem) {
					console.warn(`找不到原始数据: ${syncItem.id}`);
					continue;
				}

				// 从原始数据中提取文件路径数组
				const filePaths = this.extractFilePaths(originalItem);

				if (filePaths.length === 0) {
					console.warn(`没有找到有效的文件路径: ${syncItem.id}`);
					continue;
				}

				// console.log(`处理文件上传: ${syncItem.id}, 类型: ${syncItem.type}, 文件数量: ${filePaths.length}`, filePaths);

				// 上传文件并创建元数据
				const updatedItem = await this.createSyncItemWithFiles(
					syncItem,
					filePaths,
				);

				if (updatedItem._syncType === "files") {
					result.uploaded++;
					// 更新原始 syncItem 的值为文件元数据
					syncItem.value = updatedItem.value;
					syncItem._syncType = updatedItem._syncType;
					// console.log(`文件上传成功: ${syncItem.id}, 元数据:`, updatedItem.value);
				} else {
					console.warn(`文件上传失败，没有创建元数据: ${syncItem.id}`);
				}
			} catch (error) {
				const errorMessage = `文件上传失败 (${syncItem.id}): ${error instanceof Error ? error.message : String(error)}`;
				result.errors.push(errorMessage);
				console.error(errorMessage);
			}
		}

		return result;
	}

	/**
	 * 处理需要下载的文件包
	 * 支持从文件元数据恢复到本地文件路径
	 */
	async handleFilePackageDownloads(itemsToAdd: SyncItem[]): Promise<void> {
		if (!this.webdavConfig) return;

		// 检查所有文件类型的项目，不只是包含元数据的
		const fileItems = itemsToAdd.filter(
			(item) => item.type === "files" || item.type === "image",
		);

		if (fileItems.length === 0) return;

		for (const item of fileItems) {
			try {
				const metadata = this.extractFileMetadata(item);

				if (metadata.length === 0) {
					item.value = JSON.stringify([]);
					continue;
				}

				// 批量下载文件
				const downloadedPaths = await this.downloadFiles(metadata);

				if (downloadedPaths.length > 0) {
					// 更新 item 的值为本地文件路径数组，确保使用实际下载后的路径
					item.value = JSON.stringify(downloadedPaths);
				} else {
					item.value = JSON.stringify([]);
				}
			} catch (error) {
				console.error(`下载文件失败 (${item.id}):`, error);
				item.value = JSON.stringify([]);
			}
		}
	}

	/**
	 * 删除远程文件
	 */
	async deleteRemoteFiles(itemIds: string[]): Promise<boolean> {
		if (!this.webdavConfig || itemIds.length === 0) {
			return true;
		}

		// TODO: 实现文件删除逻辑
		// 需要从云端文件列表中找到对应项目并删除
		console.warn("删除远程文件功能待实现:", itemIds);
		return true;
	}
}

// 导出单例实例
export const fileSyncManager = new FileSyncManager();
