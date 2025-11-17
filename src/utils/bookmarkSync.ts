import type { BookmarkGroup } from "@/types/sync";
import { bookmarkManager } from "./bookmarkManager";

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
	extractBookmarkData(
		cloudData: any,
	): { groups: BookmarkGroup[]; lastModified: number } | null {
		if (!cloudData || !cloudData.bookmarkGroups) {
			return null;
		}

		return {
			groups: cloudData.bookmarkGroups || [],
			lastModified: cloudData.bookmarkLastModified || 0,
		};
	}

	/**
	 * 将书签数据合并到云端同步数据中
	 */
	mergeBookmarkDataToCloud(
		cloudData: any,
		bookmarkData: { groups: BookmarkGroup[]; lastModified: number },
	): any {
		if (!cloudData) {
			return {
				bookmarkGroups: bookmarkData.groups,
				bookmarkLastModified: bookmarkData.lastModified,
			};
		}

		return {
			...cloudData,
			bookmarkGroups: bookmarkData.groups,
			bookmarkLastModified: bookmarkData.lastModified,
		};
	}

	/**
	 * 执行书签同步逻辑
	 * @param cloudData 云端同步数据
	 * @returns 同步结果，包含是否需要更新云端数据
	 */
	async syncBookmarks(cloudData: any): Promise<{
		needUpload: boolean;
		needDownload: boolean;
		mergedData?: any;
		error?: string;
	}> {
		try {
			// 获取本地书签数据
			const localGroups = await bookmarkManager.getSyncData();
			const localLastModified = bookmarkManager.getLastModified();

			// 提取云端书签数据
			const cloudBookmarkData = this.extractBookmarkData(cloudData);

			// 如果云端没有书签数据
			if (!cloudBookmarkData) {
				// 如果本地有书签，需要上传到云端
				if (localGroups.length > 0) {
					const mergedData = this.mergeBookmarkDataToCloud(cloudData, {
						groups: localGroups,
						lastModified: localLastModified,
					});

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

			// 如果本地没有书签但云端有书签，优先从云端下载
			if (localGroups.length === 0 && cloudBookmarkData.groups.length > 0) {
				// 如果本地时间戳为0，说明是全新设备，直接从云端下载
				if (localLastModified === 0) {
					await bookmarkManager.forceSetData(cloudBookmarkData.groups);
					bookmarkManager.setLastModified(cloudBookmarkData.lastModified);

					return {
						needUpload: false,
						needDownload: true,
					};
				}

				// 添加安全检查：只有当本地时间戳比云端新很多时（比如超过1小时），才认为是用户主动删除
				// 这可以避免因时间戳误差导致的误判
				const timeDifference =
					localLastModified - cloudBookmarkData.lastModified;
				const oneHour = 60 * 60 * 1000; // 1小时的毫秒数

				// 如果本地时间戳更新很多（超过1小时），才认为是用户删除了书签
				if (timeDifference > oneHour) {
					console.info(
						`检测到本地删除操作：本地时间戳 ${localLastModified} 比云端 ${cloudBookmarkData.lastModified} 新 ${timeDifference}ms`,
					);
					const mergedData = this.mergeBookmarkDataToCloud(cloudData, {
						groups: [],
						lastModified: localLastModified,
					});

					return {
						needUpload: true,
						needDownload: false,
						mergedData,
					};
				}

				// 在其他所有情况下，都优先从云端下载书签
				// 这确保了设备2能够正确获取云端书签
				console.info(
					`优先从云端下载书签：本地时间戳 ${localLastModified}，云端时间戳 ${cloudBookmarkData.lastModified}`,
				);
				await bookmarkManager.forceSetData(cloudBookmarkData.groups);
				bookmarkManager.setLastModified(cloudBookmarkData.lastModified);

				return {
					needUpload: false,
					needDownload: true,
				};
			}

			// 比较本地和云端的时间戳
			if (localLastModified > cloudBookmarkData.lastModified) {
				// 本地更新，需要上传
				const mergedData = this.mergeBookmarkDataToCloud(cloudData, {
					groups: localGroups,
					lastModified: localLastModified,
				});

				return {
					needUpload: true,
					needDownload: false,
					mergedData,
				};
			}

			if (cloudBookmarkData.lastModified > localLastModified) {
				// 云端更新，需要下载
				await bookmarkManager.forceSetData(cloudBookmarkData.groups);

				// 保持本地时间戳与云端一致
				bookmarkManager.setLastModified(cloudBookmarkData.lastModified);

				return {
					needUpload: false,
					needDownload: true,
				};
			}

			// 时间戳相同，检查内容是否一致（防止时间戳相同但内容不同的情况）
			const localDataHash = this.calculateBookmarkHash(localGroups);
			const cloudDataHash = this.calculateBookmarkHash(
				cloudBookmarkData.groups,
			);

			if (localDataHash !== cloudDataHash) {
				// 内容不一致，以本地为准（用户最近的更改优先）
				const mergedData = this.mergeBookmarkDataToCloud(cloudData, {
					groups: localGroups,
					lastModified: localLastModified,
				});

				return {
					needUpload: true,
					needDownload: false,
					mergedData,
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
