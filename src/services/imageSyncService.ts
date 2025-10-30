import type { WebDAVConfig } from "@/plugins/webdav";
import { fileSegmentManager } from "@/utils/fileSegmentManager";
import { getSaveImagePath } from "@/utils/path";
import { join } from "@tauri-apps/api/path";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";

interface ImageSegmentInfo {
	originalPath: string;
	segments: Array<{
		segmentId: string;
		fileName: string;
		size: number;
		checksum: string;
	}>;
	fileType: string;
}

/**
 * 图片同步服务 - 基于分段文件的跨设备图片同步
 */
export class ImageSyncService {
	/**
	 * 上传图片到分段存储
	 */
	async uploadImageToSegments(
		imagePath: string,
		imageData: ArrayBuffer,
		itemType: string,
		webdavConfig: WebDAVConfig,
	): Promise<ImageSegmentInfo> {
		try {
			console.info(`🖼️ 开始上传图片到分段存储: ${imagePath}`);

			// 使用FileSegmentManager进行分段上传
			// 对于图片同步，我们需要立即获得段信息，所以设置immediate: true
			const segments = await fileSegmentManager.segmentAndUploadFile(
				imagePath,
				imageData,
				itemType,
				webdavConfig,
				true, // 立即处理批处理队列以获得段信息
			);

			const segmentInfo: ImageSegmentInfo = {
				originalPath: imagePath,
				segments: segments.map((seg) => ({
					segmentId: seg.segmentId,
					fileName: seg.fileName,
					size: seg.size,
					checksum: seg.checksum,
				})),
				fileType: itemType,
			};

			console.info(
				`✅ 图片分段上传成功: ${imagePath}, 分段数: ${segments.length}`,
			);
			return segmentInfo;
		} catch (error) {
			console.error("❌ 图片分段上传失败:", error);
			throw error;
		}
	}

	/**
	 * 从分段存储下载并保存图片
	 */
	async downloadAndSaveImage(
		imageInfo: ImageSegmentInfo,
		webdavConfig: WebDAVConfig,
	): Promise<string | null> {
		try {
			console.info(`🖼️ 开始从分段存储下载图片: ${imageInfo.originalPath}`);

			// 将ImageSegmentInfo转换为FileSegmentManager需要的格式
			const segments = imageInfo.segments.map((seg) => ({
				segmentId: seg.segmentId,
				fileName: seg.fileName,
				originalPath: imageInfo.originalPath,
				size: seg.size,
				checksum: seg.checksum,
				fileType: imageInfo.fileType,
			}));

			// 下载并重组文件
			const imageData = await fileSegmentManager.downloadAndReassembleFile(
				segments,
				webdavConfig,
			);

			if (!imageData) {
				console.error(`❌ 图片重组失败: ${imageInfo.originalPath}`);
				return null;
			}

			// 保存到本地
			const localImagePath = await this.saveImageToLocal(
				imageData,
				imageInfo.originalPath,
			);

			console.info(`✅ 图片下载成功: ${localImagePath}`);
			return localImagePath;
		} catch (error) {
			console.error("❌ 图片下载失败:", error);
			return null;
		}
	}

	/**
	 * 保存图片到本地
	 */
	private async saveImageToLocal(
		imageData: ArrayBuffer,
		originalPath: string,
	): Promise<string> {
		try {
			// 确保图片目录存在
			const imageDir = await getSaveImagePath();
			await mkdir(imageDir, { recursive: true });

			// 生成唯一的文件名（避免冲突）
			const parsedPath = originalPath.split(/[\/\\]/);
			const originalFileName = parsedPath[parsedPath.length - 1];
			const timestamp = Date.now();
			const random = Math.random().toString(36).substring(2, 8);
			const extension = originalFileName.includes(".")
				? originalFileName.substring(originalFileName.lastIndexOf("."))
				: "";
			const baseName = originalFileName.includes(".")
				? originalFileName.substring(0, originalFileName.lastIndexOf("."))
				: originalFileName;
			const uniqueFileName = `${baseName}_${timestamp}_${random}${extension}`;

			const localImagePath = await join(imageDir, uniqueFileName);

			// 将 ArrayBuffer 转换为 Uint8Array
			const uint8Array = new Uint8Array(imageData);

			// 写入文件
			await writeFile(localImagePath, uint8Array);

			return localImagePath;
		} catch (error) {
			console.error("❌ 保存图片到本地失败:", error);
			throw error;
		}
	}

	/**
	 * 检查图片是否需要同步（分段文件是否存在）
	 */
	async needsSync(
		imageInfo: ImageSegmentInfo,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			// 检查所有分段是否存在
			for (const segment of imageInfo.segments) {
				const exists = await this.checkSegmentExists(
					segment.fileName,
					webdavConfig,
				);
				if (!exists) {
					return false;
				}
			}
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 检查单个分段是否存在
	 */
	private async checkSegmentExists(
		segmentName: string,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			const webdavPath = `${webdavConfig.path}/files/${segmentName}`;
			const { downloadSyncData } = await import("@/plugins/webdav");

			const result = await downloadSyncData(webdavConfig, webdavPath);
			return result.success && result.data && result.data.length > 0;
		} catch {
			return false;
		}
	}
}

// 导出单例实例
export const imageSyncService = new ImageSyncService();
