import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import { downloadDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import JSZip from "jszip";

interface PackageInfo {
	packageId: string;
	itemId: string;
	itemType: string;
	fileName: string;
	originalPaths: string[];
	size: number;
	checksum: string;
	compressedSize: number;
}

/**
 * 文件打包管理器 - 按条目打包文件为ZIP
 */
export class FilePackageManager {
	private readonly DEFAULT_MAX_PACKAGE_SIZE = 50 * 1024 * 1024; // 50MB per package
	private config: WebDAVConfig | null = null;
	private syncModeConfig: any = null;
	private logCallback?: (
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) => void;

	/**
	 * 设置WebDAV配置
	 */
	setWebDAVConfig(config: WebDAVConfig): void {
		this.config = config;
	}

	/**
	 * 设置日志回调
	 */
	setLogCallback(
		callback: (
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
		) => void,
	): void {
		this.logCallback = callback;
	}

	/**
	 * 设置同步模式配置
	 */
	setSyncModeConfig(config: any): void {
		this.syncModeConfig = config;
	}

	/**
	 * 获取最大包大小限制
	 */
	private getMaxPackageSize(): number {
		if (this.syncModeConfig?.fileLimits?.maxPackageSize) {
			// 前端配置的单位是MB，需要转换为字节
			return this.syncModeConfig.fileLimits.maxPackageSize * 1024 * 1024;
		}
		return this.DEFAULT_MAX_PACKAGE_SIZE;
	}

	/**
	 * 添加日志
	 */
	private addLog(
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) {
		if (this.logCallback) {
			this.logCallback(level, message, data);
		} else {
			console.log(`[${level.toUpperCase()}] ${message}`, data || "");
		}
	}

	/**
	 * 将条目的文件打包并上传（兼容性方法，内部使用智能上传）
	 */
	async packageAndUploadFiles(
		itemId: string,
		itemType: string,
		paths: string[],
		config?: WebDAVConfig,
	): Promise<PackageInfo | null> {
		// 直接使用智能上传方法
		return this.smartUploadPackage(itemId, itemType, paths, config);
	}

	/**
	 * 智能同步文件（本地优先，缓存下载）
	 */
	async syncFilesIntelligently(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
	): Promise<{ paths: string[]; hasChanges: boolean }> {
		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			const resultPaths: string[] = [];
			const cacheDir = await this.getCacheDirectory();
			const filesDir = await this.getFilesDirectory();
			let hasChanges = false;

			// 确保缓存目录存在
			await mkdir(cacheDir, { recursive: true });

			// 检查每个文件的本地存在性
			for (let i = 0; i < packageInfo.originalPaths.length; i++) {
				let originalPath = packageInfo.originalPaths[i];
				// 确保originalPath是字符串，处理嵌套数组的情况
				if (Array.isArray(originalPath)) {
					// 如果是数组，查找有效的文件路径
					originalPath =
						originalPath.find(
							(item) =>
								typeof item === "string" &&
								(item.includes(":") ||
									item.includes("/") ||
									item.includes("\\")),
						) || originalPath[0];
				}
				// 确保originalPath是字符串
				if (typeof originalPath !== "string") {
					console.error("跳过无效的文件路径:", originalPath);
					continue;
				}

				const cachedFileName = `${packageInfo.itemId}_${i}_${this.getFileExtension(originalPath)}`;
				const cachedPath = await join(cacheDir, cachedFileName);

				// 提取原始文件名
				const { basename } = await import("@tauri-apps/api/path");
				const originalFileName = await basename(originalPath);
				const potentialLocalPath = await join(filesDir, originalFileName);

				let finalPath = originalPath;
				let needsDownload = false;

				try {
					const { exists } = await import("@tauri-apps/plugin-fs");
					const originalExists = await exists(originalPath);
					const potentialLocalExists = await exists(potentialLocalPath);
					const cachedExists = await exists(cachedPath);

					if (originalExists) {
						// 原始路径文件存在，直接使用
						finalPath = originalPath;
						console.log(`📁 使用原始路径文件: ${originalPath}`);
					} else if (potentialLocalExists) {
						// 用户文件目录中有同名文件，使用本地文件
						finalPath = potentialLocalPath;
						console.log(`📁 使用本地同名文件: ${potentialLocalPath}`);
					} else if (cachedExists) {
						// 缓存文件存在，使用缓存文件
						finalPath = cachedPath;
						console.log(`📁 使用缓存文件: ${cachedPath}`);
					} else {
						// 都不存在，需要下载
						needsDownload = true;
						finalPath = cachedPath;
						console.log(`⬇️ 需要下载文件到: ${finalPath}`);
					}
				} catch (error) {
					needsDownload = true;
					finalPath = cachedPath;
				}

				resultPaths.push(finalPath);

				// 如果需要下载，立即下载（单个文件）
				if (needsDownload) {
					const downloadSuccess = await this.downloadSingleFile(
						packageInfo,
						i,
						finalPath,
						webdavConfig,
					);
					if (downloadSuccess) {
						hasChanges = true;
						console.log(`✅ 文件下载成功: ${finalPath}`);
					} else {
						// 移除失败的路径
						resultPaths.pop();
						console.error(`❌ 文件下载失败: ${finalPath}`);
					}
				}
			}

			return { paths: resultPaths, hasChanges };
		} catch (error) {
			console.error("❌ 智能同步失败:", error);
			return { paths: [], hasChanges: false };
		}
	}

	/**
	 * 下载单个文件（从ZIP包中提取）
	 */
	private async downloadSingleFile(
		packageInfo: PackageInfo,
		fileIndex: number,
		targetPath: string,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			// 下载ZIP包
			const zipData = await this.downloadPackage(
				packageInfo.fileName,
				webdavConfig,
			);
			if (!zipData) {
				return false;
			}

			// 解压ZIP包
			const zip = await JSZip.loadAsync(zipData);

			// 找到对应的文件
			const files = Object.entries(zip.files);
			const fileEntry = files.find(
				([filename, file], index) => !file.dir && index === fileIndex,
			);

			if (!fileEntry) {
				console.error(`在ZIP包中找不到索引 ${fileIndex} 的文件`);
				return false;
			}

			const [filename, file] = fileEntry;
			const fileData = await file.async("arraybuffer");

			// 确保目标目录存在
			await this.ensureDirectoryExists(targetPath);

			// 保存文件
			await writeFile(targetPath, new Uint8Array(fileData));

			console.log(`📄 单个文件下载成功: ${targetPath}`);
			return true;
		} catch (error) {
			console.error(`❌ 单个文件下载失败: ${targetPath}`, error);
			return false;
		}
	}

	/**
	 * 下载并解包文件（保持向后兼容）
	 */
	async downloadAndUnpackFiles(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
		localOnly = false,
	): Promise<string[] | null> {
		const syncResult = await this.syncFilesIntelligently(packageInfo, config);
		return syncResult.paths.length > 0 ? syncResult.paths : null;
	}

	/**
	 * 智能上传文件包（带跨设备唯一性检查）
	 */
	async smartUploadPackage(
		itemId: string,
		itemType: string,
		paths: string[],
		config?: WebDAVConfig,
	): Promise<PackageInfo | null> {
		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			// 1. 检查文件大小限制
			const totalSize = await this.calculateTotalSize(paths);
			const maxPackageSize = this.getMaxPackageSize();
			if (totalSize > maxPackageSize) {
				this.addLog(
					"warning",
					`📦 文件包大小超限: ${this.formatFileSize(totalSize)} > ${this.formatFileSize(maxPackageSize)}`,
				);
				return null;
			}

			// 2. 生成本地包信息用于唯一性检查
			const localPackageInfo = await this.createLocalPackageInfo(
				itemId,
				itemType,
				paths,
				totalSize,
			);

			// 3. 检查云端是否已存在相同内容的包
			const cloudExists = await this.checkCloudPackageExists(
				localPackageInfo,
				webdavConfig,
			);

			if (cloudExists.exists) {
				return cloudExists.existingPackage || null;
			}

			// 4. 创建并上传ZIP包
			const zip = new JSZip();

			// 扁平化路径数组，处理嵌套数组的情况
			const flatPaths: string[] = [];
			for (const path of paths) {
				if (Array.isArray(path)) {
					// 如果path是数组，查找有效的文件路径
					for (const item of path) {
						if (typeof item === "string" && item.length > 0) {
							// 如果是有效的文件路径字符串
							if (
								item.includes(":") ||
								item.includes("/") ||
								item.includes("\\")
							) {
								flatPaths.push(item);
							}
						}
					}
				} else if (typeof path === "string" && path.length > 0) {
					// 如果path是字符串，直接添加
					flatPaths.push(path);
				}
			}

			for (let i = 0; i < flatPaths.length; i++) {
				const filePath = flatPaths[i];
				const fileName = `file_${i + 1}.${this.getFileExtension(filePath)}`;

				try {
					const data = await readFile(filePath);
					zip.file(fileName, data.buffer);
				} catch (error) {
					return null;
				}
			}

			// 生成ZIP文件
			const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });
			const checksum = await this.calculateChecksum(zipBuffer);

			// 最终包信息
			const finalPackageInfo: PackageInfo = {
				...localPackageInfo,
				checksum,
				compressedSize: zipBuffer.byteLength,
			};

			// 上传ZIP包
			const uploadSuccess = await this.uploadPackage(
				finalPackageInfo,
				zipBuffer,
				webdavConfig,
			);
			if (!uploadSuccess) {
				return null;
			}

			return finalPackageInfo;
		} catch (error) {
			return null;
		}
	}

	/**
	 * 检查云端是否已存在相同内容的包（优化版）
	 */
	private async checkCloudPackageExists(
		localPackageInfo: PackageInfo,
		webdavConfig: WebDAVConfig,
	): Promise<{ exists: boolean; existingPackage?: PackageInfo | null }> {
		try {
			const webdavDir = `${webdavConfig.path}/files/`;

			// 1. 使用固定的包名模式进行检测
			const priorityNames = [`${localPackageInfo.itemId}.zip`];

			// 2. 预计算本地校验和以供对比
			const localChecksum =
				await this.calculateLocalPackageChecksum(localPackageInfo);

			// 3. 检查优先包名
			for (const packageName of priorityNames) {
				const webdavPath = `${webdavDir}${packageName}`;
				const matchResult = await this.checkPackageMatch(
					webdavPath,
					packageName,
					localPackageInfo,
					localChecksum,
					webdavConfig,
				);

				if (matchResult.found) {
					return { exists: true, existingPackage: matchResult.package };
				}
			}

			return { exists: false };
		} catch (error) {
			return { exists: false };
		}
	}

	/**
	 * 预计算本地包的校验和
	 */
	private async calculateLocalPackageChecksum(
		localPackageInfo: PackageInfo,
	): Promise<string> {
		try {
			const localZip = new JSZip();

			for (let i = 0; i < localPackageInfo.originalPaths.length; i++) {
				let filePath = localPackageInfo.originalPaths[i];
				// 确保filePath是字符串，处理嵌套数组的情况
				if (Array.isArray(filePath)) {
					// 如果是数组，查找有效的文件路径
					filePath =
						filePath.find(
							(item) =>
								typeof item === "string" &&
								(item.includes(":") ||
									item.includes("/") ||
									item.includes("\\")),
						) || filePath[0];
				}
				// 确保filePath是字符串
				if (typeof filePath !== "string") {
					console.error("跳过无效的文件路径:", filePath);
					continue;
				}
				try {
					const data = await readFile(filePath);
					const fileName = `file_${i + 1}.${this.getFileExtension(filePath)}`;
					localZip.file(fileName, data.buffer);
				} catch (error) {
					console.error(`读取本地文件失败: ${filePath}`, error);
					continue;
				}
			}

			const localZipBuffer = await localZip.generateAsync({
				type: "arraybuffer",
			});
			return await this.calculateChecksum(localZipBuffer);
		} catch (error) {
			console.error("计算本地包校验和失败:", error);
			return "";
		}
	}

	/**
	 * 检查单个包是否匹配
	 */
	private async checkPackageMatch(
		webdavPath: string,
		packageName: string,
		localPackageInfo: PackageInfo,
		localChecksum: string,
		webdavConfig: WebDAVConfig,
	): Promise<{ found: boolean; package?: PackageInfo }> {
		try {
			const downloadResult = await downloadSyncData(webdavConfig, webdavPath);

			if (downloadResult.success && downloadResult.data) {
				const cloudPackageData = this.base64ToArrayBuffer(downloadResult.data);
				const cloudChecksum = await this.calculateChecksum(cloudPackageData);

				// 快速校验和对比
				if (cloudChecksum === localChecksum) {
					const existingPackage: PackageInfo = {
						packageId: localPackageInfo.packageId,
						itemId: localPackageInfo.itemId,
						itemType: localPackageInfo.itemType,
						fileName: packageName,
						originalPaths: localPackageInfo.originalPaths,
						size: localPackageInfo.size,
						checksum: cloudChecksum,
						compressedSize: cloudPackageData.byteLength,
					};

					return { found: true, package: existingPackage };
				}
			}

			return { found: false };
		} catch (error) {
			console.error(`检查包匹配失败: ${packageName}`, error);
			return { found: false };
		}
	}

	/**
	 * 创建本地包信息
	 */
	private async createLocalPackageInfo(
		itemId: string,
		itemType: string,
		paths: string[],
		totalSize: number,
	): Promise<PackageInfo> {
		// 使用固定的包名，避免时间戳导致的重复问题
		const fixedName = `${itemId}`;
		return {
			packageId: fixedName,
			itemId,
			itemType,
			fileName: `${fixedName}.zip`,
			originalPaths: paths,
			size: totalSize,
			checksum: "", // 稍后计算
			compressedSize: 0, // 稍后计算
		};
	}

	/**
	 * 上传文件包
	 */
	private async uploadPackage(
		packageInfo: PackageInfo,
		packageData: ArrayBuffer,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			const base64Content = this.arrayBufferToBase64(packageData);
			const webdavPath = `${webdavConfig.path}/files/${packageInfo.fileName}`;

			// 确保files目录存在
			const filesDirPath = `${webdavConfig.path}/files`;
			try {
				const { createDirectory } = await import("@/plugins/webdav");
				await createDirectory(webdavConfig, filesDirPath);
			} catch (dirError) {
				// 目录创建失败，继续尝试上传
			}

			// 检查文件是否已存在（二次确认）
			const downloadResult = await downloadSyncData(webdavConfig, webdavPath);
			if (downloadResult.success && downloadResult.data) {
				this.addLog(
					"info",
					`📦 检测到文件包已存在，跳过上传: ${packageInfo.fileName}`,
				);
				return true;
			}

			// 上传文件包
			const uploadResult = await uploadSyncData(
				webdavConfig,
				webdavPath,
				base64Content,
			);

			if (uploadResult.success) {
				return true;
			} else {
				// 如果遇到409错误，尝试删除后重新上传
				if (uploadResult.error_message?.includes("409")) {
					try {
						const { deleteFile } = await import("@/plugins/webdav");
						await deleteFile(webdavConfig, webdavPath);

						// 重新上传
						const retryResult = await uploadSyncData(
							webdavConfig,
							webdavPath,
							base64Content,
						);
						if (retryResult.success) {
							return true;
						}
					} catch (deleteError) {
						// 删除失败，返回失败
					}
				}

				return false;
			}
		} catch (error) {
			return false;
		}
	}

	/**
	 * 下载文件包
	 */
	private async downloadPackage(
		packageFileName: string,
		webdavConfig: WebDAVConfig,
	): Promise<ArrayBuffer | null> {
		try {
			const webdavPath = `${webdavConfig.path}/files/${packageFileName}`;
			const result = await downloadSyncData(webdavConfig, webdavPath);

			if (result.success && result.data) {
				return this.base64ToArrayBuffer(result.data);
			}

			return null;
		} catch (error) {
			console.error(`❌ 下载文件包失败: ${packageFileName}`, error);
			return null;
		}
	}

	/**
	 * 格式化文件大小
	 */
	private formatFileSize(bytes: number): string {
		const sizes = ["B", "KB", "MB", "GB"];
		if (bytes === 0) return "0 B";
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
	}

	/**
	 * 计算文件总大小
	 */
	private async calculateTotalSize(paths: string[]): Promise<number> {
		let totalSize = 0;
		const { metadata } = await import("tauri-plugin-fs-pro-api");

		// 扁平化路径数组，处理嵌套数组的情况
		const flatPaths: string[] = [];
		for (const path of paths) {
			if (Array.isArray(path)) {
				// 如果path是数组，检查是否包含字符串路径
				for (const item of path) {
					if (typeof item === "string" && item.length > 0) {
						// 如果是有效的文件路径字符串
						if (
							item.includes(":") ||
							item.includes("/") ||
							item.includes("\\")
						) {
							flatPaths.push(item);
						}
					}
				}
			} else if (typeof path === "string" && path.length > 0) {
				// 如果path是字符串，直接添加
				flatPaths.push(path);
			}
		}

		for (const path of flatPaths) {
			try {
				const { size } = await metadata(path);
				totalSize += size;
			} catch (error) {
				console.error(`获取文件大小失败: ${path}`, error);
				return 0;
			}
		}

		return totalSize;
	}

	/**
	 * 获取文件扩展名
	 */
	private getFileExtension(filePath: string): string {
		const parts = filePath.split(".");
		return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "bin";
	}

	/**
	 * 计算校验和
	 */
	private async calculateChecksum(data: ArrayBuffer): Promise<string> {
		if (typeof crypto !== "undefined" && crypto.subtle) {
			try {
				const hashBuffer = await crypto.subtle.digest("SHA-256", data);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
			} catch {
				// 回退到简单哈希
			}
		}

		// 简单哈希算法
		let hash1 = 5381,
			hash2 = 5273;
		const bytes = new Uint8Array(data);
		for (let i = 0; i < bytes.length; i++) {
			hash1 = ((hash1 << 5) + hash1) ^ bytes[i];
			hash2 = ((hash2 << 5) + hash2) ^ bytes[i];
		}
		return `${Math.abs(hash1).toString(16)}${Math.abs(hash2).toString(16)}`;
	}

	/**
	 * ArrayBuffer转Base64
	 */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	/**
	 * Base64转ArrayBuffer
	 */
	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	/**
	 * 获取WebDAV配置
	 */
	private async getWebDAVConfig(config?: WebDAVConfig): Promise<WebDAVConfig> {
		const effectiveConfig = config || this.config;
		if (!effectiveConfig) {
			throw new Error("WebDAV配置未设置");
		}
		return effectiveConfig;
	}

	/**
	 * 获取文件存储目录
	 */
	private async getFilesDirectory(): Promise<string> {
		const downloadsPath = await downloadDir();
		const ecoPasteDir = await join(downloadsPath, "EcoPaste");
		const filesDir = await join(ecoPasteDir, "files");
		return filesDir;
	}

	/**
	 * 获取缓存目录
	 */
	private async getCacheDirectory(): Promise<string> {
		const downloadsPath = await downloadDir();
		const ecoPasteDir = await join(downloadsPath, "EcoPaste");
		const cacheDir = await join(ecoPasteDir, "cache");
		return cacheDir;
	}

	/**
	 * 确保目录存在
	 */
	private async ensureDirectoryExists(filePath: string): Promise<void> {
		const { dirname } = await import("@tauri-apps/api/path");
		const dir = await dirname(filePath);
		await mkdir(dir, { recursive: true });
	}

	/**
	 * 清理状态
	 */
	clearCurrentState(): void {
		console.log("🗑️ 文件包管理器状态已清理");
	}
}

// 导出单例实例
export const filePackageManager = new FilePackageManager();
