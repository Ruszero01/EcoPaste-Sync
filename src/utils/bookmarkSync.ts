import type { BookmarkGroup } from "@/types/sync";
import { bookmarkManager } from "./bookmarkManager";
import { generateDeviceId } from "./shared";

/**
 * 书签同步管理器
 *
 * 使用统一时间戳方法进行书签同步：
 * - 本地只有一个统一的最后修改时间戳
 * - 云端也保存这个时间戳
 * - 比较时间戳决定哪个版本更新
 * - 简单的上传/下载逻辑，不需要复杂的数据合并
 */
export class BookmarkSync {
	private static instance: BookmarkSync;

	private constructor() {}

	public static getInstance(): BookmarkSync {
		if (!BookmarkSync.instance) {
			BookmarkSync.instance = new BookmarkSync();
		}
		return BookmarkSync.instance;
	}

	/**
	 * 从云端同步数据中提取书签信息
	 */
	extractBookmarkData(cloudData: any): {
		groups: BookmarkGroup[];
		lastModified: number;
		deviceId?: string;
	} | null {
		if (!cloudData || !cloudData.bookmarkGroups) {
			return null;
		}

		return {
			groups: cloudData.bookmarkGroups || [],
			lastModified: cloudData.bookmarkLastModified || 0,
			deviceId: cloudData.bookmarkDeviceId,
		};
	}

	/**
	 * 将书签数据合并到云端同步数据中
	 */
	mergeBookmarkDataToCloud(
		cloudData: any,
		bookmarkData: { groups: BookmarkGroup[]; lastModified: number },
		deviceId: string,
	): any {
		if (!cloudData) {
			return {
				bookmarkGroups: bookmarkData.groups,
				bookmarkLastModified: bookmarkData.lastModified,
				bookmarkDeviceId: deviceId,
			};
		}

		return {
			...cloudData,
			bookmarkGroups: bookmarkData.groups,
			bookmarkLastModified: bookmarkData.lastModified,
			bookmarkDeviceId: deviceId,
		};
	}

	/**
	 * 执行书签同步逻辑
	 * @param cloudData 云端同步数据
	 * @param deviceId 当前设备ID
	 * @returns 同步结果，包含是否需要更新云端数据
	 */
	async syncBookmarks(
		cloudData: any,
		deviceId?: string,
	): Promise<{
		needUpload: boolean;
		needDownload: boolean;
		mergedData?: any;
		error?: string;
	}> {
		// 如果没有提供deviceId，生成一个
		const currentDeviceId = deviceId || generateDeviceId();
		try {
			// 获取本地书签数据
			const localGroups = await bookmarkManager.getSyncData();
			const localLastModified = bookmarkManager.getLastModified();

			console.info(
				`🔍 书签同步分析: 本地分组数=${localGroups.length}, 本地时间戳=${localLastModified}`,
			);

			// 提取云端书签数据
			const cloudBookmarkData = this.extractBookmarkData(cloudData);
			if (cloudBookmarkData) {
				console.info(
					`🔍 书签同步分析: 云端分组数=${cloudBookmarkData.groups.length}, 云端时间戳=${cloudBookmarkData.lastModified}, 云端设备ID=${cloudBookmarkData.deviceId}`,
				);
			}

			// 如果云端没有书签数据
			if (!cloudBookmarkData) {
				// 如果本地有书签，需要上传到云端
				if (localGroups.length > 0) {
					console.info("📤 云端无书签数据，上传本地书签到云端");
					const mergedData = this.mergeBookmarkDataToCloud(
						cloudData,
						{
							groups: localGroups,
							lastModified: localLastModified,
						},
						currentDeviceId,
					);

					return {
						needUpload: true,
						needDownload: false,
						mergedData,
					};
				}

				// 本地和云端都没有书签，无需同步
				return {
					needUpload: false,
					needDownload: false,
				};
			}

			// 核心同步逻辑：只比较时间戳，最新的数据胜出
			if (localLastModified > cloudBookmarkData.lastModified) {
				console.info("📤 本地数据更新，上传到云端");
				const mergedData = this.mergeBookmarkDataToCloud(
					cloudData,
					{
						groups: localGroups,
						lastModified: localLastModified,
					},
					currentDeviceId,
				);

				return {
					needUpload: true,
					needDownload: false,
					mergedData,
				};
			}

			if (cloudBookmarkData.lastModified > localLastModified) {
				console.info("📥 云端数据更新，下载到本地");
				await bookmarkManager.forceSetData(
					cloudBookmarkData.groups,
					cloudBookmarkData.lastModified,
				);
				return {
					needUpload: false,
					needDownload: true,
				};
			}

			// 时间戳相同，检查内容是否一致
			const localDataHash = this.calculateBookmarkHash(localGroups);
			const cloudDataHash = this.calculateBookmarkHash(
				cloudBookmarkData.groups,
			);

			if (localDataHash !== cloudDataHash) {
				// 时间戳相同但内容不同：以云端为准（云端数据通常更可靠）
				console.warn("⚠️ 时间戳相同但内容不同，以云端数据为准");
				await bookmarkManager.forceSetData(
					cloudBookmarkData.groups,
					cloudBookmarkData.lastModified,
				);
				return {
					needUpload: false,
					needDownload: true,
				};
			}

			// 内容一致，无需同步
			return {
				needUpload: false,
				needDownload: false,
			};
		} catch (error) {
			return {
				needUpload: false,
				needDownload: false,
				error: `书签同步失败: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * 计算书签数据的哈希值，用于内容比较
	 */
	private calculateBookmarkHash(groups: BookmarkGroup[]): string {
		const dataString = JSON.stringify(
			groups.sort((a, b) => {
				// 按ID排序确保一致性
				return a.id.localeCompare(b.id);
			}),
		);

		// 简单的哈希函数
		let hash = 0;
		for (let i = 0; i < dataString.length; i++) {
			const char = dataString.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // 转换为32位整数
		}
		return hash.toString();
	}

	/**
	 * 检查是否有书签数据需要同步
	 */
	async hasBookmarkData(): Promise<boolean> {
		const localGroups = await bookmarkManager.getGroups();
		return localGroups.length > 0;
	}
}

export const bookmarkSync = BookmarkSync.getInstance();
