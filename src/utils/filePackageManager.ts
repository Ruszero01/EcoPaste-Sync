import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import { getGlobalSyncErrorTracker } from "@/utils/syncErrorTracker";
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

export class FilePackageManager {
	private readonly DEFAULT_MAX_PACKAGE_SIZE = 50 * 1024 * 1024; // 50MB per package
	private config: WebDAVConfig | null = null;
	private syncModeConfig: any = null;
	private logCallback?: (
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) => void;

	setWebDAVConfig(config: WebDAVConfig): void {
		this.config = config;
	}

	setLogCallback(
		callback: (
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
		) => void,
	): void {
		this.logCallback = callback;
	}

	setSyncModeConfig(config: any): void {
		this.syncModeConfig = config;
	}

	private getMaxPackageSize(): number {
		if (this.syncModeConfig?.fileLimits?.maxPackageSize) {
			return this.syncModeConfig.fileLimits.maxPackageSize * 1024 * 1024;
		}
		return this.DEFAULT_MAX_PACKAGE_SIZE;
	}

	private addLog(
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) {
		if (this.logCallback) {
			this.logCallback(level, message, data);
		}
	}

	async packageAndUploadFiles(
		itemId: string,
		itemType: string,
		paths: string[],
		config?: WebDAVConfig,
	): Promise<PackageInfo | null> {
		return this.smartUploadPackage(itemId, itemType, paths, config);
	}
	async syncFilesIntelligently(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
	): Promise<{ paths: string[]; hasChanges: boolean }> {
		const globalErrorTracker = getGlobalSyncErrorTracker();

		// 检查全局错误状态
		if (globalErrorTracker.hasFailedTooManyTimes(packageInfo.packageId)) {
			this.addLog(
				"warning",
				`⚠️ 包 ${packageInfo.packageId} 已失败过多，跳过同步`,
				{
					packageId: packageInfo.packageId,
					itemId: packageInfo.itemId,
				},
			);
			return { paths: [], hasChanges: false };
		}

		// 首先检查WebDAV配置是否可用
		const isConfigAvailable = await this.isWebDAVConfigAvailable(config);
		const webdavConfig = isConfigAvailable
			? await this.getWebDAVConfig(config)
			: null;

		try {
			this.addLog("info", `🔄 开始智能同步文件包: ${packageInfo.packageId}`, {
				itemId: packageInfo.itemId,
				itemType: packageInfo.itemType,
				fileName: packageInfo.fileName,
				originalPathsCount: packageInfo.originalPaths.length,
				hasWebDAVConfig: isConfigAvailable,
			});

			const resultPaths: string[] = [];
			const cacheDir = await this.getCacheDirectory();
			const filesDir = await this.getFilesDirectory();
			let hasChanges = false;

			await mkdir(cacheDir, { recursive: true });

			for (let i = 0; i < packageInfo.originalPaths.length; i++) {
				let originalPath = packageInfo.originalPaths[i];

				if (Array.isArray(originalPath)) {
					const foundPath = originalPath.find(
						(item) =>
							typeof item === "string" &&
							(item.includes(":") || item.includes("/") || item.includes("\\")),
					);
					if (foundPath) {
						originalPath = foundPath;
					} else {
						originalPath = originalPath[0];
					}
				}
				// 确保originalPath是字符串
				if (typeof originalPath !== "string") {
					this.addLog(
						"error",
						`❌ 跳过无效的文件路径: ${JSON.stringify(originalPath)}`,
						{
							type: typeof originalPath,
							index: i,
						},
					);
					continue;
				}

				const cachedFileName = `${packageInfo.packageId}_${packageInfo.itemId}_${i}_${this.getFileExtension(originalPath)}`;
				const cachedPath = await join(cacheDir, cachedFileName);

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
						finalPath = originalPath;
					} else if (potentialLocalExists) {
						finalPath = potentialLocalPath;
					} else if (cachedExists) {
						finalPath = cachedPath;
					} else {
						needsDownload = true;
						finalPath = cachedPath;
					}
				} catch (error) {
					this.addLog("error", "❌ 检查文件存在性失败", {
						error: error instanceof Error ? error.message : String(error),
						originalPath,
						potentialLocalPath,
						cachedPath,
					});
					needsDownload = true;
					finalPath = cachedPath;
				}

				resultPaths.push(finalPath);

				if (needsDownload) {
					if (!isConfigAvailable || !webdavConfig) {
						resultPaths.pop();
						continue;
					}

					const MAX_RETRY_ATTEMPTS = 2;
					let downloadSuccess = false;
					let lastError: Error | null = null;

					for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
						try {
							downloadSuccess = await this.downloadSingleFile(
								packageInfo,
								i,
								finalPath,
								webdavConfig,
							);

							if (downloadSuccess) {
								break;
							}
						} catch (error) {
							lastError =
								error instanceof Error ? error : new Error(String(error));
							if (attempt < MAX_RETRY_ATTEMPTS) {
								await new Promise((resolve) =>
									setTimeout(resolve, 1000 * attempt),
								);
							}
						}
					}

					if (downloadSuccess) {
						hasChanges = true;
					} else {
						resultPaths.pop();
						const errorMessage = lastError?.message || "未知错误";
						globalErrorTracker.recordError(
							packageInfo.packageId,
							`文件下载失败: ${errorMessage}`,
						);
					}
				}
			}

			if (hasChanges && resultPaths.length > 0) {
				try {
					const { updateSQL } = await import("@/database");
					await updateSQL("history", {
						id: packageInfo.itemId,
						value: JSON.stringify(resultPaths),
					});
					globalErrorTracker.clearError(packageInfo.packageId);
				} catch (dbError) {
					globalErrorTracker.recordError(
						packageInfo.packageId,
						`数据库更新失败: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
					);
				}
			}

			return { paths: resultPaths, hasChanges };
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// 记录到全局错误跟踪器
			globalErrorTracker.recordError(
				packageInfo.packageId,
				`智能同步失败: ${errorMessage}`,
			);

			this.addLog("error", "❌ 智能同步失败", {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				packageInfo: {
					packageId: packageInfo.packageId,
					itemId: packageInfo.itemId,
					fileName: packageInfo.fileName,
				},
			});
			return { paths: [], hasChanges: false };
		}
	}
	private async downloadSingleFile(
		packageInfo: PackageInfo,
		fileIndex: number,
		targetPath: string,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			if (typeof targetPath !== "string" || targetPath.length === 0) {
				return false;
			}

			if (
				targetPath.includes('["') ||
				targetPath.includes('"]') ||
				targetPath.includes('":{"')
			) {
				return false;
			}

			const zipData = await this.downloadPackage(
				packageInfo.fileName,
				webdavConfig,
			);
			if (!zipData) {
				return false;
			}

			const zip = await JSZip.loadAsync(zipData);
			const files = Object.entries(zip.files);

			const fileEntry = files.find(
				([_filename, file], index) => !file.dir && index === fileIndex,
			);

			if (!fileEntry) {
				return false;
			}

			const [_filename, file] = fileEntry;
			const fileData = await file.async("arraybuffer");

			await this.ensureDirectoryExists(targetPath);
			await writeFile(targetPath, new Uint8Array(fileData));

			const { exists } = await import("@tauri-apps/plugin-fs");
			const fileExists = await exists(targetPath);
			if (fileExists) {
				try {
					const { lstat } = await import("@tauri-apps/plugin-fs");
					const stat = await lstat(targetPath);
					const fileSize = stat.size || 0;

					if (fileSize > 0) {
						return true;
					}

					return false;
				} catch {
					return true;
				}
			}

			return false;
		} catch (error) {
			this.addLog("error", `❌ 单个文件下载失败: ${targetPath}`, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				packageInfo: {
					packageId: packageInfo.packageId,
					fileName: packageInfo.fileName,
					itemId: packageInfo.itemId,
				},
				fileIndex,
				targetPath,
			});

			try {
				const { exists, remove } = await import("@tauri-apps/plugin-fs");
				if (await exists(targetPath)) {
					await remove(targetPath);
				}
			} catch {}

			return false;
		}
	}

	async downloadAndUnpackFiles(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
		_localOnly = false,
	): Promise<string[] | null> {
		const syncResult = await this.syncFilesIntelligently(packageInfo, config);
		return syncResult.paths.length > 0 ? syncResult.paths : null;
	}

	async smartUploadPackage(
		itemId: string,
		itemType: string,
		paths: string[],
		config?: WebDAVConfig,
	): Promise<PackageInfo | null> {
		const isConfigAvailable = await this.isWebDAVConfigAvailable(config);
		if (!isConfigAvailable) {
			return null;
		}

		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			const totalSize = await this.calculateTotalSize(paths);
			const maxPackageSize = this.getMaxPackageSize();

			if (totalSize > maxPackageSize) {
				return null;
			}

			const localPackageInfo = await this.createLocalPackageInfo(
				itemId,
				itemType,
				paths,
				totalSize,
			);

			const skipCloudCheck = totalSize < 1024 * 1024;
			if (!skipCloudCheck) {
				const cloudExists = await this.checkCloudPackageExists(
					localPackageInfo,
					webdavConfig,
				);

				if (cloudExists.exists) {
					return cloudExists.existingPackage || null;
				}
			}

			const zip = new JSZip();
			const flatPaths: string[] = [];
			for (const path of paths) {
				if (
					typeof path === "string" &&
					(path.includes('{"') ||
						path.includes('"}') ||
						path.includes("packageId"))
				) {
					continue;
				}

				if (Array.isArray(path)) {
					for (const item of path) {
						if (typeof item === "string" && item.length > 0) {
							if (
								item.includes('{"') ||
								item.includes('"}') ||
								item.includes("packageId")
							) {
								continue;
							}

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
					flatPaths.push(path);
				}
			}

			for (let i = 0; i < flatPaths.length; i++) {
				const filePath = flatPaths[i];
				const fileName = `file_${i + 1}.${this.getFileExtension(filePath)}`;

				try {
					const normalizedPath = this.normalizePath(filePath);
					const data = await readFile(normalizedPath);
					zip.file(fileName, new Uint8Array(data));
				} catch {}
			}

			const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });
			const checksum = await this.calculateChecksum(zipBuffer);

			const finalPackageInfo: PackageInfo = {
				...localPackageInfo,
				checksum,
				compressedSize: zipBuffer.byteLength,
			};

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
			this.addLog("error", "❌ 智能上传异常", error);
			return null;
		}
	}

	private async checkCloudPackageExists(
		localPackageInfo: PackageInfo,
		webdavConfig: WebDAVConfig,
	): Promise<{ exists: boolean; existingPackage?: PackageInfo | null }> {
		try {
			const webdavDir = `${webdavConfig.path}/files/`;
			const priorityNames = [`${localPackageInfo.itemId}.zip`];

			const localChecksum =
				await this.calculateLocalPackageChecksum(localPackageInfo);

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
			this.addLog("error", "❌ 检查云端包存在性异常", error);
			return { exists: false };
		}
	}

	private async calculateLocalPackageChecksum(
		localPackageInfo: PackageInfo,
	): Promise<string> {
		try {
			const localZip = new JSZip();

			for (let i = 0; i < localPackageInfo.originalPaths.length; i++) {
				let filePath = localPackageInfo.originalPaths[i];
				if (Array.isArray(filePath)) {
					filePath =
						filePath.find(
							(item) =>
								typeof item === "string" &&
								(item.includes(":") ||
									item.includes("/") ||
									item.includes("\\")),
						) || filePath[0];
				}
				if (typeof filePath !== "string") {
					continue;
				}
				try {
					const normalizedPath = this.normalizePath(filePath);
					const data = await readFile(normalizedPath);
					const fileName = `file_${i + 1}.${this.getFileExtension(filePath)}`;
					localZip.file(fileName, new Uint8Array(data));
				} catch {}
			}

			const localZipBuffer = await localZip.generateAsync({
				type: "arraybuffer",
			});
			return await this.calculateChecksum(localZipBuffer);
		} catch (error) {
			this.addLog("error", "❌ 计算本地包校验和失败", error);
			return "";
		}
	}

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
			this.addLog("error", `❌ 检查包匹配失败: ${packageName}`, error);
			return { found: false };
		}
	}

	private async createLocalPackageInfo(
		itemId: string,
		itemType: string,
		paths: string[],
		totalSize: number,
	): Promise<PackageInfo> {
		const fixedName = `${itemId}`;
		return {
			packageId: fixedName,
			itemId,
			itemType,
			fileName: `${fixedName}.zip`,
			originalPaths: paths,
			size: totalSize,
			checksum: "",
			compressedSize: 0,
		};
	}

	private async uploadPackage(
		packageInfo: PackageInfo,
		packageData: ArrayBuffer,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			const base64Content = this.arrayBufferToBase64(packageData);
			const webdavPath = `${webdavConfig.path}/files/${packageInfo.fileName}`;

			const filesDirPath = `${webdavConfig.path}/files`;
			try {
				const { createDirectory } = await import("@/plugins/webdav");
				await createDirectory(webdavConfig, filesDirPath);
			} catch (_dirError) {}

			const downloadResult = await downloadSyncData(webdavConfig, webdavPath);
			if (downloadResult.success && downloadResult.data) {
				return true;
			}

			const uploadResult = await uploadSyncData(
				webdavConfig,
				webdavPath,
				base64Content,
			);

			if (uploadResult.success) {
				return true;
			}
			if (uploadResult.error_message?.includes("409")) {
				try {
					const { deleteFile } = await import("@/plugins/webdav");
					await deleteFile(webdavConfig, webdavPath);

					const retryResult = await uploadSyncData(
						webdavConfig,
						webdavPath,
						base64Content,
					);
					if (retryResult.success) {
						return true;
					}
				} catch (_deleteError) {}
			}

			return false;
		} catch (error) {
			this.addLog("error", "❌ 上传包异常", error);
			return false;
		}
	}

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
			this.addLog("error", `❌ 下载文件包失败: ${packageFileName}`, error);
			return null;
		}
	}

	private async calculateTotalSize(paths: string[]): Promise<number> {
		let totalSize = 0;
		const { lstat } = await import("@tauri-apps/plugin-fs");

		const flatPaths: string[] = [];
		for (const path of paths) {
			if (
				typeof path === "string" &&
				(path.includes('{"') ||
					path.includes('"}') ||
					path.includes("packageId"))
			) {
				continue;
			}

			if (Array.isArray(path)) {
				for (const item of path) {
					if (
						typeof item === "string" &&
						(item.includes('{"') ||
							item.includes('"}') ||
							item.includes("packageId"))
					) {
						continue;
					}

					if (typeof item === "string" && item.length > 0) {
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
				flatPaths.push(path);
			}
		}

		for (const path of flatPaths) {
			try {
				const normalizedPath = this.normalizePath(path);
				const stat = await lstat(normalizedPath);
				totalSize += stat.size || 0;
			} catch {}
		}

		return totalSize;
	}

	private getFileExtension(filePath: string): string {
		const parts = filePath.split(".");
		return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "bin";
	}

	private async calculateChecksum(data: ArrayBuffer): Promise<string> {
		if (typeof crypto !== "undefined" && crypto.subtle) {
			try {
				const hashBuffer = await crypto.subtle.digest("SHA-256", data);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
			} catch {}
		}

		let hash1 = 5381;
		let hash2 = 5273;
		const bytes = new Uint8Array(data);
		for (let i = 0; i < bytes.length; i++) {
			hash1 = ((hash1 << 5) + hash1) ^ bytes[i];
			hash2 = ((hash2 << 5) + hash2) ^ bytes[i];
		}
		return `${Math.abs(hash1).toString(16)}${Math.abs(hash2).toString(16)}`;
	}

	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	private async getWebDAVConfig(config?: WebDAVConfig): Promise<WebDAVConfig> {
		const effectiveConfig = config || this.config;
		if (!effectiveConfig) {
			throw new Error("WebDAV配置未设置");
		}
		return effectiveConfig;
	}

	private async isWebDAVConfigAvailable(
		config?: WebDAVConfig,
	): Promise<boolean> {
		const effectiveConfig = config || this.config;
		if (!effectiveConfig) {
			return false;
		}

		if (
			!effectiveConfig.url ||
			!effectiveConfig.username ||
			!effectiveConfig.password
		) {
			return false;
		}

		return true;
	}

	private async getFilesDirectory(): Promise<string> {
		const downloadsPath = await downloadDir();
		const ecoPasteDir = await join(downloadsPath, "EcoPaste");
		const filesDir = await join(ecoPasteDir, "files");
		return filesDir;
	}

	private async getCacheDirectory(): Promise<string> {
		const downloadsPath = await downloadDir();
		const ecoPasteDir = await join(downloadsPath, "EcoPaste");
		const cacheDir = await join(ecoPasteDir, "cache");
		return cacheDir;
	}

	private async ensureDirectoryExists(filePath: string): Promise<void> {
		const { dirname } = await import("@tauri-apps/api/path");
		const dir = await dirname(filePath);
		await mkdir(dir, { recursive: true });
	}

	clearCurrentState(): void {}

	private normalizePath(filePath: string): string {
		if (!filePath || typeof filePath !== "string") {
			return filePath;
		}

		let normalizedPath = filePath.replace(/\\/g, "/");
		normalizedPath = normalizedPath.replace(/\/+/g, "/");

		if (normalizedPath.match(/^[a-zA-Z]:\//)) {
			return normalizedPath;
		}

		if (
			!normalizedPath.startsWith("/") &&
			!normalizedPath.match(/^[a-zA-Z]:\//)
		) {
			return normalizedPath;
		}

		return normalizedPath;
	}

	async deleteRemotePackage(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
	): Promise<boolean> {
		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			const basePath = webdavConfig.path.startsWith("/")
				? webdavConfig.path.substring(1)
				: webdavConfig.path;
			const webdavPath = basePath.endsWith("/")
				? `${basePath}files/${packageInfo.fileName}`
				: `${basePath}/files/${packageInfo.fileName}`;

			const downloadResult = await downloadSyncData(webdavConfig, webdavPath);

			if (!downloadResult.success) {
				return true;
			}

			const { deleteFile } = await import("@/plugins/webdav");
			const deleteSuccess = await deleteFile(webdavConfig, webdavPath);

			if (deleteSuccess) {
				return true;
			}

			return false;
		} catch (error) {
			this.addLog("error", `❌ 删除远程文件包异常: ${packageInfo.fileName}`, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				itemId: packageInfo.itemId,
				webdavConfig: {
					url: webdavConfig.url,
					path: webdavConfig.path,
					username: webdavConfig.username,
				},
			});
			return false;
		}
	}

	async deleteRemotePackages(
		packageInfos: PackageInfo[],
		config?: WebDAVConfig,
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const webdavConfig = await this.getWebDAVConfig(config);
		const results = { success: 0, failed: 0, errors: [] as string[] };

		for (const packageInfo of packageInfos) {
			try {
				const success = await this.deleteRemotePackage(
					packageInfo,
					webdavConfig,
				);
				if (success) {
					results.success++;
				} else {
					results.failed++;
					results.errors.push(`删除失败: ${packageInfo.fileName}`);
				}
			} catch (error) {
				results.failed++;
				const errorMsg = `删除异常: ${packageInfo.fileName} - ${error instanceof Error ? error.message : String(error)}`;
				results.errors.push(errorMsg);
			}
		}

		return results;
	}

	async unpackRemotePackageData(
		remoteItem: any,
		currentDeviceId: string,
	): Promise<any> {
		// 快速路径：非包模式数据直接返回
		if (!remoteItem._syncType || remoteItem._syncType !== "package_files") {
			return remoteItem;
		}

		// 快速路径：非文件类型直接返回
		if (remoteItem.type !== "image" && remoteItem.type !== "files") {
			return remoteItem;
		}

		try {
			let packageInfo: PackageInfo | null = null;
			try {
				packageInfo = JSON.parse(remoteItem.value) as PackageInfo;
			} catch {
				return remoteItem;
			}

			if (
				!packageInfo ||
				!packageInfo.packageId ||
				!packageInfo.originalPaths
			) {
				return remoteItem;
			}

			const isConfigAvailable = await this.isWebDAVConfigAvailable();
			if (!isConfigAvailable) {
				return remoteItem;
			}

			const webdavConfig = await this.getWebDAVConfig();
			const isFromCurrentDevice = remoteItem.deviceId === currentDeviceId;

			if (isFromCurrentDevice) {
				const fastRecoveredPaths = await this.fastRecoverLocalPaths(
					packageInfo.originalPaths,
				);

				if (fastRecoveredPaths.length > 0) {
					let finalValue: string;
					if (remoteItem.type === "image" && fastRecoveredPaths.length === 1) {
						finalValue = fastRecoveredPaths[0];
					} else {
						finalValue = JSON.stringify(fastRecoveredPaths);
					}

					const unpackedItem = {
						...remoteItem,
						value: finalValue,
						_syncType: undefined,
						fileSize: await this.calculatePathsSize(fastRecoveredPaths),
					};

					return unpackedItem;
				}
			}

			const isSmallFile = packageInfo.size < 1024 * 1024;
			if (isSmallFile && isFromCurrentDevice) {
				const aggressiveRecoveredPaths = await this.aggressiveRecoverLocalPaths(
					packageInfo.originalPaths,
				);

				if (aggressiveRecoveredPaths.length > 0) {
					let finalValue: string;
					if (
						remoteItem.type === "image" &&
						aggressiveRecoveredPaths.length === 1
					) {
						finalValue = aggressiveRecoveredPaths[0];
					} else {
						finalValue = JSON.stringify(aggressiveRecoveredPaths);
					}

					const unpackedItem = {
						...remoteItem,
						value: finalValue,
						_syncType: undefined,
						fileSize: await this.calculatePathsSize(aggressiveRecoveredPaths),
					};

					return unpackedItem;
				}
			}

			const syncResult = await this.syncFilesIntelligently(
				packageInfo,
				webdavConfig,
			);

			if (syncResult.hasChanges && syncResult.paths.length > 0) {
				let finalValue: string;
				if (remoteItem.type === "image" && syncResult.paths.length === 1) {
					finalValue = syncResult.paths[0];
				} else {
					finalValue = JSON.stringify(syncResult.paths);
				}

				const unpackedItem = {
					...remoteItem,
					value: finalValue,
					_syncType: undefined,
					fileSize:
						syncResult.paths.length > 0
							? await this.calculatePathsSize(syncResult.paths)
							: remoteItem.fileSize,
				};

				return unpackedItem;
			}

			if (syncResult.paths.length > 0) {
				let finalValue: string;
				if (remoteItem.type === "image" && syncResult.paths.length === 1) {
					finalValue = syncResult.paths[0];
				} else {
					finalValue = JSON.stringify(syncResult.paths);
				}

				const unpackedItem = {
					...remoteItem,
					value: finalValue,
					_syncType: undefined,
				};

				return unpackedItem;
			}

			return remoteItem;
		} catch (error) {
			this.addLog("error", `❌ 解包远程数据失败: ${remoteItem.id}`, {
				error: error instanceof Error ? error.message : String(error),
				itemId: remoteItem.id,
				itemType: remoteItem.type,
			});
			return remoteItem;
		}
	}

	private async fastRecoverLocalPaths(
		originalPaths: string[],
	): Promise<string[]> {
		const recoveredPaths: string[] = [];
		const { exists } = await import("@tauri-apps/plugin-fs");

		for (const originalPath of originalPaths) {
			if (typeof originalPath === "string" && (await exists(originalPath))) {
				recoveredPaths.push(originalPath);
			}
		}

		return recoveredPaths;
	}

	private async aggressiveRecoverLocalPaths(
		originalPaths: string[],
	): Promise<string[]> {
		const recoveredPaths: string[] = [];
		const { exists } = await import("@tauri-apps/plugin-fs");

		for (let i = 0; i < originalPaths.length; i++) {
			let originalPath = originalPaths[i];

			if (Array.isArray(originalPath)) {
				const foundPath = originalPath.find(
					(item) =>
						typeof item === "string" &&
						(item.includes(":") || item.includes("/") || item.includes("\\")),
				);
				if (foundPath) {
					originalPath = foundPath;
				} else {
					originalPath = originalPath[0];
				}
			}

			if (typeof originalPath !== "string") {
				continue;
			}

			if (await exists(originalPath)) {
				recoveredPaths.push(originalPath);
			}
		}

		return recoveredPaths;
	}

	private async calculatePathsSize(paths: string[]): Promise<number> {
		let totalSize = 0;
		const { lstat } = await import("@tauri-apps/plugin-fs");

		for (const path of paths) {
			try {
				const stat = await lstat(path);
				totalSize += stat.size || 0;
			} catch {}
		}

		return totalSize;
	}
}

// 导出单例实例
export const filePackageManager = new FilePackageManager();
