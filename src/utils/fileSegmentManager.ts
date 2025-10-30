import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";

interface SegmentInfo {
	segmentId: string;
	fileName: string;
	originalPath: string;
	size: number;
	checksum: string;
	fileType: string;
}

/**
 * 文件分段管理器 - 基于ZIP成功经验优化的分段文件上传
 */
export class FileSegmentManager {
	private readonly SEGMENT_SIZE_LIMIT = 1024 * 1024; // 1MB per segment
	private readonly LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB - max file limit
	private currentBatch: Array<{
		filePath: string;
		fileData: ArrayBuffer;
		itemType: string;
		fileSize: number;
	}> = [];
	private config: WebDAVConfig | null = null;

	/**
	 * 设置WebDAV配置
	 */
	setWebDAVConfig(config: WebDAVConfig): void {
		this.config = config;
	}

	/**
	 * 将文件添加到批处理队列或直接上传（大文件）
	 */
	async segmentAndUploadFile(
		filePath: string,
		fileData: ArrayBuffer,
		itemType: string,
		config?: WebDAVConfig,
		immediate = false, // 是否立即处理批处理队列
	): Promise<SegmentInfo[]> {
		const webdavConfig = await this.getWebDAVConfig(config);
		const fileSize = fileData.byteLength;
		const fileName = filePath.split(/[\/\\]/).pop() || "file";

		// 大于10MB的文件直接跳过
		if (fileSize > this.LARGE_FILE_THRESHOLD) {
			throw new Error(
				`文件过大，跳过上传: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB > 10MB)`,
			);
		}

		// 大于8MB的文件单独上传，不进行批处理
		if (fileSize > this.SEGMENT_SIZE_LIMIT * 0.8) {
			return await this.processSingleFile(
				filePath,
				fileData,
				itemType,
				webdavConfig,
			);
		}

		// 对于图片类型，总是单独处理，不进行批处理
		if (itemType === "image") {
			return await this.processSingleFile(
				filePath,
				fileData,
				itemType,
				webdavConfig,
			);
		}
		this.currentBatch.push({
			filePath,
			fileData,
			itemType,
			fileSize,
		});

		// 检查批处理是否达到1MB限制
		const currentBatchSize = this.currentBatch.reduce(
			(sum, item) => sum + item.fileSize,
			0,
		);
		if (currentBatchSize >= this.SEGMENT_SIZE_LIMIT) {
			const result = await this.processBatch(webdavConfig);
			return result;
		}

		// 如果设置了立即处理标志，立即处理批处理队列
		if (immediate && this.currentBatch.length > 0) {
			const result = await this.processBatch(webdavConfig);
			return result;
		}

		// 返回空数组，表示文件已添加到批处理队列但尚未上传
		return [];
	}

	/**
	 * 处理单个文件（不进行批处理）
	 */
	private async processSingleFile(
		filePath: string,
		fileData: ArrayBuffer,
		itemType: string,
		webdavConfig: WebDAVConfig,
	): Promise<SegmentInfo[]> {
		const fileName = filePath.split(/[\/\\]/).pop() || "file";
		const segmentCount = Math.ceil(
			fileData.byteLength / this.SEGMENT_SIZE_LIMIT,
		);
		const segments: SegmentInfo[] = [];

		// 计算整个文件的校验和，用于生成稳定的段ID
		const fileChecksum = await this.calculateChecksum(fileData);

		// 确保分段文件目录存在
		await this.ensureSegmentDirectoryExists(webdavConfig);

		for (let i = 0; i < segmentCount; i++) {
			const start = i * this.SEGMENT_SIZE_LIMIT;
			const end = Math.min(
				start + this.SEGMENT_SIZE_LIMIT,
				fileData.byteLength,
			);
			const segmentData = fileData.slice(start, end);
			const segmentId = this.generateSegmentId(fileName, i, fileChecksum);
			const segmentFileName = `${segmentId}.seg`;

			// 计算段的校验和
			const checksum = await this.calculateChecksum(segmentData);

			const segmentInfo: SegmentInfo = {
				segmentId,
				fileName: segmentFileName,
				originalPath: filePath,
				size: segmentData.byteLength,
				checksum,
				fileType: itemType,
			};

			// 检查云端是否已存在相同的段
			const segmentWebDAVPath = this.getSegmentWebDAVPath(segmentFileName);
			const downloadResult = await downloadSyncData(
				webdavConfig,
				segmentWebDAVPath,
			);

			if (downloadResult.success && downloadResult.data) {
				segments.push(segmentInfo);
				continue;
			}

			// 上传段
			await this.uploadSegment(segmentInfo, segmentData, webdavConfig);
			segments.push(segmentInfo);
		}
		return segments;
	}

	/**
	 * 处理批处理队列中的文件
	 */
	private async processBatch(
		webdavConfig: WebDAVConfig,
	): Promise<SegmentInfo[]> {
		if (this.currentBatch.length === 0) {
			return [];
		}

		// 确保分段文件目录存在
		await this.ensureSegmentDirectoryExists(webdavConfig);

		// 将批处理中的文件合并为一个或多个1MB段
		const segments: SegmentInfo[] = [];
		let currentSegmentData = new Uint8Array(0);
		let segmentIndex = 0;
		const batchId = Date.now();

		for (const fileItem of this.currentBatch) {
			const fileData = new Uint8Array(fileItem.fileData);

			// 如果当前段加上这个文件会超过1MB限制，先上传当前段
			if (
				currentSegmentData.length + fileData.length > this.SEGMENT_SIZE_LIMIT &&
				currentSegmentData.length > 0
			) {
				const segmentInfo = await this.createAndUploadBatchSegment(
					currentSegmentData,
					segmentIndex++,
					batchId,
					webdavConfig,
				);
				if (segmentInfo) {
					segments.push(segmentInfo);
				}
				currentSegmentData = new Uint8Array(0);
			}

			// 将文件数据添加到当前段
			const newSegmentData = new Uint8Array(
				currentSegmentData.length + fileData.length,
			);
			newSegmentData.set(currentSegmentData);
			newSegmentData.set(fileData, currentSegmentData.length);
			currentSegmentData = newSegmentData;
		}

		// 上传最后一个段
		if (currentSegmentData.length > 0) {
			const segmentInfo = await this.createAndUploadBatchSegment(
				currentSegmentData,
				segmentIndex,
				batchId,
				webdavConfig,
			);
			if (segmentInfo) {
				segments.push(segmentInfo);
			}
		}

		// 清空批处理队列
		const _totalFiles = this.currentBatch.length;
		const _totalSize = this.currentBatch.reduce(
			(sum, item) => sum + item.fileSize,
			0,
		);
		this.currentBatch = [];
		return segments;
	}

	/**
	 * 创建并上传批处理分段
	 */
	private async createAndUploadBatchSegment(
		segmentData: Uint8Array,
		segmentIndex: number,
		batchId: number,
		webdavConfig: WebDAVConfig,
	): Promise<SegmentInfo | null> {
		try {
			const segmentId = `batch_${batchId}_${segmentIndex}`;
			const segmentFileName = `${segmentId}.seg`;
			const checksum = await this.calculateChecksum(segmentData.buffer);

			// 创建批处理文件的元数据
			const _batchMetadata = this.currentBatch.map((item) => ({
				filePath: item.filePath,
				fileSize: item.fileSize,
				itemType: item.itemType,
			}));

			const segmentInfo: SegmentInfo = {
				segmentId,
				fileName: segmentFileName,
				originalPath: `batch_${batchId}_${segmentIndex}`, // 批处理段的标识路径
				size: segmentData.length,
				checksum,
				fileType: "batch", // 标记为批处理类型
			};

			// 上传段
			await this.uploadSegment(segmentInfo, segmentData.buffer, webdavConfig);
			return segmentInfo;
		} catch (error) {
			console.error("❌ 批处理段上传失败:", error);
			return null;
		}
	}

	/**
	 * 强制刷新批处理队列（上传所有剩余文件）
	 */
	async flushBatch(config?: WebDAVConfig): Promise<SegmentInfo[]> {
		if (this.currentBatch.length === 0) {
			return [];
		}
		const webdavConfig = await this.getWebDAVConfig(config);
		return await this.processBatch(webdavConfig);
	}

	/**
	 * 上传单个分段
	 */
	private async uploadSegment(
		segmentInfo: SegmentInfo,
		segmentData: ArrayBuffer,
		webdavConfig: WebDAVConfig,
	): Promise<void> {
		const base64Content = this.arrayBufferToBase64(segmentData);
		const maxAttempts = 3;
		let attempts = 0;
		let success = false;
		let finalSegmentName = segmentInfo.fileName;

		while (!success && attempts < maxAttempts) {
			attempts++;

			// 每次重试都使用新的文件名（除了第一次）
			if (attempts > 1) {
				finalSegmentName = `${segmentInfo.segmentId}_retry_${attempts}.seg`;
			}

			try {
				const webdavPath = this.getSegmentWebDAVPath(finalSegmentName);

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
					// 验证分段是否确实可以下载
					const verificationSuccess = await this.verifySegment(
						finalSegmentName,
						webdavConfig,
					);
					if (verificationSuccess) {
						success = true;
						// 更新segmentInfo中的实际文件名
						segmentInfo.fileName = finalSegmentName;
					} else {
					}
				} else {
					// 处理409冲突
					if (
						uploadResult.error_message?.includes("HTTP 409") ||
						uploadResult.error_message?.includes("Conflict")
					) {
						// 验证文件是否真的存在
						const existingSegment = await this.verifySegment(
							finalSegmentName,
							webdavConfig,
						);
						if (existingSegment) {
							success = true;
							segmentInfo.fileName = finalSegmentName;
						} else {
							if (attempts >= maxAttempts) {
								throw new Error(
									`分段上传失败，已达到最大重试次数: ${maxAttempts}`,
								);
							}
						}
					} else {
						if (attempts >= maxAttempts) {
							throw new Error(
								`分段上传失败: ${uploadResult.error_message || "未知错误"}`,
							);
						}
					}
				}
			} catch (error) {
				console.error(`❌ 上传异常 (${attempts}/${maxAttempts}):`, error);
				if (attempts >= maxAttempts) {
					throw error;
				}
			}

			// 添加延迟，避免服务器端的缓存或锁定问题
			if (!success && attempts < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}

		if (!success) {
			throw new Error(`分段上传最终失败，已重试 ${maxAttempts} 次`);
		}
	}

	/**
	 * 验证分段是否存在且可下载
	 */
	private async verifySegment(
		segmentName: string,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			const webdavPath = this.getSegmentWebDAVPath(segmentName);
			const { downloadSyncData } = await import("@/plugins/webdav");

			const result = await downloadSyncData(webdavConfig, webdavPath);
			return result.success && result.data && result.data.length > 0;
		} catch {
			return false;
		}
	}

	/**
	 * 下载并重组文件
	 */
	async downloadAndReassembleFile(
		segments: SegmentInfo[],
		config?: WebDAVConfig,
	): Promise<ArrayBuffer | null> {
		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			// 按segmentId排序以确保正确的顺序
			const sortedSegments = segments.sort((a, b) => {
				const aIndex = Number.parseInt(a.segmentId.split("_").pop() || "0");
				const bIndex = Number.parseInt(b.segmentId.split("_").pop() || "0");
				return aIndex - bIndex;
			});

			const segmentsData: ArrayBuffer[] = [];

			for (const segment of sortedSegments) {
				const segmentData = await this.downloadSegment(
					segment.fileName,
					webdavConfig,
				);
				if (segmentData) {
					// 验证校验和
					const actualChecksum = await this.calculateChecksum(segmentData);
					if (actualChecksum !== segment.checksum) {
						console.error(`❌ 分段校验和不匹配: ${segment.fileName}`);
						return null;
					}
					segmentsData.push(segmentData);
				} else {
					console.error(`❌ 分段下载失败: ${segment.fileName}`);
					return null;
				}
			}

			// 重组文件
			const totalSize = segmentsData.reduce(
				(sum, data) => sum + data.byteLength,
				0,
			);
			const result = new ArrayBuffer(totalSize);
			const view = new Uint8Array(result);
			let offset = 0;

			for (const segmentData of segmentsData) {
				view.set(new Uint8Array(segmentData), offset);
				offset += segmentData.byteLength;
			}
			return result;
		} catch (error) {
			console.error("❌ 文件重组失败:", error);
			return null;
		}
	}

	/**
	 * 下载单个分段
	 */
	private async downloadSegment(
		segmentName: string,
		webdavConfig: WebDAVConfig,
	): Promise<ArrayBuffer | null> {
		try {
			const webdavPath = this.getSegmentWebDAVPath(segmentName);
			const { downloadSyncData } = await import("@/plugins/webdav");

			const result = await downloadSyncData(webdavConfig, webdavPath);
			if (result.success && result.data && result.data.length > 0) {
				return this.base64ToArrayBuffer(result.data);
			}
			return null;
		} catch (error) {
			console.error(`❌ 分段下载失败: ${segmentName}`, error);
			return null;
		}
	}

	/**
	 * 生成分段ID
	 */
	private generateSegmentId(
		fileName: string,
		index: number,
		fileChecksum?: string,
	): string {
		const baseName = fileName.includes(".")
			? fileName.substring(0, fileName.lastIndexOf("."))
			: fileName;

		// 如果提供了文件校验和，使用它来生成稳定的ID
		if (fileChecksum) {
			// 使用校验和的前8位作为稳定标识符
			const shortChecksum = fileChecksum.substring(0, 8);
			return `${baseName}_${shortChecksum}_${index}`;
		}

		// 回退到时间戳方式（仅在没有校验和时使用）
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 8);
		return `${baseName}_${timestamp}_${random}_${index}`;
	}

	/**
	 * 获取分段WebDAV路径
	 */
	private getSegmentWebDAVPath(segmentName: string): string {
		return `${this.config?.path || "/EcoPaste"}/files/${segmentName}`;
	}

	/**
	 * 确保分段文件目录存在
	 */
	private async ensureSegmentDirectoryExists(
		config: WebDAVConfig,
	): Promise<void> {
		try {
			const filesDirPath = `${config.path}/files`;
			const { createDirectory } = await import("@/plugins/webdav");
			const _result = await createDirectory(config, filesDirPath);
		} catch (_error) {
			// 忽略目录创建错误，因为目录可能已经存在
		}
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
	 * 清理当前状态
	 */
	clearCurrentState(): void {}
}

// 导出单例实例
export const fileSegmentManager = new FileSegmentManager();
