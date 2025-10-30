import type { WebDAVConfig } from "@/plugins/webdav";
import { deleteFile, downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import JSZip from "jszip";

interface ZipFileInfo {
	fileName: string;
	originalPath: string;
	size: number;
	compressedSize: number;
	checksum: string;
	fileType: string;
}

interface ZipImageInfo {
	originalPath: string;
	fileInfo: ZipFileInfo;
	zipName: string;
}

/**
 * ZIP文件管理器 - 使用ZIP压缩包替代分段文件存储
 */
export class ZipFileManager {
	private readonly ZIP_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB per ZIP
	private readonly LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB - max file limit
	private config: WebDAVConfig | null = null;
	private currentZip: JSZip | null = null;
	private currentZipName = "";
	private currentZipSize = 0;

	/**
	 * 设置WebDAV配置
	 */
	setWebDAVConfig(config: WebDAVConfig): void {
		this.config = config;
	}

	/**
	 * 添加文件到ZIP压缩包
	 */
	async addFile(
		filePath: string,
		compressedData: ArrayBuffer,
		itemType: string,
		config?: WebDAVConfig,
	): Promise<{ zipName: string; fileInfo: ZipFileInfo }> {
		const fileName = filePath.split(/[\\\\/]/).pop() || "file";
		const fileSize = compressedData.byteLength;
		const checksum = await this.calculateChecksum(compressedData);

		// 大于10MB的文件直接跳过
		if (fileSize > this.LARGE_FILE_THRESHOLD) {
			throw new Error(
				`文件过大，跳过上传: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB > 10MB)`,
			);
		}

		// 确保有当前ZIP包
		if (!this.currentZip) {
			this.currentZip = new JSZip();
			this.currentZipName = this.generateZipName();
			this.currentZipSize = 0;
		}

		// 检查是否需要新的ZIP包
		if (this.currentZipSize + fileSize > this.ZIP_SIZE_LIMIT) {
			await this.finalizeCurrentZip(config);
			this.currentZip = new JSZip();
			this.currentZipName = this.generateZipName();
			this.currentZipSize = 0;
		}

		// 生成唯一的文件名（避免冲突）
		const uniqueFileName = this.generateUniqueFileName(fileName);

		// 添加文件到ZIP
		this.currentZip.file(uniqueFileName, compressedData);
		this.currentZipSize += fileSize;

		const fileInfo: ZipFileInfo = {
			fileName: uniqueFileName,
			originalPath: filePath,
			size: compressedData.byteLength,
			compressedSize: compressedData.byteLength,
			checksum,
			fileType: itemType,
		};

		return {
			zipName: this.currentZipName,
			fileInfo,
		};
	}

	/**
	 * 完成当前ZIP包并上传
	 */
	async finalizeCurrentZip(config?: WebDAVConfig): Promise<void> {
		if (!this.currentZip || this.currentZipSize === 0) {
			return;
		}

		const webdavConfig = await this.getWebDAVConfig(config);

		// 确保ZIP文件目录存在
		await this.ensureZipDirectoryExists(webdavConfig);

		const zipData = await this.currentZip.generateAsync({
			type: "uint8array",
		});
		const base64Content = this.arrayBufferToBase64(zipData.buffer);

		let uploadAttempts = 0;
		const maxAttempts = 3;
		let success = false;
		let finalZipName = this.currentZipName;

		while (!success && uploadAttempts < maxAttempts) {
			uploadAttempts++;

			// 每次重试都使用新的文件名（除了第一次）
			if (uploadAttempts > 1) {
				finalZipName = this.generateZipName();
			}

			try {
				const webdavPath = this.getZipWebDAVPath(finalZipName);

				// 检查配置完整性
				if (
					!webdavConfig.url ||
					!webdavConfig.username ||
					!webdavConfig.password
				) {
					throw new Error("WebDAV配置不完整");
				}

				const uploadResult = await uploadSyncData(
					webdavConfig,
					webdavPath,
					base64Content,
				);

				if (uploadResult.success) {
					// 验证ZIP包确实可以下载
					const verificationZip = await this.downloadZip(
						finalZipName,
						webdavConfig,
					);
					if (verificationZip) {
						success = true;
					} else {
					}
				} else {
					// 处理409冲突
					if (
						uploadResult.error_message?.includes("HTTP 409") ||
						uploadResult.error_message?.includes("Conflict")
					) {
						// 验证文件是否真的存在
						const existingZip = await this.downloadZip(
							finalZipName,
							webdavConfig,
						);
						if (existingZip) {
							success = true;
						} else {
							if (uploadAttempts >= maxAttempts) {
								throw new Error(
									`ZIP包上传失败，已达到最大重试次数: ${maxAttempts}`,
								);
							}
						}
					} else {
						if (uploadAttempts >= maxAttempts) {
							throw new Error(
								`ZIP包上传失败: ${uploadResult.error_message || "未知错误"}`,
							);
						}
					}
				}
			} catch (error) {
				console.error(`❌ 上传异常 (${uploadAttempts}/${maxAttempts}):`, error);
				if (uploadAttempts >= maxAttempts) {
					throw error;
				}
			}

			// 添加延迟，避免服务器端的缓存或锁定问题
			if (!success && uploadAttempts < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}

		if (!success) {
			throw new Error(`ZIP包上传最终失败，已重试 ${maxAttempts} 次`);
		}

		// 更新当前ZIP名称为实际成功上传的名称
		this.currentZipName = finalZipName;
	}

	/**
	 * 下载ZIP包
	 */
	async downloadZip(
		zipName: string,
		config?: WebDAVConfig,
	): Promise<JSZip | null> {
		try {
			const webdavConfig = await this.getWebDAVConfig(config);
			const webdavPath = this.getZipWebDAVPath(zipName);

			const result = await downloadSyncData(webdavConfig, webdavPath);

			if (result.success && result.data && result.data.length > 0) {
				try {
					const zipData = this.base64ToArrayBuffer(result.data);

					// 验证数据完整性
					if (zipData.byteLength === 0) {
						console.error(`❌ ZIP包数据为空: ${zipName}`);
						return null;
					}

					const zip = await JSZip.loadAsync(zipData);
					const fileCount = Object.keys(zip.files).length;

					// 验证ZIP包完整性 - 确保至少有一些文件
					if (fileCount === 0) {
						console.warn(`⚠️ ZIP包为空: ${zipName}`);
					}

					return zip;
				} catch (zipError) {
					console.error(`❌ ZIP包解压失败: ${zipName}`, zipError);
					return null;
				}
			} else {
				console.error(`❌ ZIP包下载失败或无数据: ${zipName}`, {
					success: result.success,
					error: result.error_message,
				});
			}

			return null;
		} catch (error) {
			console.error(`❌ ZIP包下载异常: ${zipName}`, error);
			return null;
		}
	}

	/**
	 * 从ZIP包中获取文件
	 */
	async getFileFromZip(
		zipName: string,
		fileName: string,
		config?: WebDAVConfig,
	): Promise<ArrayBuffer | null> {
		const zip = await this.downloadZip(zipName, config);
		if (!zip) {
			return null;
		}

		try {
			const file = zip.file(fileName);
			if (!file) {
				console.error(`❌ ZIP包中找不到文件: ${fileName}`);
				return null;
			}

			const fileData = await file.async("uint8array");
			return fileData.buffer;
		} catch (error) {
			console.error(`❌ 从ZIP包中提取文件失败: ${fileName}`, error);
			return null;
		}
	}

	/**
	 * 批量下载ZIP包中的图片文件
	 */
	async batchDownloadImages(
		imageDataList: ZipImageInfo[],
		config?: WebDAVConfig,
	): Promise<Map<string, JSZip>> {
		const zipMap = new Map<string, JSZip>();

		// 防御性检查
		if (!imageDataList || !Array.isArray(imageDataList)) {
			console.warn("⚠️ imageDataList 不是有效数组，返回空Map");
			return zipMap;
		}

		// 收集所有需要下载的ZIP包
		const zipNames = new Set<string>();
		for (const imageData of imageDataList) {
			if (imageData?.zipName) {
				zipNames.add(imageData.zipName);
			} else {
				console.warn("⚠️ 跳过无效的imageData:", imageData);
			}
		}

		// 批量下载ZIP包
		for (const zipName of zipNames) {
			const zip = await this.downloadZip(zipName, config);
			if (zip) {
				zipMap.set(zipName, zip);
			} else {
				console.error(`❌ ZIP包下载失败: ${zipName}`);
			}
		}
		return zipMap;
	}

	/**
	 * 生成ZIP包名称
	 */
	private generateZipName(): string {
		const timestamp = Date.now();
		const random1 = Math.random().toString(36).substring(2, 8);
		const random2 = Math.random().toString(36).substring(3, 9);
		const random3 = Math.random().toString(36).substring(4, 8);
		return `eco_images_${timestamp}_${random1}_${random2}_${random3}.zip`;
	}

	/**
	 * 生成唯一文件名
	 */
	private generateUniqueFileName(originalName: string): string {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 8);
		const extension = originalName.includes(".")
			? originalName.substring(originalName.lastIndexOf("."))
			: "";
		const baseName = originalName.includes(".")
			? originalName.substring(0, originalName.lastIndexOf("."))
			: originalName;
		return `${baseName}_${timestamp}_${random}${extension}`;
	}

	/**
	 * 获取ZIP包WebDAV路径
	 */
	private getZipWebDAVPath(zipName: string): string {
		return `/EcoPaste/zip_files/${zipName}`;
	}

	/**
	 * 确保ZIP文件目录存在
	 */
	private async ensureZipDirectoryExists(config: WebDAVConfig): Promise<void> {
		try {
			const { createDirectory } = await import("@/plugins/webdav");
			const _result = await createDirectory(config, "/EcoPaste/zip_files");
		} catch (_error) {
			// 忽略目录创建错误，因为目录可能已经存在
		}
	}

	/**
	 * 保存ZIP包索引
	 */
	private async saveZipIndex(
		zipName: string,
		size: number,
		files: string[],
	): Promise<void> {
		const appDataPath = await appDataDir();
		const indexDir = await join(appDataPath, "zip_files");

		try {
			await mkdir(indexDir, { recursive: true });
		} catch {
			// 目录可能已存在
		}

		const indexPath = await join(indexDir, `${zipName}.json`);
		const indexData = {
			zipName,
			webdavPath: this.getZipWebDAVPath(zipName),
			totalSize: size,
			files,
			createdAt: Date.now(),
		};

		await writeFile(indexPath, JSON.stringify(indexData, null, 2));
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
	 * 计算校验和
	 */
	private async calculateChecksum(data: ArrayBuffer): Promise<string> {
		// 使用Web Crypto API的SHA-256
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
		let hash1 = 5381;
		let hash2 = 5273;
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
	 * 删除文件（如果存在）
	 */
	private async deleteFileIfExists(
		config: WebDAVConfig,
		filePath: string,
	): Promise<void> {
		try {
			const result = await deleteFile(config, filePath);
			if (result) {
			} else {
			}
		} catch (_error) {
			// 忽略删除错误，因为文件可能本来就不存在
		}
	}

	/**
	 * 清理当前状态
	 */
	clearCurrentState(): void {
		this.currentZip = null;
		this.currentZipName = "";
		this.currentZipSize = 0;
	}
}

// 导出单例实例
export const zipFileManager = new ZipFileManager();
