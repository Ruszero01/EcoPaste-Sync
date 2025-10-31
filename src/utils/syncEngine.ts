import { LISTEN_KEY } from "@/constants";
import { deleteSQL, executeSQL, getHistoryData, updateSQL } from "@/database";
import {
	type WebDAVConfig,
	downloadSyncData,
	uploadSyncData,
} from "@/plugins/webdav";
import { globalStore } from "@/stores/global";
import type {
	SyncData,
	SyncItem,
	SyncMetadata,
	SyncResult,
} from "@/types/sync";
import { filePackageManager } from "@/utils/filePackageManager";
import {
	calculateChecksum as calculateStringChecksum,
	generateDeviceId,
} from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
import { fileContentProcessor } from "./fileContentProcessor";
import { fileSegmentManager } from "./fileSegmentManager";

// 全局事件发射器
let syncEventEmitter: (() => void) | null = null;

// 设置默认的同步事件监听器，确保不会因为没有监听器而失败
const setDefaultSyncListener = () => {
	// 只有在真正没有监听器时才设置默认监听器
	if (!syncEventEmitter) {
		syncEventEmitter = () => {
			// 默认监听器，什么都不做，只是防止报错
		};
	}
};

/**
 * 设置同步事件监听器
 */
export const setSyncEventListener = (listener: () => void) => {
	// 检查是否是相同的监听器，避免不必要的重复设置
	if (syncEventEmitter === listener) {
		return;
	}

	syncEventEmitter = listener;
};

/**
 * 触发同步事件
 */
const triggerSyncEvent = () => {
	if (syncEventEmitter) {
		syncEventEmitter();
	}
};

export class SyncEngine {
	private config: WebDAVConfig | null = null;
	private deviceId: string = generateDeviceId();
	private isOnline = false;
	private lastSyncTime = 0;
	private lastLocalSnapshot: Map<string, any> = new Map(); // 用于跟踪本地变更
	private syncModeConfig: any = null; // 添加同步模式配置
	private isInitialized = false; // 添加初始化状态标记
	// 只使用分段文件存储模式

	constructor() {
		this.deviceId = generateDeviceId();
		// 设置默认同步事件监听器，防止启动时报错
		setDefaultSyncListener();
	}

	/**
	 * 设置同步模式配置
	 */
	setSyncModeConfig(config: any) {
		this.syncModeConfig = config;
	}

	/**
	 * 获取完整文件路径
	 */
	private getFullPath(fileName: string): string {
		if (!this.config) return `/${fileName}`;
		const basePath = this.config.path.startsWith("/")
			? this.config.path
			: `/${this.config.path}`;
		return `${basePath}/${fileName}`;
	}

	/**
	 * 初始化同步引擎
	 */
	async initialize(config: WebDAVConfig): Promise<boolean> {
		// 如果已经初始化且配置没有变化，跳过重复初始化
		if (this.isInitialized && this.config) {
			const isSameConfig =
				this.config.url === config.url &&
				this.config.username === config.username &&
				this.config.path === config.path;

			if (isSameConfig) {
				return true;
			}
		}

		this.config = config;
		this.isOnline = true;

		// 初始化本地数据快照
		await this.initializeLocalSnapshot();

		// 标记为已初始化
		this.isInitialized = true;

		return true;
	}

	/**
	 * 初始化本地数据快照
	 */
	private async initializeLocalSnapshot(): Promise<void> {
		try {
			const localData = await getHistoryData();
			this.lastLocalSnapshot = new Map(
				(localData as any[]).map((item: any) => [item.id, item]),
			);
		} catch {
			// 初始化本地快照失败
		}
	}

	/**
	 * 获取设备ID
	 */
	getDeviceId(): string {
		return this.deviceId;
	}

	/**
	 * 获取全量同步文件路径
	 */
	private getFullSyncFilePath(): string {
		return this.getFullPath("sync-data.json");
	}

	/**
	 * 获取元数据文件路径
	 */
	private getMetadataFilePath(): string {
		return this.getFullPath("metadata.json");
	}

	/**
	 * 双向智能同步
	 */
	/**
	 * 简化的统一同步方法 - 直接执行同步逻辑
	 */
	async performBidirectionalSync(): Promise<SyncResult> {
		if (!this.config) {
			throw new Error("WebDAV配置未初始化");
		}

		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		try {
			let remoteData = await this.downloadRemoteData();

			let localDataEmpty = false;
			const localRawData = await getHistoryData();
			if (!localRawData || (localRawData as any[]).length === 0) {
				localDataEmpty = true;
			}

			// 手动检测删除项目（避免快照自动更新的问题）
			const deletedItems: string[] = [];

			// 确保快照已正确初始化（用于删除检测）
			if (!localDataEmpty && this.lastLocalSnapshot.size === 0) {
				const localData = await getHistoryData();
				this.lastLocalSnapshot = new Map(
					(localData as any[]).map((item: any) => [item.id, item]),
				);
			}

			// 防止重复删除的保护机制
			// 获取当前云端删除记录，避免重复处理
			const existingRemoteDeleted = new Set<string>();
			if (remoteData?.deleted) {
				for (const id of remoteData.deleted) {
					existingRemoteDeleted.add(id);
				}
			}

			if (!localDataEmpty && this.lastLocalSnapshot.size > 0) {
				try {
					const currentData = await getHistoryData();
					const currentMap = new Map(
						(currentData as any[]).map((item: any) => [item.id, item]),
					);

					// 获取云端已有的删除记录，避免重复计数
					const remoteDeletedSet = new Set(remoteData?.deleted || []);

					for (const [id] of this.lastLocalSnapshot) {
						if (!currentMap.has(id) && !remoteDeletedSet.has(id)) {
							deletedItems.push(id);
						}
					}

					// 手动更新快照（在检测完删除后）
					this.lastLocalSnapshot = currentMap as Map<string, any>;

					if (deletedItems.length > 0) {
						// 检测到删除项目
					}
				} catch (_error) {
					// 检测本地删除失败
				}
			}

			// 记录同步前的本地数据ID，用于计算真正的新增数据
			const beforeSyncLocalIds = new Set();
			if (!localDataEmpty) {
				const localRawData = await getHistoryData();
				for (const item of (localRawData as any[]) || []) {
					beforeSyncLocalIds.add(item.id);
				}
			}

			// 如果云端有数据且本地为空，先下载云端数据，然后处理删除记录
			if (remoteData && localDataEmpty) {
				await this.mergeCloudDataToLocal(remoteData);
				result.downloaded = remoteData.items.length;

				// 本地为空时，重新生成同步数据（基于云端数据）
				const syncData =
					await this.convertLocalToSyncDataWithDeleted(deletedItems);

				// 检查是否有删除记录需要上传
				if (deletedItems.length > 0) {
					// 有删除记录，需要上传
					const filePath = this.getFullSyncFilePath();
					const uploadResult = await uploadSyncData(
						this.config,
						filePath,
						JSON.stringify(syncData, null, 2),
					);

					if (uploadResult.success) {
						result.uploaded = 0; // 没有新增数据，只有删除
						(result as any).deletedItems = deletedItems.length;
						result.success = true;
						this.lastSyncTime = Date.now();

						// 更新元数据
						await this.updateMetadata();

						// 触发界面刷新
						try {
							emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
						} catch (_error) {
							result.errors.push("界面刷新失败");
						}
					} else {
						result.errors.push("删除记录上传失败");
					}
				} else {
					// 没有删除记录，不需要上传
					result.uploaded = 0;
					(result as any).deletedItems = 0;
					result.success = true;
					this.lastSyncTime = Date.now();

					// 更新元数据
					await this.updateMetadata();

					// 触发界面刷新
					try {
						emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					} catch (_error) {
						result.errors.push("界面刷新失败");
					}
				}

				return result;
			}
			// 如果云端和本地都有数据，进行智能合并
			if (remoteData && !localDataEmpty) {
				try {
					await this.mergeCloudDataToLocal(remoteData);
					result.downloaded = remoteData.items.filter(
						(item: any) => !beforeSyncLocalIds.has(item.id),
					).length;
				} catch (_mergeError) {
					const latestRemoteData = await this.downloadRemoteData();
					if (latestRemoteData) {
						remoteData = latestRemoteData;

						// 重试合并
						await this.mergeCloudDataToLocal(remoteData);
						result.downloaded = remoteData.items.filter(
							(item: any) => !beforeSyncLocalIds.has(item.id),
						).length;
					} else {
						throw new Error("重新下载云端数据失败");
					}
				}
			}

			// 处理图片文件同步（在删除记录处理之后）
			await this.downloadRemoteDataAndProcessImages(deletedItems);

			// 重新生成包含删除记录的同步数据（在合并云端数据之后）
			const syncData =
				await this.convertLocalToSyncDataWithDeleted(deletedItems);

			// 计算真正需要上传的数据（新增或更新）
			const actuallyChangedItems = syncData.items.filter((item) => {
				// 如果本地数据库重置，刚下载的数据不应该被计入上传
				if (localDataEmpty && remoteData) {
					return !remoteData.items.some(
						(remoteItem: any) => remoteItem.id === item.id,
					);
				}

				// 正常情况：检查云端是否已有相同数据
				if (remoteData) {
					const existingRemoteItem = remoteData.items.find(
						(remoteItem: any) => remoteItem.id === item.id,
					);
					if (existingRemoteItem) {
						// 云端有相同ID的数据，检查内容是否相同
						// 多重比较策略：校验和 > 内容 > 修改时间
						const checksumsMatch =
							existingRemoteItem.checksum === item.checksum;
						const contentMatch =
							existingRemoteItem.value === item.value &&
							existingRemoteItem.type === item.type &&
							existingRemoteItem.search === item.search;

						if (checksumsMatch || contentMatch) {
							return false; // 内容相同，不需要上传
						}
						return true; // 内容不同，需要上传
					}
				}
				return true;
			});

			// 获取同步前已存在的云端数据ID集合，用于区分新增和更新
			const remoteDataIds = new Set();
			if (remoteData) {
				for (const item of remoteData.items) {
					remoteDataIds.add(item.id);
				}
			}

			if (actuallyChangedItems.length === 0 && deletedItems.length === 0) {
				try {
					result.uploaded = 0;
					result.downloaded = 0; // 跳过上传时没有下载新数据
					result.success = true;
					result.duration = Date.now() - startTime;

					// 仍然需要触发界面刷新
					try {
						emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					} catch (_error) {
						result.errors.push("界面刷新失败");
					}
					return result;
				} catch (error) {
					result.success = false;
					result.errors.push(
						`跳过逻辑异常: ${error instanceof Error ? error.message : String(error)}`,
					);
					return result;
				}
			}

			// 上传合并后的本地数据
			const filePath = this.getFullSyncFilePath();

			const uploadResult = await uploadSyncData(
				this.config,
				filePath,
				JSON.stringify(syncData, null, 2),
			);

			if (uploadResult.success) {
				// 区分新增和更新的数量
				const newItems = actuallyChangedItems.filter(
					(item: any) => !remoteDataIds.has(item.id),
				).length;
				const updatedItems = actuallyChangedItems.filter((item: any) =>
					remoteDataIds.has(item.id),
				).length;

				// 如果有删除记录，需要从云端真正删除对应的条目
				if (deletedItems.length > 0) {
					try {
						await this.removeDeletedItemsFromCloud(deletedItems);
					} catch (deleteError) {
						result.errors.push(
							`云端删除失败: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`,
						);
						// 不抛出错误，继续执行
					}
				}

				// 将新增和更新的数量分别存储在 result 中
				result.uploaded = newItems + updatedItems;
				// 扩展结果对象以包含详细信息
				(result as any).newItems = newItems;
				(result as any).updatedItems = updatedItems;
				(result as any).deletedItems = deletedItems.length;
				result.success = true;
				this.lastSyncTime = Date.now();

				// 更新元数据
				try {
					await this.updateMetadata();
				} catch (metadataError) {
					result.errors.push(
						`元数据更新失败: ${metadataError instanceof Error ? metadataError.message : String(metadataError)}`,
					);
					// 不影响整体成功状态
				}

				// 直接触发界面刷新
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_error) {
					result.errors.push("界面刷新失败");
				}
			} else {
				const errorMsg = uploadResult.error_message || "上传失败";
				result.errors.push(errorMsg);

				// 即使上传失败也尝试刷新界面
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_refreshError) {
					// 失败后界面刷新也失败
				}
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			result.errors.push(`同步异常: ${errorMessage}`);

			// 异常时也尝试刷新界面
			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (_refreshError) {
				// 异常后界面刷新也失败
			}
		}

		result.duration = Date.now() - startTime;

		return result;
	}

	/**
	 * 全量同步上传（包含删除记录）
	 */
	async fullSyncUploadWithDeleted(
		deletedItems: string[] = [],
	): Promise<SyncResult> {
		if (!this.config) {
			throw new Error("WebDAV配置未初始化");
		}

		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		try {
			// 1. 获取本地数据
			const syncData =
				await this.convertLocalToSyncDataWithDeleted(deletedItems);

			// 2. 直接上传文件（使用用户配置的目录）
			const filePath = this.getFullSyncFilePath();

			const uploadResult = await uploadSyncData(
				this.config,
				filePath,
				JSON.stringify(syncData, null, 2),
			);

			if (uploadResult.success) {
				result.uploaded = syncData.items.length;
				result.success = true;

				// 3. 更新元数据
				await this.updateMetadata();
				this.lastSyncTime = Date.now();
			} else {
				result.errors.push(uploadResult.error_message || "上传失败");
			}
		} catch (error) {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	/**
	 * 将本地历史数据转换为同步数据格式（包含删除记录）
	 */
	private async convertLocalToSyncDataWithDeleted(
		deletedItems: string[] = [],
	): Promise<SyncData> {
		const localData = await getHistoryData();
		const syncItems: SyncItem[] = [];

		// 使用与界面相同的去重逻辑：对于相同 type 和 value 的内容，只保留最新的一个
		const uniqueItems: any[] = [];
		const seenKeys = new Set<string>();

		// 数据库已经按时间降序排列，所以第一个遇到的就是最新的
		for (const item of localData as any[]) {
			const key = `${item.type}:${item.value}`;

			if (!seenKeys.has(key)) {
				seenKeys.add(key);
				uniqueItems.push(item);
			}
		}

		// 根据同步模式配置过滤数据
		let filteredItems = uniqueItems;
		if (this.syncModeConfig?.settings) {
			const settings = this.syncModeConfig.settings;

			// 收藏模式：只同步收藏的内容
			if (settings.onlyFavorites) {
				filteredItems = filteredItems.filter((item) => {
					// 处理数据库中的favorite字段，可能是数字(0/1)或布尔值
					const isFavorite = item.favorite === true || item.favorite === 1;
					return isFavorite;
				});
			}

			// 根据内容类型过滤
			filteredItems = filteredItems.filter((item) => {
				// 文本类型
				if (item.type === "text" && !settings.includeText) {
					return false;
				}
				// HTML类型
				if (item.type === "html" && !settings.includeHtml) {
					return false;
				}
				// 富文本类型
				if (item.type === "rtf" && !settings.includeRtf) {
					return false;
				}
				// 图片类型
				if (item.type === "image" && !settings.includeImages) {
					return false;
				}
				// 文件类型
				if (item.type === "files" && !settings.includeFiles) {
					return false;
				}

				return true;
			});
		}

		for (const item of filteredItems) {
			// 检查是否需要文件同步 - 数据已经在前面过滤过了，这里直接处理
			if (this.isFileContentItem(item)) {
				try {
					const processedItem = await this.processFileSyncItem(item);
					if (processedItem) {
						syncItems.push(processedItem);
						continue;
					}
				} catch {
					// 文件同步处理异常
				}
				continue;
			}

			// 同步文本、富文本等内容
			if (this.isTextContentItem(item)) {
				syncItems.push(this.convertToSyncItem(item));
			}
		}

		// 刷新批处理队列，确保所有剩余的小文件都被上传
		if (this.config) {
			fileSegmentManager.setWebDAVConfig(this.config);
			try {
				await fileSegmentManager.flushBatch(this.config);
			} catch {
				// 批处理队列刷新失败
			}
		}

		return {
			version: 1,
			timestamp: Date.now(),
			deviceId: this.deviceId,
			dataType: "full",
			items: syncItems,
			deleted: deletedItems,
			compression: "none",
			checksum: calculateStringChecksum(JSON.stringify(syncItems)),
		};
	}

	/**
	 * 全量同步上传
	 */
	async fullSyncUpload(): Promise<SyncResult> {
		if (!this.config) {
			throw new Error("WebDAV配置未初始化");
		}

		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		try {
			// 1. 获取本地数据
			const syncData = await this.convertLocalToSyncDataWithDeleted();

			// 直接上传文件（使用用户配置的目录）
			const filePath = this.getFullSyncFilePath();

			const uploadResult = await uploadSyncData(
				this.config,
				filePath,
				JSON.stringify(syncData, null, 2),
			);

			if (uploadResult.success) {
				result.uploaded = syncData.items.length;
				result.success = true;

				// 更新元数据
				await this.updateMetadata();
				this.lastSyncTime = Date.now();

				// 触发界面刷新事件
				triggerSyncEvent();

				// 使用项目原有的刷新事件
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_error) {
					result.errors.push("界面刷新失败");
				}
			} else {
				result.errors.push(uploadResult.error_message || "上传失败");
				// 即使上传失败也触发界面刷新
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_refreshError) {
					// 触发界面刷新失败
				}
			}
		} catch (error) {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
			// 同步异常时也触发界面刷新
			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (_refreshError) {
				// 触发界面刷新失败
			}
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	/**
	 * 尝试查找最新的可用同步文件
	 */
	private async findLatestSyncFile(): Promise<string | null> {
		if (!this.config) return null;

		// 简化文件结构，只保留必要的文件
		const possibleFiles = [
			this.getFullPath("sync-data.json"), // 主要同步文件
			this.getFullPath("metadata.json"), // 元数据文件
		];

		for (const filePath of possibleFiles) {
			try {
				const result = await downloadSyncData(this.config, filePath);
				if (result.success && result.data) {
					return filePath;
				}
			} catch (_error) {
				// 文件不可用
			}
		}

		return null;
	}

	/**
	 * 全量同步下载
	 */
	async fullSyncDownload(): Promise<SyncResult> {
		if (!this.config) {
			throw new Error("WebDAV配置未初始化");
		}

		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		try {
			// 1. 查找最新的可用同步文件
			const filePath = await this.findLatestSyncFile();
			if (!filePath) {
				result.errors.push("云端没有可用的同步数据");
				return result;
			}

			const downloadResult = await downloadSyncData(this.config, filePath);

			if (downloadResult.success && downloadResult.data) {
				// 2. 解析同步数据
				const syncData: SyncData = JSON.parse(downloadResult.data);

				// 3. 转换为本地格式并处理文件恢复
				let localData = [];
				for (const item of syncData.items) {
					const localItem: any = {
						id: item.id,
						type: item.type,
						group: item.group,
						value: item.value,
						search: item.search,
						count: item.count,
						width: item.width,
						height: item.height,
						favorite: item.favorite,
						createTime: item.createTime,
						note: item.note,
						subtype: item.subtype,
					};

					// 处理图片文件恢复（ZIP格式）
					if (
						item.type === "image" &&
						item.value &&
						!item.value.startsWith("http") &&
						item._syncType === "zip_files"
					) {
						// ZIP文件格式暂不在下载时恢复，会在按需下载时处理
					}

					// 处理文件数组恢复（ZIP格式）
					if (
						item.type === "files" &&
						item.files &&
						Array.isArray(item.files) &&
						item._syncType === "zip_files"
					) {
						// ZIP文件格式暂不在下载时恢复，会在按需下载时处理
					}

					localData.push(localItem);
				}

				// 4. 根据同步模式配置过滤下载的数据
				if (this.syncModeConfig?.settings) {
					const settings = this.syncModeConfig.settings;

					// 收藏模式：只处理收藏的内容
					if (settings.onlyFavorites) {
						localData = localData.filter((item) => {
							const isFavorite = item.favorite === true || item.favorite === 1;
							return isFavorite;
						});
					}

					// 根据内容类型过滤
					localData = localData.filter((item) => {
						// 文本类型
						if (item.type === "text" && !settings.includeText) {
							return false;
						}
						// HTML类型
						if (item.type === "html" && !settings.includeHtml) {
							return false;
						}
						// 富文本类型
						if (item.type === "rtf" && !settings.includeRtf) {
							return false;
						}
						// 图片类型
						if (item.type === "image" && !settings.includeImages) {
							return false;
						}
						// 文件类型
						if (item.type === "files" && !settings.includeFiles) {
							return false;
						}
						return true;
					});
				}

				await this.mergeHistoryData(localData);
				result.downloaded = syncData.items.length;
				result.success = true;

				// 4. 更新元数据
				await this.updateMetadata();
				this.lastSyncTime = Date.now();

				// 5. 短暂延迟确保数据写入完成
				await new Promise((resolve) => setTimeout(resolve, 100));

				// 6. 触发界面刷新事件
				triggerSyncEvent();

				// 7. 使用项目原有的刷新事件
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_error) {
					// 项目标准刷新事件发送失败
				}
			} else {
				result.errors.push(downloadResult.error_message || "下载失败");
			}
		} catch (error) {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	/**
	 * 更新同步元数据
	 */
	private async updateMetadata(): Promise<void> {
		if (!this.config) return;

		const metadata: SyncMetadata = {
			lastSyncTime: Date.now(),
			deviceId: this.deviceId,
			syncVersion: 1,
			conflictResolution: "merge",
			networkQuality: "medium",
			performanceMetrics: {
				avgUploadSpeed: 0,
				avgDownloadSpeed: 0,
				avgLatency: 0,
			},
		};

		const filePath = this.getMetadataFilePath();
		await uploadSyncData(
			this.config,
			filePath,
			JSON.stringify(metadata, null, 2),
		).catch(() => {
			// 更新元数据失败
		});
	}

	/**
	 * 获取同步状态
	 */
	getSyncStatus() {
		return {
			isOnline: this.isOnline,
			isSyncing: false,
			lastSyncTime: this.lastSyncTime,
			pendingCount: 0,
			errorCount: 0,
			syncProgress: 0,
		};
	}

	/**
	 * 获取云端数据但不替换本地数据
	 */
	async fetchCloudDataOnly(): Promise<{
		items: SyncItem[];
		deleted: string[];
	} | null> {
		if (!this.config) {
			return null;
		}

		try {
			// 1. 查找最新的可用同步文件
			const filePath = await this.findLatestSyncFile();
			if (!filePath) {
				return null;
			}

			const downloadResult = await downloadSyncData(this.config, filePath);

			if (downloadResult.success && downloadResult.data) {
				// 2. 解析同步数据
				const syncData: SyncData = JSON.parse(downloadResult.data);

				return {
					items: syncData.items,
					deleted: syncData.deleted || [],
				};
			}

			return null;
		} catch (_error) {
			return null;
		}
	}

	/**
	 * 智能合并云端数据和本地数据
	 */
	async mergeCloudAndLocalData(cloudItems: SyncItem[]): Promise<void> {
		// 1. 获取本地数据
		const localData = await getHistoryData();

		// 2. 创建合并策略
		const mergedItems = new Map<string, any>();
		const conflicts: string[] = [];

		// 3. 首先添加本地数据
		for (const item of localData as any[]) {
			mergedItems.set(item.id, item);
		}

		// 4. 合并云端数据（智能策略）
		for (const cloudItem of cloudItems) {
			const localItem = mergedItems.get(cloudItem.id);

			if (!localItem) {
				// 本地没有，直接添加云端数据
				mergedItems.set(cloudItem.id, {
					id: cloudItem.id,
					type: cloudItem.type,
					group: cloudItem.group,
					value: cloudItem.value,
					search: cloudItem.search,
					count: cloudItem.count,
					width: cloudItem.width,
					height: cloudItem.height,
					favorite: cloudItem.favorite,
					createTime: cloudItem.createTime,
					note: cloudItem.note,
					subtype: cloudItem.subtype,
				});
			} else {
				// 本地和云端都有，进行冲突解决
				const cloudTime = new Date(cloudItem.createTime).getTime();
				const localTime = new Date((localItem as any).createTime).getTime();

				if (cloudTime > localTime) {
					// 云端数据更新，使用云端数据
					mergedItems.set(cloudItem.id, {
						id: cloudItem.id,
						type: cloudItem.type,
						group: cloudItem.group,
						value: cloudItem.value,
						search: cloudItem.search,
						count: cloudItem.count,
						width: cloudItem.width,
						height: cloudItem.height,
						favorite: cloudItem.favorite,
						createTime: cloudItem.createTime,
						note: cloudItem.note,
						subtype: cloudItem.subtype,
					});
					conflicts.push(cloudItem.id);
				} else {
					// 本地数据更新或相同，保留本地数据
				}
			}
		}

		// 5. 保存合并后的数据
		const mergedArray = Array.from(mergedItems.values());

		await this.mergeHistoryData(mergedArray);
	}

	/**
	 * 智能合并历史数据（不清空现有数据）
	 */
	private async mergeHistoryData(newData: any[]): Promise<void> {
		if (!this.config) return;

		// 直接使用 insertForSync 的统一去重逻辑
		// insertForSync 会自动检查 type + value 的重复并进行智能合并
		for (const item of newData) {
			try {
				// 防护检查：确保item不为空且包含必要字段
				if (!item || typeof item !== "object") {
					continue;
				}

				// 防护检查：确保必要字段存在
				if (!item.type || !item.value) {
					continue;
				}

				// 处理按需下载项目的数据恢复
				const processedItem = await this.processLazyDownloadItem(item);

				// 再次防护检查处理后的数据
				if (!processedItem || !processedItem.type || !processedItem.value) {
					continue;
				}

				// 检查是否已存在相同 type + value 的记录（包括已删除的，防止重复插入已删除的内容）
				const { selectSQL } = await import("@/database");
				const existingRecords = (await selectSQL("history", {
					type: processedItem.type,
					value: processedItem.value,
				})) as any[];

				if (existingRecords && existingRecords.length > 0) {
					// 如果存在，检查是否已被删除
					const existing = existingRecords[0];

					// 如果记录已被软删除，不再重新激活（保持删除状态）
					if (existing.deleted === 1) {
						// 跳过已删除的记录，不重新激活
						continue;
					}

					// 防护检查：确保existing有createTime字段
					if (!existing.createTime) {
						continue;
					}

					// 防护检查：确保processedItem有createTime字段
					if (!processedItem.createTime) {
						continue;
					}

					const newTime = new Date(processedItem.createTime).getTime();
					const existingTime = new Date(existing.createTime).getTime();

					// 防护检查：确保时间戳有效
					if (Number.isNaN(newTime) || Number.isNaN(existingTime)) {
						continue;
					}

					// 只有当时间戳不同或收藏状态不同时才更新
					const favoriteChanged = existing.favorite !== processedItem.favorite;
					const timeChanged = newTime !== existingTime;

					if (favoriteChanged || timeChanged) {
						// 智能合并策略
						const updateItem = {
							...processedItem,
							id: existing.id, // 保持现有ID
							favorite: this.resolveFavoriteStatus(existing, processedItem),
							count: Math.max(existing.count || 0, processedItem.count || 0),
							createTime: existing.createTime, // 保持原有创建时间
						};
						await updateSQL("history", updateItem);
					} else {
						// 跳过相同数据
					}
				} else {
					// 不存在，插入新记录
					await this.insertForSync("history", processedItem);
				}
			} catch {
				// 处理单个项目失败
			}
		}

		// 3. 删除在新数据中不存在的现有数据（可选）
		// 这里不删除，保持数据完整性
	}

	/**
	 * 处理按需下载项目的数据恢复
	 */
	private async processLazyDownloadItem(item: any): Promise<any> {
		try {
			// 如果不是按需下载项目，直接返回
			if (!item.lazyDownload) {
				return item;
			}

			// 检查是否为文件类型
			if (item.type === "image" || item.type === "files") {
				try {
					// 转换为SyncItem格式
					const syncItem: SyncItem = {
						id: item.id || "",
						type: item.type || "unknown",
						group: item.group,
						value: item.value || "",
						search: item.search || "",
						count: item.count || 0,
						width: item.width,
						height: item.height,
						favorite: item.favorite || false,
						createTime: item.createTime || new Date().toISOString(),
						note: item.note || "",
						subtype: item.subtype || "",
						lazyDownload: item.lazyDownload || false,
						fileSize: item.fileSize || 0,
						fileType: item.fileType || "",
					} as SyncItem;

					// 安全获取文件状态信息
					let fileStatus: any;
					try {
						fileStatus = fileContentProcessor.getFileStatus(syncItem);
					} catch (_fileStatusError) {
						return item; // 返回原始项目
					}

					// 如果文件不可用且是按需下载，保留原始value（WebDAV路径）
					// 这样在用户需要时可以触发下载
					if (fileStatus?.isLazyDownload && !fileStatus?.isAvailable) {
						return item; // 保持原始value不变
					}
				} catch (_processError) {
					// 失败时返回原始项目，但确保基本字段存在
					return {
						...item,
						id: item.id || "",
						type: item.type || "unknown",
						value: item.value || "",
					};
				}
			}

			// 对于非按需下载文件或已缓存的文件，直接返回
			return item;
		} catch (_error) {
			return item; // 失败时返回原始项目
		}
	}

	// 判断是否为文件内容项
	private isFileContentItem(item: any): boolean {
		return item.type === "image" || item.type === "files";
	}

	// 判断是否为文本内容项
	private isTextContentItem(item: any): boolean {
		return item.type === "text" || item.type === "rtf" || item.type === "html";
	}

	// 转换为SyncItem（用于文本内容）
	private convertToSyncItem(item: any): SyncItem {
		return {
			id: item.id,
			type: item.type as any,
			group: item.group as any,
			value: item.value,
			search: item.search,
			count: item.count,
			width: item.width,
			height: item.height,
			favorite: item.favorite,
			createTime: item.createTime,
			note: item.note,
			subtype: item.subtype,
			lastModified: item.lastModified || Date.now(),
			deviceId: this.deviceId,
			size: JSON.stringify(item).length,
			checksum: calculateStringChecksum(item.value),
		};
	}

	// 处理文件同步项（统一使用分段存储）
	private async processFileSyncItem(item: any): Promise<SyncItem | null> {
		try {
			if (item.type === "image") {
				return await this.processImageFile(item);
			}
			if (item.type === "files") {
				return await this.processFilesArray(item);
			}

			return this.convertToSyncItem(item);
		} catch (_error) {
			return this.convertToSyncItem(item); // 失败时回退到文本同步
		}
	}

	// 处理图片文件（使用文件包存储）
	private async processImageFile(item: any): Promise<SyncItem | null> {
		try {
			// 检查是否已经是包模式
			let imagePath = item.value;

			// 处理可能的数组格式路径
			if (typeof imagePath === "string" && imagePath.startsWith("[")) {
				try {
					const parsed = JSON.parse(imagePath);
					if (Array.isArray(parsed) && parsed.length > 0) {
						// 如果是数组格式，取第一个有效的文件路径
						imagePath =
							parsed.find(
								(item: any) =>
									typeof item === "string" &&
									(item.includes(":") ||
										item.includes("/") ||
										item.includes("\\")),
							) || parsed[0];
					}
				} catch (_error) {
					// 解析图片路径数组失败
				}
			}

			if (typeof imagePath === "string" && imagePath.startsWith("{")) {
				try {
					const packageInfo = JSON.parse(imagePath);
					if (packageInfo.packageId && packageInfo.originalPaths) {
						// 已经是包模式，直接返回
						const syncItem: SyncItem = {
							id: item.id,
							type: item.type,
							group: item.group,
							value: imagePath,
							search: item.search,
							count: item.count,
							width: item.width,
							height: item.height,
							favorite: item.favorite,
							createTime: item.createTime,
							note: item.note,
							subtype: item.subtype,
							lastModified: item.lastModified || Date.now(),
							deviceId: "local",
							_syncType: "package_files",
							fileSize: packageInfo.size,
							fileType: "image",
						};
						return syncItem;
					}
				} catch (_parseError) {
					// 解析包信息失败，按常规图片处理
				}
			}

			// 检查文件大小
			const fileSize = await this.getFileSize(imagePath);
			const maxFileSize = 50 * 1024 * 1024; // 50MB限制

			if (fileSize > maxFileSize) {
				return this.convertToSyncItem(item);
			}

			if (!this.config) {
				return this.convertToSyncItem(item);
			}

			// 设置文件包管理器的配置
			filePackageManager.setWebDAVConfig(this.config);
			if (this.syncModeConfig) {
				filePackageManager.setSyncModeConfig(this.syncModeConfig);
			}

			// 确保imagePath是字符串数组格式
			let paths: string[];
			if (Array.isArray(imagePath)) {
				// 如果imagePath已经是数组，直接使用
				paths = imagePath;
			} else {
				// 如果imagePath是字符串，包装成数组
				paths = [imagePath];
			}

			// 使用文件包管理器进行打包上传
			const packageInfo = await filePackageManager.packageAndUploadFiles(
				item.id,
				item.type,
				paths,
				this.config,
			);

			if (!packageInfo) {
				return this.convertToSyncItem(item);
			}

			const syncItem: SyncItem = {
				id: item.id,
				type: item.type,
				group: item.group,
				value: JSON.stringify(packageInfo),
				search: item.search,
				count: item.count,
				width: item.width,
				height: item.height,
				favorite: item.favorite,
				createTime: item.createTime,
				note: item.note,
				subtype: item.subtype,
				lastModified: item.lastModified || Date.now(),
				deviceId: this.deviceId,
				_syncType: "package_files", // 标记为文件包模式
				fileSize: packageInfo.size,
				fileType: "image",
			};
			return syncItem;
		} catch (_error) {
			return this.convertToSyncItem(item); // 失败时回退到普通模式
		}
	}

	// 处理文件数组（使用文件包存储）
	private async processFilesArray(item: any): Promise<SyncItem | null> {
		try {
			let filePaths: string[];
			try {
				filePaths = JSON.parse(item.value);
			} catch (_parseError) {
				return this.convertToSyncItem(item);
			}

			// 过滤和验证文件
			const validFilePaths: string[] = [];
			const maxFileSize = 50 * 1024 * 1024; // 50MB限制

			for (const filePath of filePaths) {
				// 检查文件类型
				if (!this.isSupportedFileType(filePath)) {
					continue;
				}

				// 检查文件大小
				const fileSize = await this.getFileSize(filePath);
				if (fileSize > maxFileSize) {
					continue;
				}

				// 检查文件类型是否支持
				const fileType = this.getFileType(filePath);
				if (!globalStore.cloudSync.fileSync.supportedTypes[fileType]) {
					continue;
				}

				validFilePaths.push(filePath);
			}

			if (validFilePaths.length === 0) {
				return this.convertToSyncItem(item);
			}

			if (!this.config) {
				return this.convertToSyncItem(item);
			}

			// 设置文件包管理器的配置
			filePackageManager.setWebDAVConfig(this.config);
			if (this.syncModeConfig) {
				filePackageManager.setSyncModeConfig(this.syncModeConfig);
			}

			// 使用文件包管理器进行打包上传
			const packageInfo = await filePackageManager.packageAndUploadFiles(
				item.id,
				item.type,
				validFilePaths,
				this.config,
			);

			if (!packageInfo) {
				return this.convertToSyncItem(item);
			}

			const syncItem: SyncItem = {
				id: item.id,
				type: item.type,
				group: item.group,
				value: JSON.stringify(packageInfo),
				search: item.search,
				count: item.count,
				width: item.width,
				height: item.height,
				favorite: item.favorite,
				createTime: item.createTime,
				note: item.note,
				subtype: item.subtype,
				lastModified: item.lastModified || Date.now(),
				deviceId: this.deviceId,
				_syncType: "package_files", // 标记为文件包模式
				fileSize: await this.calculateTotalFileSize(validFilePaths),
				fileType: "files",
			};
			return syncItem;
		} catch (_error) {
			return this.convertToSyncItem(item);
		}
	}

	/**
	 * 计算文件总大小
	 */
	private async calculateTotalFileSize(filePaths: string[]): Promise<number> {
		let totalSize = 0;
		for (const filePath of filePaths) {
			const fileSize = await this.getFileSize(filePath);
			totalSize += fileSize;
		}
		return totalSize;
	}

	// 判断文件类型
	private getFileType(filePath: string): "images" | "documents" | "text" {
		const ext = filePath.toLowerCase().split(".").pop() || "";

		const imageTypes = [
			"png",
			"jpg",
			"jpeg",
			"gif",
			"bmp",
			"webp",
			"svg",
			"ico",
		];
		const documentTypes = [
			"pdf",
			"doc",
			"docx",
			"xls",
			"xlsx",
			"ppt",
			"pptx",
			"txt",
			"md",
			"rtf",
		];
		const textTypes = [
			"js",
			"ts",
			"css",
			"html",
			"json",
			"xml",
			"yaml",
			"yml",
			"log",
		];

		if (imageTypes.includes(ext)) return "images";
		if (documentTypes.includes(ext)) return "documents";
		if (textTypes.includes(ext)) return "text";
		return "documents"; // 默认归类为文档
	}

	// 检查是否为支持的文件类型
	private isSupportedFileType(filePath: string): boolean {
		const ext = filePath.toLowerCase().split(".").pop() || "";
		const supportedExtensions = [
			// 文档
			".pdf",
			".doc",
			".docx",
			".xls",
			".xlsx",
			".ppt",
			".pptx",
			".txt",
			".md",
			".rtf",
			// 图片
			".png",
			".jpg",
			".jpeg",
			".gif",
			".bmp",
			".webp",
			".svg",
			".ico",
			// 代码
			".js",
			".ts",
			".css",
			".html",
			".json",
			".xml",
			".yaml",
			".yml",
		];

		return supportedExtensions.includes(`.${ext}`);
	}

	// 获取文件大小
	private async getFileSize(filePath: string): Promise<number> {
		try {
			const { lstat } = await import("@tauri-apps/plugin-fs");
			const stat = await lstat(filePath);
			return stat.size || 0;
		} catch (_error) {
			return 0;
		}
	}

	/**
	 * 用于同步的插入操作，避免删除重要信息
	 */
	private async insertForSync(tableName: string, item: any): Promise<void> {
		// 检查是否存在相同 type 和 value 的记录
		const { selectSQL } = await import("@/database");

		const existingRecords = (await selectSQL("history", {
			type: item.type,
			value: item.value,
		})) as any[];

		if (existingRecords && existingRecords.length > 0) {
			// 如果存在，检查是否已被删除
			const existing = existingRecords[0];

			// 如果记录已被软删除，不再重新激活（保持删除状态）
			if (existing.deleted === 1) {
				// 跳过已删除的记录，不重新激活
				return;
			}

			// 智能合并策略
			const updateItem = {
				...item,
				id: existing.id, // 保持现有ID
				favorite: this.resolveFavoriteStatus(existing, item), // 智能解决收藏状态冲突
				count: Math.max(existing.count || 0, item.count || 0), // 取更大的计数值
				createTime: existing.createTime, // 保持原有创建时间
			};

			const { updateSQL } = await import("@/database");
			await updateSQL("history", updateItem);
		} else {
			// 如果不存在，使用同步专用的去重插入函数
			const { insertWithDeduplicationForSync } = await import("@/database");
			await insertWithDeduplicationForSync(tableName as any, item);
		}
	}

	/**
	 * 智能解决收藏状态冲突
	 */
	private resolveFavoriteStatus(existing: any, incoming: any): boolean {
		// 处理数据库中的favorite字段，可能是数字(0/1)或布尔值
		const existingIsFavorite =
			existing.favorite === true || existing.favorite === 1;
		const incomingIsFavorite =
			incoming.favorite === true || incoming.favorite === 1;

		// 如果任何一个版本是收藏的，则标记为收藏
		if (existingIsFavorite || incomingIsFavorite) {
			return true;
		}

		// 如果同步模式是收藏模式，且新数据是收藏的，则以新数据为准
		if (this.syncModeConfig?.settings?.onlyFavorites && incomingIsFavorite) {
			return true;
		}

		// 否则保持原有状态
		return existingIsFavorite;
	}

	/**
	 * 检查是否可以同步
	 */
	canSync(): boolean {
		return this.isOnline && !!this.config;
	}

	/**
	 * 下载远程同步数据
	 */
	private async downloadRemoteData(): Promise<SyncData | null> {
		try {
			const filePath = this.getFullSyncFilePath();
			const result = await downloadSyncData(this.config!, filePath);

			if (result.success && result.data) {
				const remoteData = JSON.parse(result.data);
				return remoteData;
			}
			return null;
		} catch (_error) {
			return null;
		}
	}

	// 处理分段图片文件同步
	private async processPackageFilesSync(
		remoteItems: SyncItem[],
		_localItems: any[],
	): Promise<void> {
		try {
			// 筛选出包含文件包的项目
			const packageItems = remoteItems.filter(
				(item) =>
					item._syncType === "package_files" &&
					(item.type === "image" || item.type === "files"),
			);

			if (packageItems.length === 0) {
				return;
			}

			// 设置文件包管理器的WebDAV配置
			if (!this.config) {
				return;
			}
			filePackageManager.setWebDAVConfig(this.config);

			for (const item of packageItems) {
				try {
					// 解析文件包信息
					let packageInfo: any;
					try {
						packageInfo = JSON.parse(item.value);
					} catch (_parseError) {
						continue;
					}

					// 使用智能同步策略处理文件
					const syncResult = await filePackageManager.syncFilesIntelligently(
						packageInfo,
						this.config,
					);

					if (syncResult.paths.length > 0) {
						// 更新本地数据库中的路径
						await this.updateFilePathsInDatabase(item.id, syncResult.paths);
					}
				} catch (_error) {
					// 文件包项处理失败
				}
			}
		} catch (_error) {
			// 文件包同步失败
		}
	}

	/**
	 * 更新数据库中的文件路径
	 */
	private async updateFilePathsInDatabase(
		itemId: string,
		filePaths: string[],
	): Promise<void> {
		const { updateSQL } = await import("@/database");

		// 始终存储为JSON数组以保持一致性
		await updateSQL("history", {
			id: itemId,
			value: JSON.stringify(filePaths),
		});
	}

	/**
	 * 将云端数据合并到本地数据库
	 */
	private async mergeCloudDataToLocal(remoteData: SyncData): Promise<void> {
		// 先处理删除记录（必须在数据合并之前）
		if (remoteData.deleted && remoteData.deleted.length > 0) {
			// 处理删除记录
			for (const deletedId of remoteData.deleted) {
				try {
					// 检查本地是否存在该条目
					const localItems = (await selectSQL("history", {
						id: deletedId,
					})) as any[];
					if (localItems && localItems.length > 0) {
						const localItem = localItems[0];

						// 删除本地条目（软删除）
						await deleteSQL("history", {
							id: deletedId,
							type: localItem.type,
							value: localItem.value,
						});

						// 验证软删除是否成功 - 直接查询不过滤deleted字段
						await executeSQL("SELECT deleted FROM history WHERE id = ?;", [
							deletedId,
						]);
						// 验证删除操作已完成
					} else {
						// 本地不存在该条目
					}
				} catch (_deleteError) {
					// 删除本地条目失败
				}
			}

			// 立即触发界面刷新以显示删除效果
			try {
				// 直接清除Main组件的缓存并刷新
				// 缓存键已移除

				// 清除缓存
				try {
					// 触发界面刷新事件
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_importError) {
					// 忽略导入错误
				}

				// 触发界面刷新事件
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (_refreshError) {
				// 删除记录处理后界面刷新失败
			}
		}

		// 根据同步模式配置过滤云端数据
		let filteredItems = remoteData.items;

		// 过滤删除记录（优先级最高）
		if (remoteData.deleted && remoteData.deleted.length > 0) {
			const deletedSet = new Set(remoteData.deleted);
			filteredItems = filteredItems.filter((item) => !deletedSet.has(item.id));
		}

		if (this.syncModeConfig?.settings) {
			const settings = this.syncModeConfig.settings;

			// 收藏模式：只处理收藏的内容
			if (settings.onlyFavorites) {
				filteredItems = filteredItems.filter((item) => {
					return item.favorite === true;
				});
			}

			// 根据内容类型过滤
			filteredItems = filteredItems.filter((item) => {
				if (item.type === "text" && !settings.includeText) return false;
				if (item.type === "html" && !settings.includeHtml) return false;
				if (item.type === "rtf" && !settings.includeRtf) return false;
				if (item.type === "image" && !settings.includeImages) return false;
				if (item.type === "files" && !settings.includeFiles) return false;
				return true;
			});
		}

		// 转换为本地格式
		const localData = [];
		for (const item of filteredItems) {
			// 跳过本地软删除的项（避免被重新激活）
			if (item.deleted === true) {
				continue;
			}
			const localItem: any = {
				id: item.id,
				type: item.type,
				group: item.group,
				value: item.value,
				search: item.search,
				count: item.count,
				width: item.width,
				height: item.height,
				favorite: item.favorite,
				createTime: item.createTime,
				note: item.note,
				subtype: item.subtype,
				deleted: item.deleted || 0, // 确保删除字段被正确设置
			};

			// 处理文件数据 - 转换为数据库格式
			if (item.type === "files" && item.files) {
				localItem.files = JSON.stringify(item.files);
			}

			// 处理图片数据 - 确保value字段包含正确的图片数据
			if (item.type === "image") {
				// 检查是否是分段存储的图片（JSON metadata）
				if (item.value?.startsWith("[")) {
					try {
						const segmentData = JSON.parse(item.value);
						if (segmentData?.[0]?.originalPath) {
							// 这是分段存储的图片，设置为按需下载模式
							localItem.lazyDownload = 1;
							localItem.fileSize = segmentData[0].originalSize || 0;
							localItem.fileType = segmentData[0].fileType || "image";
							// value字段保持原始JSON metadata，用于后续按需下载
							localItem.value = item.value;
						} else {
							// JSON格式不正确，跳过此项目
							continue;
						}
					} catch (_parseError) {
						// JSON解析失败，跳过此项目
						continue;
					}
				}
				// 正常的本地图片文件路径
				else if (item.value && typeof item.value === "string") {
					localItem.value = item.value;
				}
			}

			// 处理其他可选字段
			if (item.lazyDownload !== undefined) {
				localItem.lazyDownload = item.lazyDownload ? 1 : 0;
			}
			if (item.fileSize !== undefined) {
				localItem.fileSize = item.fileSize;
			}
			if (item.fileType !== undefined) {
				localItem.fileType = item.fileType;
			}

			localData.push(localItem);
		}

		if (localData.length > 0) {
			await this.mergeHistoryData(localData);
		}
	}

	/**
	 * 从云端真正删除已删除的条目
	 */
	private async removeDeletedItemsFromCloud(
		deletedItems: string[],
	): Promise<void> {
		try {
			if (!this.config || deletedItems.length === 0) {
				return;
			}

			// 下载当前的同步数据
			const currentRemoteData = await this.downloadRemoteData();
			if (!currentRemoteData) {
				return;
			}

			const deletedSet = new Set(deletedItems);

			// 从云端数据中移除被删除的条目
			const filteredItems = currentRemoteData.items.filter(
				(item) => !deletedSet.has(item.id),
			);

			// 如果有条目被删除，更新云端数据
			if (filteredItems.length !== currentRemoteData.items.length) {
				// 重新上传清理后的同步数据
				const updatedSyncData: SyncData = {
					...currentRemoteData,
					items: filteredItems,
					timestamp: Date.now(),
				};

				const filePath = this.getFullSyncFilePath();
				const uploadResult = await uploadSyncData(
					this.config,
					filePath,
					JSON.stringify(updatedSyncData, null, 2),
				);

				if (uploadResult.success) {
				} else {
					// 云端条目删除失败
				}
			}
		} catch (_error) {
			// 删除云端条目异常
		}
	}

	/**
	 * 下载远程数据并处理图片文件同步
	 */
	private async downloadRemoteDataAndProcessImages(
		deletedItems: string[] = [],
	): Promise<void> {
		try {
			// 检查是否启用轻量模式，如果启用则跳过图片下载
			if (
				this.syncModeConfig?.mode === "lightweight" ||
				(this.syncModeConfig?.settings?.includeImages === false &&
					this.syncModeConfig?.settings?.includeFiles === false)
			) {
				return;
			}

			// 1. 下载远程数据
			const remoteData = await this.downloadRemoteData();
			if (!remoteData) {
				return;
			}

			// 过滤删除记录（避免重复处理已删除的项目）
			if (deletedItems.length > 0) {
				const deletedSet = new Set(deletedItems);
				remoteData.items = remoteData.items.filter(
					(item) => !deletedSet.has(item.id),
				);
			}

			// 2. 获取本地数据
			const localData = await getHistoryData();
			const localItems: SyncItem[] = (localData as any[]).map((item: any) => ({
				id: item.id,
				type: item.type,
				group: item.group,
				value: item.value,
				search: item.search,
				count: item.count,
				width: item.width,
				height: item.height,
				favorite: item.favorite,
				createTime: item.createTime,
				note: item.note,
				subtype: item.subtype,
				lastModified: item.lastModified || Date.now(),
				deviceId: this.deviceId,
			}));

			// 3. 处理图片文件同步 - 使用包模式
			await this.processPackageFilesSync(remoteData.items, localItems);
		} catch (_error) {
			// 下载远程数据并处理图片同步失败
		}
	}
}

// 创建全局同步引擎实例
export const syncEngine = new SyncEngine();
