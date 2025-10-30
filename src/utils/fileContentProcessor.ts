import type { WebDAVConfig } from "@/plugins/webdav";
import type { SyncItem } from "@/types/sync";
import { downloadDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { exists } from "@tauri-apps/plugin-fs";
import { fileDownloadService } from "./fileDownloadService";
import { resolveImagePath } from "./path";

export class FileContentProcessor {
	private readonly MAX_DIMENSION = 1920;
	private readonly JPEG_QUALITY = 0.8;

	async compressImage(imagePath: string): Promise<ArrayBuffer> {
		try {
			const originalBuffer = await readFile(imagePath);

			// 检查是否在浏览器环境中
			if (typeof window === "undefined" || typeof document === "undefined") {
				return originalBuffer;
			}

			// 使用Canvas压缩图片
			return new Promise((resolve, reject) => {
				const img = new Image();

				img.onload = () => {
					try {
						const canvas = document.createElement("canvas");
						const ctx = canvas.getContext("2d");

						if (!ctx) {
							console.error("[FileContentProcessor] 无法创建Canvas上下文");
							reject(new Error("无法创建Canvas上下文"));
							return;
						}

						// 计算新尺寸
						const { width, height } = this.calculateNewDimensions(
							img.width,
							img.height,
						);

						canvas.width = width;
						canvas.height = height;

						// 压缩图片
						ctx.drawImage(img, 0, 0, width, height);

						canvas.toBlob(
							(blob) => {
								if (blob) {
									blob.arrayBuffer().then(resolve).catch(reject);
								} else {
									console.error("[FileContentProcessor] Canvas toBlob失败");
									reject(new Error("图片压缩失败"));
								}
							},
							"image/webp",
							this.JPEG_QUALITY,
						);
					} catch (canvasError) {
						console.error(
							"[FileContentProcessor] Canvas操作失败:",
							canvasError,
						);
						reject(new Error(`Canvas操作失败: ${canvasError}`));
					}
				};

				img.onerror = (error) => {
					console.error("[FileContentProcessor] 图片加载失败:", error);
					reject(new Error("图片加载失败"));
				};

				try {
					img.src = URL.createObjectURL(new Blob([originalBuffer]));
				} catch (blobError) {
					console.error("[FileContentProcessor] 创建Blob URL失败:", blobError);
					reject(new Error(`创建Blob URL失败: ${blobError}`));
				}
			});
		} catch (error) {
			console.error("[FileContentProcessor] 图片压缩过程失败:", error);
			throw new Error(`图片压缩失败: ${error}`);
		}
	}

	async compressFile(filePath: string): Promise<ArrayBuffer> {
		try {
			const originalBuffer = await readFile(filePath);

			const fileName = filePath.split(/[\\/]/).pop() || "file";

			// 动态导入JSZip
			try {
				const { default: JSZip } = await import("jszip");
				const zip = new JSZip();
				zip.file(fileName, originalBuffer);
				const zipContent = await zip.generateAsync({
					type: "arraybuffer",
					compression: "DEFLATE",
					compressionOptions: { level: 6 },
				});

				return zipContent;
			} catch (jszipError) {
				console.error("[FileContentProcessor] JSZip压缩失败:", jszipError);
				return originalBuffer;
			}
		} catch (error) {
			console.error("[FileContentProcessor] 文件压缩过程失败:", error);
			// 如果所有压缩方法都失败，尝试返回原始缓冲区
			try {
				return await readFile(filePath);
			} catch (readError) {
				console.error("[FileContentProcessor] 读取原始文件也失败:", readError);
				throw new Error(`文件压缩失败: ${error}`);
			}
		}
	}

	private calculateNewDimensions(
		originalWidth: number,
		originalHeight: number,
	): { width: number; height: number } {
		let { width, height } = { width: originalWidth, height: originalHeight };

		if (width > this.MAX_DIMENSION || height > this.MAX_DIMENSION) {
			const aspectRatio = width / height;

			if (width > height) {
				width = Math.min(width, this.MAX_DIMENSION);
				height = width / aspectRatio;
			} else {
				height = Math.min(height, this.MAX_DIMENSION);
				width = height * aspectRatio;
			}
		}

		return {
			width: Math.round(width),
			height: Math.round(height),
		};
	}

	async decompressFile(
		compressedData: ArrayBuffer,
		_originalName: string,
	): Promise<ArrayBuffer> {
		try {
			const { default: JSZip } = await import("jszip");
			const zip = new JSZip();
			const zipContent = await zip.loadAsync(compressedData);

			// 获取第一个文件
			const firstFile = Object.values(zipContent.files)[0];
			if (firstFile && !firstFile.dir) {
				return await firstFile.async("arraybuffer");
			}

			throw new Error("ZIP文件中没有找到有效内容");
		} catch (error) {
			// 如果解压失败，尝试返回原始数据
			console.warn("文件解压失败，返回原始数据:", error);
			return compressedData;
		}
	}

	// 工具方法：ArrayBuffer转Base64
	arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	// 工具方法：Base64转ArrayBuffer
	base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	/**
	 * 处理按需下载的图片内容恢复
	 */
	async processImageContent(
		syncItem: SyncItem,
		webdavConfig: WebDAVConfig,
		onProgress?: (progress: number) => void,
	): Promise<string | null> {
		try {
			// 如果不是按需下载，直接返回value
			if (!syncItem.lazyDownload) {
				return syncItem.value;
			}

			// 如果value是本地文件路径且文件存在，直接返回
			if (await this.isLocalFileAvailable(syncItem.value)) {
				return syncItem.value;
			}

			const fileData = await fileDownloadService.getFileContent(
				syncItem,
				webdavConfig,
				onProgress,
			);

			if (!fileData) {
				console.warn(`图片下载失败: ${syncItem.id}`);
				return null;
			}

			// 将下载的数据保存到本地并返回路径
			const localPath = await this.saveImageFile(fileData, syncItem);
			return localPath;
		} catch (error) {
			console.error("图片内容处理失败:", error);
			return null;
		}
	}

	/**
	 * 处理按需下载的文件数组内容恢复
	 */
	async processFilesContent(
		syncItem: SyncItem,
		webdavConfig: WebDAVConfig,
		onProgress?: (progress: number) => void,
	): Promise<string | null> {
		try {
			// 如果不是按需下载，直接返回value
			if (!syncItem.lazyDownload) {
				return syncItem.value;
			}

			// 如果value是本地文件引用且文件可用，直接返回
			if (await this.areLocalFilesAvailable(syncItem.value)) {
				return syncItem.value;
			}

			const fileData = await fileDownloadService.getFileContent(
				syncItem,
				webdavConfig,
				onProgress,
			);

			if (!fileData) {
				console.warn(`文件下载失败: ${syncItem.id}`);
				return null;
			}

			// 解压并保存文件，返回文件引用
			const fileRefs = await this.saveFilesArray(fileData, syncItem);
			return JSON.stringify(fileRefs);
		} catch (error) {
			console.error("文件内容处理失败:", error);
			return null;
		}
	}

	/**
	 * 批量预加载文件内容
	 */
	async preloadFiles(
		syncItems: SyncItem[],
		webdavConfig: WebDAVConfig,
		onProgress?: (current: number, total: number) => void,
	): Promise<void> {
		const lazyDownloadItems = syncItems.filter((item) => item.lazyDownload);

		if (lazyDownloadItems.length === 0) {
			return;
		}

		for (let i = 0; i < lazyDownloadItems.length; i++) {
			const item = lazyDownloadItems[i];

			try {
				await fileDownloadService.preloadFile(item, webdavConfig);
				onProgress?.(i + 1, lazyDownloadItems.length);
			} catch (error) {
				console.warn(`预加载文件失败: ${item.id}`, error);
			}
		}
	}

	/**
	 * 检查本地文件是否可用
	 */
	private async isLocalFileAvailable(value: string): Promise<boolean> {
		try {
			const imagePath = resolveImagePath(value);
			return await exists(imagePath);
		} catch {
			return false;
		}
	}

	/**
	 * 检查本地文件数组是否可用
	 */
	private async areLocalFilesAvailable(value: string): Promise<boolean> {
		try {
			const fileRefs = JSON.parse(value);
			if (!Array.isArray(fileRefs)) {
				return false;
			}

			// 检查是否所有文件都存在
			for (const fileRef of fileRefs) {
				if (fileRef.data && !(await this.isLocalFileAvailable(fileRef.data))) {
					return false;
				}
			}

			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 保存图片文件到本地
	 */
	private async saveImageFile(
		fileData: Uint8Array,
		syncItem: SyncItem,
	): Promise<string> {
		try {
			// 确保images目录存在
			const downloadsPath = await downloadDir();
			const ecoPasteDir = await join(downloadsPath, "EcoPaste");
			const imagesDir = await join(ecoPasteDir, "images");

			// 创建目录（如果不存在）
			try {
				await mkdir(imagesDir, { recursive: true });
			} catch {
				// 目录可能已存在，忽略错误
			}

			// 生成文件名
			const fileName = `${syncItem.id}-${syncItem.checksum || "unknown"}.png`;
			const filePath = await join(imagesDir, fileName);

			// 保存文件
			await writeFile(filePath, fileData);
			return filePath;
		} catch (error) {
			console.error("保存图片文件失败:", error);
			throw error;
		}
	}

	/**
	 * 保存文件数组到本地
	 */
	private async saveFilesArray(
		fileData: Uint8Array,
		syncItem: SyncItem,
	): Promise<Array<{ name: string; data: string }>> {
		try {
			// 确保files目录存在
			const downloadsPath = await downloadDir();
			const ecoPasteDir = await join(downloadsPath, "EcoPaste");
			const filesDir = await join(ecoPasteDir, "files");

			// 创建目录（如果不存在）
			try {
				await mkdir(filesDir, { recursive: true });
			} catch {
				// 目录可能已存在，忽略错误
			}

			// 生成文件名
			const fileName = `${syncItem.id}-${syncItem.checksum || "unknown"}.zip`;
			const filePath = await join(filesDir, fileName);

			// 保存文件
			await writeFile(filePath, fileData);

			// 返回文件引用数组，保持与原有格式兼容
			const fileRefs = [
				{
					name: fileName,
					data: filePath,
				},
			];
			return fileRefs;
		} catch (error) {
			console.error("保存文件数组失败:", error);
			throw error;
		}
	}

	/**
	 * 获取文件状态信息
	 */
	getFileStatus(syncItem: SyncItem): {
		isLazyDownload: boolean;
		isAvailable: boolean;
		fileSize: number;
		fileType: string;
	} {
		const isLazyDownload = syncItem.lazyDownload || false;
		const isAvailable = isLazyDownload
			? fileDownloadService.isFileAvailable(syncItem)
			: true; // 非按需下载的文件默认可用

		return {
			isLazyDownload,
			isAvailable,
			fileSize: fileDownloadService.getFileSize(syncItem),
			fileType: fileDownloadService.getFileType(syncItem),
		};
	}

	/**
	 * 清理缓存
	 */
	cleanupCache(): void {
		fileDownloadService.cleanupCache();
	}

	/**
	 * 获取缓存统计
	 */
	getCacheStats() {
		return fileDownloadService.getCacheStats();
	}
}

// 导出单例实例
export const fileContentProcessor = new FileContentProcessor();
