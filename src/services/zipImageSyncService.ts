import type { WebDAVConfig } from "@/plugins/webdav";
import { getSaveImagePath } from "@/utils/path";
import { zipFileManager } from "@/utils/zipFileManager";
import { join } from "@tauri-apps/api/path";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import type JSZip from "jszip";

interface ZipImageInfo {
	originalPath: string;
	fileInfo: {
		fileName: string;
		originalPath: string;
		size: number;
		compressedSize: number;
		checksum: string;
		fileType: string;
	};
	zipName: string;
}

/**
 * ZIP图片同步服务 - 使用ZIP压缩包处理跨设备图片文件同步
 */
export class ZipImageSyncService {
	private downloadCache = new Map<string, Promise<string | null>>();

	/**
	 * 从ZIP包下载并重新保存图片文件
	 */
	async downloadAndSaveImage(
		imageData: ZipImageInfo,
		zip: JSZip,
	): Promise<string | null> {
		try {
			console.log(`🖼️ 开始处理ZIP图片同步: ${imageData.originalPath}`);

			// 1. 从ZIP包中提取图片文件
			const file = zip.file(imageData.fileInfo.fileName);
			if (!file) {
				console.error(`❌ ZIP包中找不到文件: ${imageData.fileInfo.fileName}`);
				return null;
			}

			const imageDataBuffer = await file.async("uint8array");

			// 2. 验证校验和
			const actualChecksum = await this.calculateChecksum(
				imageDataBuffer.buffer,
			);
			if (actualChecksum !== imageData.fileInfo.checksum) {
				console.error(`❌ 图片校验和不匹配: ${imageData.fileInfo.fileName}`);
				return null;
			}

			console.log(`✅ 图片校验和验证通过: ${imageData.fileInfo.fileName}`);

			// 3. 保存到本地图片目录
			const localImagePath = await this.saveImageToLocal(
				imageDataBuffer.buffer,
				imageData.fileInfo.fileName,
			);

			console.log(`✅ 图片保存成功: ${localImagePath}`);
			return localImagePath;
		} catch (error) {
			console.error("❌ ZIP图片同步失败:", error);
			return null;
		}
	}

	/**
	 * 批量处理图片同步
	 */
	async batchSyncImages(
		imagesData: ZipImageInfo[],
		webdavConfig: WebDAVConfig,
	): Promise<Map<string, string>> {
		const results = new Map<string, string>();

		// 防御性检查
		if (!imagesData || !Array.isArray(imagesData)) {
			console.warn("⚠️ imagesData 不是有效数组，返回空结果");
			return results;
		}

		console.log(`🔍 开始批量图片同步，imagesData长度: ${imagesData.length}`);

		try {
			// 1. 批量下载ZIP包
			const zipMap = await zipFileManager.batchDownloadImages(
				imagesData,
				webdavConfig,
			);
			console.log(`📦 下载了 ${zipMap.size} 个ZIP包`);

			// 2. 处理每个图片文件
			for (const imageData of imagesData) {
				// 防御性检查
				if (!imageData || !imageData.zipName || !imageData.originalPath) {
					console.warn("⚠️ 跳过无效的imageData:", imageData);
					continue;
				}

				const zip = zipMap.get(imageData.zipName);
				if (!zip) {
					console.error(`❌ ZIP包不存在: ${imageData.zipName}`);
					continue;
				}

				const newPath = await this.downloadAndSaveImage(imageData, zip);
				if (newPath) {
					// 映射原始路径 -> 新路径
					results.set(imageData.originalPath, newPath);
				}
			}
		} catch (error) {
			console.error("❌ 批量图片同步失败:", error);
		}

		return results;
	}

	/**
	 * 保存图片到本地图片目录
	 */
	private async saveImageToLocal(
		imageData: ArrayBuffer,
		fileName: string,
	): Promise<string> {
		// 确保图片目录存在
		const imageDir = await getSaveImagePath();
		try {
			await mkdir(imageDir, { recursive: true });
		} catch {
			// 目录可能已存在
		}

		// 生成唯一的文件名（避免冲突）
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 8);
		const extension = fileName.includes(".")
			? fileName.substring(fileName.lastIndexOf("."))
			: "";
		const baseName = fileName.includes(".")
			? fileName.substring(0, fileName.lastIndexOf("."))
			: fileName;
		const uniqueFileName = `${baseName}_${timestamp}_${random}${extension}`;

		const localImagePath = await join(imageDir, uniqueFileName);

		// 将 ArrayBuffer 转换为 Uint8Array
		const uint8Array = new Uint8Array(imageData);

		// 写入文件
		await writeFile(localImagePath, uint8Array);

		return localImagePath;
	}

	/**
	 * 计算校验和
	 */
	private async calculateChecksum(data: ArrayBuffer): Promise<string> {
		// 使用 Web Crypto API 的 SHA-256
		if (typeof crypto !== "undefined" && crypto.subtle) {
			try {
				const hashBuffer = await crypto.subtle.digest("SHA-256", data);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
			} catch {
				// 回退到简单哈希
			}
		}

		// 简单哈希算法（改进版）
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
	 * 检查图片是否需要同步（ZIP包是否存在）
	 */
	async needsSync(
		imageData: ZipImageInfo,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			const zip = await zipFileManager.downloadZip(
				imageData.zipName,
				webdavConfig,
			);
			if (!zip) {
				return false;
			}

			const file = zip.file(imageData.fileInfo.fileName);
			return !!file;
		} catch {
			return false;
		}
	}

	/**
	 * 懒加载：按需下载图片文件
	 */
	async downloadImageIfNeeded(
		imageData: ZipImageInfo,
		webdavConfig: WebDAVConfig,
	): Promise<string | null> {
		const cacheKey = `${imageData.originalPath}_${imageData.zipName}`;

		// 检查缓存
		if (this.downloadCache.has(cacheKey)) {
			return this.downloadCache.get(cacheKey)!;
		}

		// 检查图片文件是否存在本地
		if (await this.checkImageExistsLocally(imageData.originalPath)) {
			return imageData.originalPath;
		}

		// 创建下载Promise并缓存
		const downloadPromise = this.performImageDownload(imageData, webdavConfig);
		this.downloadCache.set(cacheKey, downloadPromise);

		try {
			const result = await downloadPromise;
			return result;
		} catch (error) {
			console.error("❌ 图片下载失败:", error);
			this.downloadCache.delete(cacheKey);
			return null;
		}
	}

	/**
	 * 检查图片文件是否存在本地
	 */
	private async checkImageExistsLocally(imagePath: string): Promise<boolean> {
		try {
			const { exists } = await import("@tauri-apps/plugin-fs");
			return await exists(imagePath);
		} catch {
			return false;
		}
	}

	/**
	 * 执行实际的图片下载
	 */
	private async performImageDownload(
		imageData: ZipImageInfo,
		webdavConfig: WebDAVConfig,
	): Promise<string | null> {
		try {
			console.log(`🖼️ 开始懒加载图片: ${imageData.originalPath}`);

			// 1. 下载ZIP包
			const zip = await zipFileManager.downloadZip(
				imageData.zipName,
				webdavConfig,
			);
			if (!zip) {
				console.error(`❌ ZIP包下载失败: ${imageData.zipName}`);
				return null;
			}

			// 2. 从ZIP包中提取图片
			const file = zip.file(imageData.fileInfo.fileName);
			if (!file) {
				console.error(`❌ ZIP包中找不到文件: ${imageData.fileInfo.fileName}`);
				return null;
			}

			const fileData = await file.async("uint8array");

			// 3. 验证校验和
			const actualChecksum = await this.calculateChecksum(fileData.buffer);
			if (actualChecksum !== imageData.fileInfo.checksum) {
				console.error(`❌ 图片校验和不匹配: ${imageData.fileInfo.fileName}`);
				return null;
			}

			console.log(`✅ 图片校验和验证通过: ${imageData.fileInfo.fileName}`);

			// 4. 保存到本地，尽量保持原始路径
			const localImagePath = await this.saveImageToLocal(
				fileData.buffer,
				imageData.fileInfo.fileName,
				imageData.originalPath,
			);

			console.log(`✅ 图片懒加载成功: ${localImagePath}`);
			return localImagePath;
		} catch (error) {
			console.error("❌ 图片懒加载失败:", error);
			return null;
		}
	}

	/**
	 * 保存图片到本地，尽量保持原始路径
	 */
	private async saveImageToLocal(
		imageData: ArrayBuffer,
		fileName: string,
		originalPath: string,
	): Promise<string> {
		try {
			// 尝试使用原始路径
			const parsedPath = originalPath.split(/[\/\\]/);
			const originalDir = parsedPath.slice(0, -1).join("/");
			const originalFileName = parsedPath[parsedPath.length - 1];

			// 检查原始目录是否可写
			try {
				const { join } = await import("@tauri-apps/api/path");
				const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");

				const originalDirPath = originalDir;
				const originalFilePath = await join(originalDirPath, originalFileName);

				// 确保目录存在
				await mkdir(originalDirPath, { recursive: true });

				// 写入文件
				const uint8Array = new Uint8Array(imageData);
				await writeFile(originalFilePath, uint8Array);

				console.log(`✅ 使用原始路径保存: ${originalFilePath}`);
				return originalFilePath;
			} catch (originalPathError) {
				console.log(
					`⚠️ 原始路径不可写，使用备用路径: ${originalPathError.message}`,
				);

				// 备用方案：保存到标准图片目录
				const imageDir = await getSaveImagePath();
				const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
				const { join } = await import("@tauri-apps/api/path");

				await mkdir(imageDir, { recursive: true });

				// 生成唯一的文件名（避免冲突）
				const timestamp = Date.now();
				const random = Math.random().toString(36).substring(2, 8);
				const extension = fileName.includes(".")
					? fileName.substring(fileName.lastIndexOf("."))
					: "";
				const baseName = fileName.includes(".")
					? fileName.substring(0, fileName.lastIndexOf("."))
					: fileName;
				const uniqueFileName = `${baseName}_${timestamp}_${random}${extension}`;

				const localImagePath = await join(imageDir, uniqueFileName);

				// 写入文件
				const uint8Array = new Uint8Array(imageData);
				await writeFile(localImagePath, uint8Array);

				console.log(`✅ 使用备用路径保存: ${localImagePath}`);
				return localImagePath;
			}
		} catch (error) {
			console.error("❌ 保存图片到本地失败:", error);
			throw error;
		}
	}

	/**
	 * 清理缓存
	 */
	clearCache(): void {
		this.downloadCache.clear();
		console.log("🗑️ 懒加载缓存已清理");
	}

	/**
	 * 获取缓存状态
	 */
	getCacheStatus(): { size: number; keys: string[] } {
		return {
			size: this.downloadCache.size,
			keys: Array.from(this.downloadCache.keys()),
		};
	}
}

// 导出单例实例
export const zipImageSyncService = new ZipImageSyncService();
