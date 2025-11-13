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
	 * 使用固定的时间戳避免重复上传同一文件
	 */
	private buildRemotePath(itemId: string, fileName: string): string {
		const basePath = this.webdavConfig?.path || "";
		// 使用 itemId 的创建时间作为固定时间戳，避免每次同步都上传新文件
		// 这里使用 itemId 作为固定标识，确保同一个文件总是使用相同的路径
		const fixedTimestamp = this.extractFixedTimestampFromItemId(itemId);
		const remoteFileName = `${itemId}_${fixedTimestamp}_${fileName}`;
		return basePath && basePath !== "/"
			? `${basePath.replace(/\/$/, "")}/files/${remoteFileName}`
			: `files/${remoteFileName}`;
	}

	/**
	 * 从 itemId 中提取固定时间戳
	 * itemId 通常包含时间信息，我们可以基于此生成固定的时间戳
	 */
	private extractFixedTimestampFromItemId(itemId: string): number {
		// 方法1：如果 itemId 本身包含时间戳信息，提取它
		const timestampMatch = itemId.match(/(\d{13})/); // 匹配13位时间戳
		if (timestampMatch) {
			return Number.parseInt(timestampMatch[1], 10);
		}

		// 方法2：使用 itemId 的哈希值作为固定标识
		// 这样确保相同的 itemId 总是生成相同的文件路径
		let hash = 0;
		for (let i = 0; i < itemId.length; i++) {
			const char = itemId.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // 转换为32位整数
		}

		// 使用一个基准时间戳 + 哈希值确保唯一性
		const baseTimestamp = 1600000000000; // 2020年基准时间
		return baseTimestamp + Math.abs(hash);
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
				const remotePath = this.buildRemotePath(itemId, fileName);

				// 检查远程文件是否已存在，避免重复上传
				const needsUpload = await this.needsUpload(localPath, remotePath);
				if (!needsUpload) {
					// 文件已存在且内容相同，直接创建元数据
					metadata.push({
						fileName,
						originalPath: localPath,
						remotePath,
						size,
						timestamp,
					});
					continue;
				}

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
	 * 检查文件是否需要上传
	 * 通过比较本地文件和远程文件的大小或修改时间来判断
	 */
	private async needsUpload(
		_localPath: string,
		remotePath: string,
	): Promise<boolean> {
		try {
			// 这里可以实现更复杂的去重逻辑，比如：
			// 1. 检查远程文件是否存在
			// 2. 比较文件大小
			// 3. 比较文件哈希值

			// 暂时简单实现：总是上传（在实际应用中可以添加去重逻辑）
			// TODO: 实现文件存在性和内容比较逻辑
			return true;
		} catch (error) {
			console.warn(`检查文件是否需要上传失败: ${remotePath}`, error);
			// 出错时默认上传
			return true;
		}
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
		// 使用元数据中的原始文件名，而不是从 originalPath 提取
		const fileName =
			metadata.fileName || originalPath.split(/[/\\]/).pop() || "unknown";
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

		// 获取需要处理文件的项目（排除已删除的项目）
		const fileItems = [
			...cloudResult.itemsToAdd,
			...cloudResult.itemsToUpdate,
		].filter(
			(item) =>
				// 排除已删除的项目
				!item.deleted &&
				// 只处理文件类型
				(item.type === "image" || item.type === "files"),
		);

		console.info(
			`文件包上传筛选: 原始 ${[...cloudResult.itemsToAdd, ...cloudResult.itemsToUpdate].length} 个项目，过滤后 ${fileItems.length} 个文件项目`,
		);

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
					// 为了保证跨设备文件名一致性，使用原始文件名而不是缓存路径
					// 从元数据中提取原始文件名，构建统一的文件路径格式
					const consistentPaths = downloadedPaths.map((path, index) => {
						const meta = metadata[index];
						if (meta?.fileName) {
							// 如果下载到缓存目录，返回统一的文件名格式
							const isCachePath = path.includes("cache");
							if (isCachePath) {
								// 返回原始文件名，确保跨设备一致性
								return meta.fileName;
							}
							// 如果不是缓存路径，返回实际路径
							return path;
						}
						return path;
					});

					// 更新 item 的值为保持一致性的文件路径/名称数组
					item.value = JSON.stringify(consistentPaths);
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
	 * 根据项目ID删除对应的云端文件
	 */
	async deleteRemoteFiles(itemIds: string[]): Promise<boolean> {
		if (!this.webdavConfig || itemIds.length === 0) {
			return true;
		}

		const { deleteFile } = await import("@/plugins/webdav");
		const deletePromises: Promise<boolean>[] = [];

		try {
			// 首先下载云端索引以获取文件元数据
			const { cloudDataManager } = await import("./cloudDataManager");
			const remoteIndex = await cloudDataManager.downloadSyncIndex();

			if (remoteIndex?.items) {
				for (const itemId of itemIds) {
					// 在云端数据中查找对应的文件项目
					const cloudItem = remoteIndex.items.find(
						(item: any) => item.id === itemId,
					);

					if (!cloudItem) {
						console.warn(`项目 ${itemId} 在云端索引中未找到`);
						continue;
					}

					console.info(`检查项目 ${itemId}，类型: ${cloudItem.type}`);

					if (
						cloudItem &&
						(cloudItem.type === "files" || cloudItem.type === "image")
					) {
						try {
							// 提取文件元数据
							const metadata = this.extractFileMetadata(cloudItem as any);
							console.info(
								`项目 ${itemId} 找到 ${metadata.length} 个文件元数据`,
							);

							for (const meta of metadata) {
								// 构建远程文件路径
								const remotePath = meta.remotePath;
								if (remotePath) {
									console.info(`准备删除远程文件: ${remotePath}`);
									deletePromises.push(
										deleteFile(this.webdavConfig!, remotePath).catch(
											(error) => {
												console.warn(`删除远程文件失败: ${remotePath}`, error);
												return false;
											},
										),
									);
								} else {
									console.warn(`项目 ${itemId} 的文件路径为空`);
								}
							}
						} catch (error) {
							console.warn(`处理项目 ${itemId} 的文件元数据失败:`, error);
						}
					} else {
						console.info(
							`项目 ${itemId} 不是文件类型 (${cloudItem.type})，跳过文件删除`,
						);
					}
				}
			} else {
				console.warn("云端索引为空，无法查找文件元数据");
			}

			// 等待所有删除操作完成
			const deleteResults = await Promise.allSettled(deletePromises);

			// 统计删除结果
			const successCount = deleteResults.filter(
				(result) => result.status === "fulfilled" && result.value === true,
			).length;

			const totalFiles = deletePromises.length;

			// 记录删除结果
			if (totalFiles > 0) {
				console.info(`删除远程文件: ${successCount}/${totalFiles} 成功`);
			} else {
				console.info("没有需要删除的远程文件（可能不是文件类型或已被删除）");
			}

			return successCount === totalFiles;
		} catch (error) {
			console.error("删除远程文件时发生错误:", error);
			return false;
		}
	}
}

// 导出单例实例
export const fileSyncManager = new FileSyncManager();
