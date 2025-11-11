import { deleteFile, uploadSyncData } from "@/plugins/webdav";
import type { WebDAVConfig } from "@/plugins/webdav";
import type { SyncItem } from "@/types/sync";
import { lstat } from "@tauri-apps/plugin-fs";

/**
 * 文件同步管理器
 * 负责文件上传、下载、包管理和同步协调
 */
export class FileSyncManager {
	private webdavConfig: WebDAVConfig | null = null;

	setWebDAVConfig(config: WebDAVConfig | null): void {
		this.webdavConfig = config;
	}

	/**
	 * 智能上传文件包
	 */
	async smartUploadPackage(
		itemId: string,
		type: "image" | "files",
		paths: string[],
		webdavConfig: WebDAVConfig,
	): Promise<any> {
		try {
			const validPaths = paths.filter((path) => path && path.length > 0);
			if (validPaths.length === 0) {
				return null;
			}

			// 检查文件大小限制
			const maxSize = type === "image" ? 5 : 10; // MB
			const validSizedPaths: string[] = [];
			for (const path of validPaths) {
				const size = await this.getFileSize(path);
				if (size <= maxSize * 1024 * 1024) {
					validSizedPaths.push(path);
				} else {
					console.warn(`文件过大，跳过: ${path}`);
				}
			}

			const packageInfo = {
				packageId: itemId,
				originalPaths: validSizedPaths,
				timestamp: Date.now(),
				size: validSizedPaths.length * 1024 * 100, // 估算每个文件100KB
			};

			// 上传包信息到云端
			const filePath = this.getPackagePath(itemId);
			const result = await uploadSyncData(
				webdavConfig,
				filePath,
				JSON.stringify(packageInfo, null, 2),
			);

			if (result.success) {
				return packageInfo;
			}
		} catch (error) {
			console.error("文件包上传失败:", error);
		}

		return null;
	}

	/**
	 * 智能同步文件
	 */
	async syncFilesIntelligently(
		packageInfo: any,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		if (!webdavConfig || !packageInfo) return false;

		try {
			// 这里可以实现更复杂的文件同步逻辑
			// 例如：文件变化检测、增量同步等
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 处理文件同步项
	 */
	async processFileSyncItem(item: SyncItem): Promise<SyncItem | null> {
		try {
			if (item.type === "image") {
				return await this.processImageItem(item);
			}
			if (item.type === "files") {
				return await this.processFilesItem(item);
			}
		} catch (error) {
			console.error("处理文件项失败:", error);
		}

		return item;
	}

	/**
	 * 处理图片项
	 */
	private async processImageItem(item: SyncItem): Promise<SyncItem | null> {
		if (!item.value) return item;

		try {
			let imagePath = item.value;

			// 处理已打包的图片
			if (item._syncType === "package_files") {
				return item;
			}

			// 解析JSON格式的路径
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
					// 解析失败，继续处理
				}
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
					// 解析失败，使用原始路径
				}
			}

			// 跳过无效路径
			if (typeof imagePath !== "string" || !imagePath.trim()) {
				return item;
			}

			// 检查文件大小
			const maxSize = 5; // MB
			const fileSize = await this.getFileSize(imagePath);
			if (fileSize > maxSize * 1024 * 1024) {
				return item;
			}

			// 上传文件包
			const packageInfo = await this.smartUploadPackage(
				item.id,
				"image",
				[imagePath],
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
		} catch (error) {
			console.error("处理图片项失败:", error);
		}

		return item;
	}

	/**
	 * 处理文件项
	 */
	private async processFilesItem(item: SyncItem): Promise<SyncItem | null> {
		if (!item.value) return item;

		try {
			let filePaths: string[] = [];

			// 解析文件路径
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
			} catch {
				return item;
			}

			if (filePaths.length === 0) {
				return item;
			}

			// 检查文件大小限制
			const maxSize = 10; // MB
			const validPaths: string[] = [];

			for (const filePath of filePaths) {
				try {
					const fileSize = await this.getFileSize(filePath);
					if (fileSize <= maxSize * 1024 * 1024) {
						validPaths.push(filePath);
					}
				} catch {
					// 跳过无法访问的文件
				}
			}

			if (validPaths.length === 0) {
				return item;
			}

			// 上传文件包
			const packageInfo = await this.smartUploadPackage(
				item.id,
				"files",
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
		} catch (error) {
			console.error("处理文件项失败:", error);
		}

		return item;
	}

	/**
	 * 删除远程文件
	 */
	async deleteRemoteFiles(itemIds: string[]): Promise<boolean> {
		if (!this.webdavConfig || itemIds.length === 0) {
			return true;
		}

		const MAX_CONCURRENT_DELETES = 3;
		let successCount = 0;
		let failedCount = 0;
		const errors: string[] = [];

		// 并发删除文件
		const deletePromises: Promise<void>[] = [];

		for (const itemId of itemIds) {
			const promise = (async () => {
				try {
					const filePath = this.getPackagePath(itemId);
					const result = await deleteFile(this.webdavConfig!, filePath);
					if (result) {
						successCount++;
					} else {
						failedCount++;
						errors.push(`删除文件失败: ${itemId}`);
					}
				} catch (error) {
					failedCount++;
					errors.push(`删除文件异常: ${itemId} - ${error}`);
				}
			})();

			deletePromises.push(promise);

			// 控制并发数量
			if (deletePromises.length >= MAX_CONCURRENT_DELETES) {
				await Promise.allSettled(deletePromises);
				deletePromises.length = 0;
			}
		}

		// 等待剩余的删除任务完成
		if (deletePromises.length > 0) {
			await Promise.allSettled(deletePromises);
		}

		if (errors.length > 0) {
			console.warn("文件删除警告:", errors);
		}

		return successCount > 0 && failedCount === 0;
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
	 * 获取文件包路径
	 */
	private getPackagePath(itemId: string): string {
		if (!this.webdavConfig) return `packages/${itemId}.json`;

		const basePath = this.webdavConfig.path || "";
		return basePath && basePath !== "/"
			? `${basePath.replace(/\/$/, "")}/packages/${itemId}.json`
			: `packages/${itemId}.json`;
	}
}

// 导出单例实例
export const fileSyncManager = new FileSyncManager();
