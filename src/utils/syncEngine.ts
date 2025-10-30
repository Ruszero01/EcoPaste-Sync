import { LISTEN_KEY } from "@/constants";
import { getHistoryData, setImportLogCallback, updateSQL } from "@/database";
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

/**
 * 计算二进制数据的校验和
 */
const _calculateBinaryChecksum = async (data: Uint8Array): Promise<string> => {
	// 使用更好的哈希算法
	let hash = 5381;
	for (let i = 0; i < data.length; i++) {
		hash = (hash << 5) + hash + data[i]; // hash * 33 + data[i]
	}
	// 确保不为0，如果为0则使用默认值
	const result = Math.abs(hash).toString(16);
	return result || "default";
};

// 设置默认的同步事件监听器，确保不会因为没有监听器而失败
const setDefaultSyncListener = () => {
	// 只有在真正没有监听器时才设置默认监听器
	if (!syncEventEmitter) {
		syncEventEmitter = () => {
			// 默认监听器，什么都不做，只是防止报错
		};
	}
};

// 全局日志回调，用于外部日志显示
let globalLogCallback:
	| ((
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
	  ) => void)
	| null = null;

/**
 * 设置全局日志回调
 */
export const setGlobalSyncLogCallback = (
	callback: (
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) => void,
) => {
	globalLogCallback = callback;
};

/**
 * 添加全局日志
 */
const _addGlobalLog = (
	level: "info" | "success" | "warning" | "error",
	message: string,
	data?: any,
) => {
	if (globalLogCallback) {
		globalLogCallback(level, message, data);
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

	/**
	 * 检查项目是否应该包含在轻量模式同步中
	 */
	private shouldIncludeItem(item: any): boolean {
		// 如果没有同步配置，包含所有项目
		if (!this.syncModeConfig || !this.syncModeConfig.settings) {
			return true;
		}

		const settings = this.syncModeConfig.settings;

		// 检查收藏模式
		if (settings.onlyFavorites) {
			const isFavorite = item.favorite === true || item.favorite === 1;
			if (!isFavorite) {
				return false;
			}
		}

		// 检查图片类型
		if (item.type === "image" && !settings.includeImages) {
			return false;
		}

		// 检查文件类型
		if (item.type === "files" && !settings.includeFiles) {
			return false;
		}

		return true;
	}
	private logCallback:
		| ((
				level: "info" | "success" | "warning" | "error",
				message: string,
				data?: any,
		  ) => void)
		| null = null;

	constructor() {
		this.deviceId = generateDeviceId();
		// 设置默认同步事件监听器，防止启动时报错
		setDefaultSyncListener();
	}

	/**
	 * 设置日志回调函数
	 */
	setLogCallback(
		callback: (
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
		) => void,
	) {
		this.logCallback = callback;
	}

	/**
	 * 设置同步模式配置
	 */
	setSyncModeConfig(config: any) {
		this.syncModeConfig = config;

		// 简化日志，只在配置真正变化时输出
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
	 * 获取WebDAV文件路径（用于用户上传的文件）
	 */
	private getWebDAVFilePath(subDir: string, fileName: string): string {
		if (!this.config) return `/${subDir}/${fileName}`;
		const basePath = this.config.path.startsWith("/")
			? this.config.path
			: `/${this.config.path}`;
		return `${basePath}/${subDir}/${fileName}`;
	}

	/**
	 * 获取WebDAV基础路径（用于目录创建）
	 */
	private getWebDAVBasePath(): string {
		if (!this.config) return "/";
		return this.config.path.startsWith("/")
			? this.config.path
			: `/${this.config.path}`;
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
		}
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
		} catch (error) {
			this.addLog("error", "❌ 初始化本地快照失败", { error });
		}
	}

	/**
	 * 获取设备ID
	 */
	getDeviceId(): string {
		return this.deviceId;
	}

	/**
	 * 生成同步文件路径
	 */
	// private getSyncFileName(): string {
	// 	const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
	// 	return `sync-${timestamp}.json`;
	// }

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
	 * 分析本地数据变更（新增、修改、删除）
	 */
	private async analyzeLocalChanges(): Promise<{
		added: any[];
		modified: any[];
		deleted: string[];
	}> {
		try {
			const currentData = await getHistoryData();
			const currentMap = new Map(
				(currentData as any[]).map((item: any) => [item.id, item]),
			);

			const added: any[] = [];
			const modified: any[] = [];
			const deleted: string[] = [];

			// 检查新增和修改
			for (const [id, item] of currentMap) {
				const lastItem = this.lastLocalSnapshot.get(id as string);
				if (!lastItem) {
					// 新增的
					added.push(item);
				} else if (JSON.stringify(item) !== JSON.stringify(lastItem)) {
					// 修改的
					modified.push(item);
				}
			}

			// 检查删除
			for (const [id] of this.lastLocalSnapshot) {
				if (!currentMap.has(id)) {
					deleted.push(id);
				}
			}

			// 更新快照
			this.lastLocalSnapshot = currentMap as Map<string, any>;

			return { added, modified, deleted };
		} catch (error) {
			this.addLog("error", "❌ 分析本地变更失败", { error });
			throw error;
		}
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
					}
				} catch (error) {
					this.addLog("error", "❌ 检测本地删除失败", {
						error: error instanceof Error ? error.message : String(error),
					});
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
						(item) => !beforeSyncLocalIds.has(item.id),
					).length;
				} catch (mergeError) {
					console.error("❌ 数据合并失败，尝试重新下载云端数据", mergeError);
					const latestRemoteData = await this.downloadRemoteData();
					if (latestRemoteData) {
						remoteData = latestRemoteData;

						// 重试合并
						await this.mergeCloudDataToLocal(remoteData);
						result.downloaded = remoteData.items.filter(
							(item) => !beforeSyncLocalIds.has(item.id),
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
						(remoteItem) => remoteItem.id === item.id,
					);
				}

				// 正常情况：检查云端是否已有相同数据
				if (remoteData) {
					const existingRemoteItem = remoteData.items.find(
						(remoteItem) => remoteItem.id === item.id,
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
						const _timestampsMatch =
							existingRemoteItem.lastModified === item.lastModified;

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
					console.error("❌ 跳过逻辑内部发生异常:", error);
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
					(item) => !remoteDataIds.has(item.id),
				).length;
				const updatedItems = actuallyChangedItems.filter((item) =>
					remoteDataIds.has(item.id),
				).length;

				// 如果有删除记录，需要从云端真正删除对应的条目
				if (deletedItems.length > 0) {
					try {
						await this.removeDeletedItemsFromCloud(deletedItems);
					} catch (deleteError) {
						console.error("❌ 云端删除记录处理失败", deleteError);
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
					console.error("❌ 元数据更新失败", metadataError);
					result.errors.push(
						`元数据更新失败: ${metadataError instanceof Error ? metadataError.message : String(metadataError)}`,
					);
					// 不影响整体成功状态
				}

				// 直接触发界面刷新
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (error) {
					console.error("❌ 界面刷新失败", error);
					result.errors.push("界面刷新失败");
				}
			} else {
				const errorMsg = uploadResult.error_message || "上传失败";
				result.errors.push(errorMsg);

				// 详细的上传失败调试信息
				console.error("❌ 上传失败详细调试", {
					errorMessage: uploadResult.error_message,
					syncDataSize: JSON.stringify(syncData).length,
					syncDataItemsCount: syncData.items.length,
					actuallyChangedItemsCount: actuallyChangedItems.length,
					filePath: this.getFullSyncFilePath(),
				});

				// 即使上传失败也尝试刷新界面
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_refreshError) {
					this.addLog("error", "❌ 失败后界面刷新也失败");
				}
			}
		} catch (error) {
			console.error("❌ 同步过程中发生异常", error);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			result.errors.push(`同步异常: ${errorMessage}`);

			// 异常时也尝试刷新界面
			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (_refreshError) {
				this.addLog("error", "❌ 异常后界面刷新也失败");
			}
		}

		result.duration = Date.now() - startTime;

		return result;
	}

	/**
	 * 执行真正的双向数据合并
	 */
	private async performTrueBidirectionalMerge(
		cloudData: SyncItem[],
		localChanges: { added: any[]; modified: any[]; deleted: string[] },
		cloudDeletedItems: string[] = [],
	): Promise<{
		needsUpload: boolean;
		uploaded: number;
		downloaded: number;
		conflicts: string[];
		deletedItems: string[];
	}> {
		const cloudMap = new Map(cloudData.map((item: any) => [item.id, item]));
		const localData = await getHistoryData();
		const localMap = new Map(
			(localData as any[]).map((item: any) => [item.id, item]),
		);

		// 记录当前同步模式配置
		this.addLog("info", "🔧 双向同步 - 当前同步模式配置", {
			模式: this.syncModeConfig?.mode,
			包含图片: this.syncModeConfig?.settings?.includeImages,
			包含文件: this.syncModeConfig?.settings?.includeFiles,
			收藏模式: this.syncModeConfig?.settings?.onlyFavorites,
			轻量模式:
				!this.syncModeConfig?.settings?.includeImages &&
				!this.syncModeConfig?.settings?.includeFiles,
		});

		// 统计本地数据类型
		const localTypeStats = {
			text: 0,
			html: 0,
			rtf: 0,
			image: 0,
			files: 0,
		};
		for (const item of localData as any[]) {
			if (Object.prototype.hasOwnProperty.call(localTypeStats, item.type)) {
				localTypeStats[item.type as keyof typeof localTypeStats]++;
			}
		}

		this.addLog("info", "📊 本地数据统计", {
			本地数据总数: (localData as any[]).length,
			本地类型统计: localTypeStats,
			本地变更: {
				added: localChanges.added.length,
				modified: localChanges.modified.length,
				deleted: localChanges.deleted.length,
			},
		});

		// let _needsUpload = false; // 未使用的变量，注释掉
		let downloaded = 0;
		const conflicts: string[] = [];

		// 合并所有删除记录
		const allDeletedItems = [
			...new Set([...cloudDeletedItems, ...localChanges.deleted]),
		];

		// 1. 处理云端新增的数据（本地没有的，且不在删除列表中）
		for (const [id, cloudItem] of cloudMap) {
			if (!localMap.has(id) && !allDeletedItems.includes(id)) {
				// 根据同步模式配置过滤云端数据
				if (this.syncModeConfig?.settings) {
					const settings = this.syncModeConfig.settings;

					// 收藏模式：只处理收藏的云端数据
					if (settings.onlyFavorites) {
						const isFavorite =
							cloudItem.favorite === true || cloudItem.favorite === 1;
						if (!isFavorite) {
							this.addLog(
								"info",
								`🔖 收藏模式跳过非收藏云端数据: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...`,
							);
							continue;
						}
					}

					// 根据内容类型过滤
					if (cloudItem.type === "text" && !settings.includeText) {
						this.addLog(
							"info",
							`📝 跳过文本类型云端数据: ${cloudItem.search?.substring(0, 20)}...`,
						);
						continue;
					}
					if (cloudItem.type === "html" && !settings.includeHtml) {
						this.addLog(
							"info",
							`🌐 跳过HTML类型云端数据: ${cloudItem.search?.substring(0, 20)}...`,
						);
						continue;
					}
					if (cloudItem.type === "rtf" && !settings.includeRtf) {
						this.addLog(
							"info",
							`📄 跳过富文本类型云端数据: ${cloudItem.search?.substring(0, 20)}...`,
						);
						continue;
					}
					if (cloudItem.type === "image" && !settings.includeImages) {
						this.addLog(
							"info",
							`🖼️ 跳过图片类型云端数据: ${cloudItem.search?.substring(0, 20)}...`,
						);
						continue;
					}
					if (cloudItem.type === "files" && !settings.includeFiles) {
						this.addLog(
							"info",
							`📁 跳过文件类型云端数据: ${cloudItem.search?.substring(0, 20)}...`,
						);
						continue;
					}
				}
				// 检查本地是否已有相同内容的条目（不同ID）
				let existingDuplicate = false;
				for (const [localId, localItem] of localMap) {
					if (
						(localItem as any).type === cloudItem.type &&
						(localItem as any).value === cloudItem.value
					) {
						// 发现重复内容，合并信息
						existingDuplicate = true;

						// 智能合并收藏状态
						const resolvedFavorite = this.resolveFavoriteStatus(
							localItem,
							cloudItem,
						);

						// 保留本地项，但更新一些云端的信息
						const mergedItem = {
							...localItem,
							count: Math.max((localItem as any).count, cloudItem.count),
							note: (localItem as any).note || cloudItem.note,
							favorite: resolvedFavorite,
						};
						localMap.set(localId, mergedItem);

						// 记录合并日志，特别关注收藏状态
						const favoriteChanged =
							(localItem as any).favorite !== resolvedFavorite;
						this.addLog(
							"info",
							`🔗 合并重复内容: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...${favoriteChanged ? " (收藏状态已更新)" : ""}`,
							{
								localFavorite: (localItem as any).favorite,
								cloudFavorite: cloudItem.favorite,
								resolvedFavorite,
							},
						);
						break;
					}
				}

				if (!existingDuplicate) {
					// 云端有，本地没有，且不在任何删除列表中 → 下载到本地
					localMap.set(id, {
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
					downloaded++;
					this.addLog(
						"info",
						`⬇️ 下载云端新数据: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...`,
					);
				}
			} else if (localMap.has(id) && allDeletedItems.includes(id)) {
				// 本地有，但在删除列表中 → 从本地删除
				localMap.delete(id);
				this.addLog(
					"info",
					`🗑️ 同步删除本地数据: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...`,
				);
			} else if (!localMap.has(id) && allDeletedItems.includes(id)) {
				// 云端有，本地没有，且在删除列表中 → 跳过（已删除）
				this.addLog(
					"info",
					`⏭️ 跳过已删除的数据: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...`,
				);
			}
		}

		// 2. 处理冲突（两边都有但内容不同，且不在删除列表中）
		for (const [id, cloudItem] of cloudMap) {
			if (!allDeletedItems.includes(id)) {
				const localItem = localMap.get(id);
				if (localItem) {
					const cloudTime = new Date(cloudItem.createTime).getTime();
					const localTime = new Date((localItem as any).createTime).getTime();

					if (cloudTime !== localTime) {
						// 时间不同，需要解决冲突
						if (cloudTime > localTime) {
							// 云端更新，使用云端数据
							localMap.set(id, {
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
							this.addLog(
								"info",
								`🔄 使用更新的云端数据: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...`,
							);
						} else {
							// 本地更新，标记需要上传
							// _needsUpload = true; // 未使用的变量，注释掉
							this.addLog(
								"info",
								`✅ 本地数据更新，将同步到云端: ${(localItem as any).type} - ${(localItem as any).search?.substring(0, 20)}...`,
							);
						}
					}
				}
			}
		}

		// 3. 构建最终的数据集（排除所有删除项）
		const finalData = Array.from(localMap.values()).filter(
			(item: any) => !allDeletedItems.includes(item.id),
		);

		// 4. 保存合并后的本地数据 - 总是保存以确保数据一致性
		this.addLog(
			"info",
			`💾 保存合并后的本地数据 ${finalData.length} 条，排除了 ${allDeletedItems.length} 个删除项`,
		);

		// 记录保存前的数据状态用于调试
		this.addLog("info", "🔍 数据保存前状态检查", {
			localMapSize: localMap.size,
			finalDataLength: finalData.length,
			deletedItemsCount: allDeletedItems.length,
			downloadedCount: downloaded,
			sampleLocalData:
				localMap.size > 0
					? {
							firstId: Array.from(localMap.keys())[0],
							firstType: (Array.from(localMap.values())[0] as any)?.type,
							firstSearch: (
								Array.from(localMap.values())[0] as any
							)?.search?.substring(0, 20),
						}
					: null,
		});

		if (this.logCallback) {
			setImportLogCallback((message, data) => {
				this.logCallback!("info", `💾 ${message}`, data);
			});
		}

		// 使用智能合并而不是清空重建
		await this.mergeHistoryData(finalData);
		this.addLog("success", "✅ 本地数据合并完成");

		// 5. 触发界面刷新事件
		this.addLog("info", "🔄 触发界面刷新事件");
		triggerSyncEvent();

		// 6. 使用项目原有的刷新事件
		this.addLog("info", "📢 发送项目标准刷新事件");
		try {
			emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			this.addLog("success", "✅ 项目标准刷新事件发送成功");
		} catch (error) {
			this.addLog("error", "❌ 项目标准刷新事件发送失败", {
				error: error instanceof Error ? error.message : String(error),
			});
		}

		return {
			needsUpload:
				localChanges.added.length > 0 ||
				localChanges.modified.length > 0 ||
				localChanges.deleted.length > 0 ||
				cloudDeletedItems.length > 0,
			uploaded: 0, // 实际上传数量在上传时统计
			downloaded,
			conflicts,
			deletedItems: allDeletedItems,
		};
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
			this.addLog("info", "☁️ 开始上传全量同步文件（包含删除记录）", {
				filePath,
				itemCount: syncData.items.length,
				deletedCount: syncData.deleted.length,
			});

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
				this.addLog(
					"success",
					`✅ 上传完成，同步了 ${syncData.items.length} 个项目，包含 ${syncData.deleted.length} 个删除记录`,
				);
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
		try {
			const localData = await getHistoryData();
			const syncItems: SyncItem[] = [];

			this.addLog("info", "🚀 开始转换本地数据为同步格式");

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
				const originalCount = filteredItems.length;

				// 收藏模式：只同步收藏的内容
				if (settings.onlyFavorites) {
					filteredItems = filteredItems.filter((item) => {
						// 处理数据库中的favorite字段，可能是数字(0/1)或布尔值
						const isFavorite = item.favorite === true || item.favorite === 1;
						return isFavorite;
					});
					this.addLog("info", "🔖 收藏模式过滤完成", {
						过滤前: originalCount,
						过滤后: filteredItems.length,
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
						this.addLog(
							"info",
							`🖼️ 跳过图片类型: ${item.search?.substring(0, 30)}...`,
						);
						return false;
					}
					// 文件类型
					if (item.type === "files" && !settings.includeFiles) {
						this.addLog(
							"info",
							`📁 跳过文件类型: ${item.search?.substring(0, 30)}...`,
						);
						return false;
					}

					// 记录包含的文件和图片类型
					if (item.type === "image" || item.type === "files") {
						this.addLog(
							"info",
							`✅ 包含${item.type === "image" ? "图片" : "文件"}类型: ${item.search?.substring(0, 30)}...`,
						);
					}

					return true;
				});

				// 统计各类别数量
				const typeStats = {
					text: 0,
					html: 0,
					rtf: 0,
					image: 0,
					files: 0,
				};
				for (const item of filteredItems) {
					if (Object.prototype.hasOwnProperty.call(typeStats, item.type)) {
						typeStats[item.type as keyof typeof typeStats]++;
					}
				}

				this.addLog("info", "🎯 同步模式过滤完成", {
					mode: this.syncModeConfig.mode,
					onlyFavorites: settings.onlyFavorites,
					过滤前数量: originalCount,
					过滤后数量: filteredItems.length,
					类型统计: typeStats,
					包含设置: {
						text: settings.includeText,
						html: settings.includeHtml,
						rtf: settings.includeRtf,
						images: settings.includeImages,
						files: settings.includeFiles,
					},
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
					} catch (processError) {
						this.addLog("error", `❌ 文件同步处理异常: ${item.type}`, {
							error:
								processError instanceof Error
									? processError.message
									: String(processError),
						});
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
					const remainingSegments = await fileSegmentManager.flushBatch(
						this.config,
					);
					if (remainingSegments.length > 0) {
						this.addLog(
							"success",
							`🚀 批处理队列刷新完成，上传了 ${remainingSegments.length} 个剩余分段`,
						);
					}
				} catch (flushError) {
					this.addLog(
						"error",
						`❌ 批处理队列刷新失败: ${flushError instanceof Error ? flushError.message : String(flushError)}`,
					);
				}
			}

			if (deletedItems.length > 0) {
				this.addLog("info", "🗑️ 包含删除记录", { count: deletedItems.length });
			}

			// 记录最终同步数据统计
			this.addLog("info", "📊 同步数据统计", {
				原始数据: (localData as any[]).length,
				过滤后: filteredItems.length,
				最终同步: syncItems.length,
				删除记录: deletedItems.length,
			});

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
		} catch (error) {
			console.error("转换本地数据失败:", error);
			throw error;
		}
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
					this.addLog("error", "❌ 触发界面刷新失败");
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
				this.addLog("error", "❌ 触发界面刷新失败");
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

		this.addLog("info", "🔍 搜索可用的同步文件", { possibleFiles });

		for (const filePath of possibleFiles) {
			try {
				this.addLog("info", `📥 尝试下载文件: ${filePath}`);
				const result = await downloadSyncData(this.config, filePath);
				if (result.success && result.data) {
					this.addLog("success", `✅ 找到可用文件: ${filePath}`);
					return filePath;
				}
			} catch (error) {
				this.addLog("info", `❌ 文件不可用: ${filePath}`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.addLog("warning", "⚠️ 未找到任何可用的同步文件，将创建新的同步数据");
		return null;
	}

	/**
	 * 全量同步下载
	 */
	async fullSyncDownload(): Promise<SyncResult> {
		this.addLog("info", "🚀 开始全量同步下载", { configExists: !!this.config });

		if (!this.config) {
			this.addLog("error", "❌ WebDAV配置未初始化");
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
				this.addLog("error", "❌ 未找到可用的同步文件");
				result.errors.push("云端没有可用的同步数据");
				return result;
			}

			this.addLog("info", "🌐 开始下载全量同步文件", { filePath });
			const downloadResult = await downloadSyncData(this.config, filePath);
			this.addLog("info", "📦 文件下载完成", {
				success: downloadResult.success,
				hasData: !!downloadResult.data,
				error: downloadResult.error_message,
			});

			if (downloadResult.success && downloadResult.data) {
				// 2. 解析同步数据
				this.addLog("info", "📄 解析同步数据成功");
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
						this.addLog(
							"info",
							`🖼️ ZIP图片文件，将在按需下载时恢复: ${item.search?.substring(0, 20)}...`,
						);
					}

					// 处理文件数组恢复（ZIP格式）
					if (
						item.type === "files" &&
						item.files &&
						Array.isArray(item.files) &&
						item._syncType === "zip_files"
					) {
						// ZIP文件格式暂不在下载时恢复，会在按需下载时处理
						this.addLog(
							"info",
							`📁 ZIP文件数组，将在按需下载时恢复: ${item.search?.substring(0, 20)}...`,
						);
					}

					localData.push(localItem);
				}

				// 4. 根据同步模式配置过滤下载的数据
				if (this.syncModeConfig?.settings) {
					const settings = this.syncModeConfig.settings;
					const originalCount = localData.length;

					this.addLog("info", "📥 开始过滤下载的数据", {
						下载条数: originalCount,
						收藏模式: settings.onlyFavorites,
					});

					// 收藏模式：只处理收藏的内容
					if (settings.onlyFavorites) {
						localData = localData.filter((item) => {
							const isFavorite = item.favorite === true || item.favorite === 1;
							return isFavorite;
						});
						this.addLog("info", "🔖 收藏模式过滤下载数据", {
							过滤前: originalCount,
							过滤后: localData.length,
							保留的收藏数量: localData.filter(
								(item) => item.favorite === true || item.favorite === 1,
							).length,
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

					this.addLog("info", "🎯 下载数据过滤完成", {
						mode: this.syncModeConfig.mode,
						onlyFavorites: settings.onlyFavorites,
						最终条数: localData.length,
						过滤设置: {
							text: settings.includeText,
							html: settings.includeHtml,
							rtf: settings.includeRtf,
							images: settings.includeImages,
							files: settings.includeFiles,
						},
					});
				}

				this.addLog("info", `💾 准备导入 ${localData.length} 条数据到数据库`);
				this.addLog("info", "📋 数据样本", { sample: localData.slice(0, 2) });

				// 确保数据库日志回调已设置
				if (this.logCallback) {
					setImportLogCallback((message, data) => {
						this.logCallback!("info", `💾 ${message}`, data);
					});
				}

				this.addLog("info", "🔄 开始智能合并数据");
				await this.mergeHistoryData(localData);
				this.addLog("success", "✅ 智能合并完成");
				result.downloaded = syncData.items.length;
				result.success = true;

				// 4. 更新元数据
				await this.updateMetadata();
				this.lastSyncTime = Date.now();

				// 5. 短暂延迟确保数据写入完成
				await new Promise((resolve) => setTimeout(resolve, 100));

				// 6. 触发界面刷新事件
				this.addLog("success", "🔄 触发界面刷新事件");
				triggerSyncEvent();

				// 7. 使用项目原有的刷新事件
				this.addLog("info", "📢 发送项目标准刷新事件");
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					this.addLog("success", "✅ 项目标准刷新事件发送成功");
				} catch (error) {
					this.addLog("error", "❌ 项目标准刷新事件发送失败", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				this.addLog("error", "❌ 数据下载失败", {
					error: downloadResult.error_message,
				});
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
		).catch((error) => {
			console.error("更新元数据失败:", error);
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
	 * 直接导入历史数据（参考备份系统逻辑）
	 */
	// private async importHistoryDataDirect(data: any[]) {
	// 	this.addLog("info", "🔄 使用直接导入方式");

	// 	try {
	// 		// 1. 关闭数据库连接
	// 		this.addLog("info", "🔒 关闭数据库连接");
	// 		emit(LISTEN_KEY.CLOSE_DATABASE);

	// 		// 2. 生成 SQL 语句来重建数据库
	// 		const sqlStatements = [
	// 			"DELETE FROM history;",
	// 			...data.map((item) => {
	// 				const fields = Object.keys(item);
	// 				const values = Object.values(item);
	// 				const placeholders = values.map(() => "?").join(", ");
	// 				const sql = `INSERT INTO history (${fields.join(", ")}) VALUES (${placeholders});`;
	// 				return { sql, values };
	// 			}),
	// 		];

	// 		this.addLog("info", `📝 生成了 ${sqlStatements.length} 条 SQL 语句`);

	// 		// 3. 将数据写入临时 SQL 文件
	// 		const dbPath = await getSaveDatabasePath();
	// 		const tempSqlPath = dbPath.replace(".db", "_temp.sql");

	// 		let sqlContent = "";
	// 		for (const statement of sqlStatements) {
	// 			if (typeof statement === "string") {
	// 				sqlContent += `${statement}\n`;
	// 			} else {
	// 				sqlContent += `${statement.sql}\n`;
	// 			}
	// 		}

	// 		await writeTextFile(tempSqlPath, sqlContent);
	// 		this.addLog("success", "✅ SQL 文件生成成功");

	// 		// 4. 使用智能合并而不是清空重建
	// 		await this.mergeHistoryData(data);

	// 		this.addLog("success", "✅ 数据导入完成");
	// 	} catch (error) {
	// 		this.addLog("error", "❌ 直接导入失败", {
	// 			error: error instanceof Error ? error.message : String(error),
	// 		});
	// 		throw error;
	// 	}
	// }

	/**
	 * 获取云端数据但不替换本地数据
	 */
	async fetchCloudDataOnly(): Promise<{
		items: SyncItem[];
		deleted: string[];
	} | null> {
		if (!this.config) {
			this.addLog("error", "❌ WebDAV配置未初始化");
			return null;
		}

		try {
			// 1. 查找最新的可用同步文件
			const filePath = await this.findLatestSyncFile();
			if (!filePath) {
				this.addLog("info", "ℹ️ 云端没有可用的同步数据");
				return null;
			}

			this.addLog("info", "🌐 开始获取云端同步文件", { filePath });
			const downloadResult = await downloadSyncData(this.config, filePath);

			if (downloadResult.success && downloadResult.data) {
				// 2. 解析同步数据
				this.addLog("info", "📄 解析云端同步数据成功");
				const syncData: SyncData = JSON.parse(downloadResult.data);

				this.addLog(
					"info",
					`✅ 获取到云端数据 ${syncData.items.length} 条，删除记录 ${syncData.deleted?.length || 0} 条`,
				);

				return {
					items: syncData.items,
					deleted: syncData.deleted || [],
				};
			}

			this.addLog("error", "❌ 获取云端数据失败", {
				error: downloadResult.error_message,
			});
			return null;
		} catch (error) {
			this.addLog("error", "❌ 获取云端数据异常", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	/**
	 * 智能合并云端数据和本地数据
	 */
	async mergeCloudAndLocalData(cloudItems: SyncItem[]): Promise<void> {
		try {
			this.addLog("info", "🔄 开始智能合并云端和本地数据");

			// 1. 获取本地数据
			const localData = await getHistoryData();
			this.addLog(
				"info",
				`📊 本地数据 ${(localData as any[]).length} 条，云端数据 ${cloudItems.length} 条`,
			);

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
					this.addLog(
						"info",
						`➕ 添加云端新数据: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...`,
					);
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
						this.addLog(
							"info",
							`🔄 使用更新的云端数据: ${cloudItem.type} - ${cloudItem.search?.substring(0, 20)}...`,
						);
					} else {
						// 本地数据更新或相同，保留本地数据
						this.addLog(
							"info",
							`✅ 保留本地数据: ${(localItem as any).type} - ${(localItem as any).search?.substring(0, 20)}...`,
						);
					}
				}
			}

			// 5. 保存合并后的数据
			const mergedArray = Array.from(mergedItems.values());
			this.addLog(
				"info",
				`💾 保存合并后的数据 ${mergedArray.length} 条，解决了 ${conflicts.length} 个冲突`,
			);

			// 设置数据库导入日志回调
			if (this.logCallback) {
				setImportLogCallback((message, data) => {
					this.logCallback!("info", `💾 ${message}`, data);
				});
			}

			await this.mergeHistoryData(mergedArray);
			this.addLog("success", "✅ 数据合并完成");
		} catch (error) {
			this.addLog("error", "❌ 合并数据失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * 智能合并历史数据（不清空现有数据）
	 */
	private async mergeHistoryData(newData: any[]): Promise<void> {
		if (!this.config) return;

		try {
			this.addLog("info", `🔄 开始智能合并 ${newData.length} 条数据`);

			let addedCount = 0;
			let updatedCount = 0;
			let skippedCount = 0;

			// 直接使用 insertForSync 的统一去重逻辑
			// insertForSync 会自动检查 type + value 的重复并进行智能合并
			for (const item of newData) {
				try {
					// 防护检查：确保item不为空且包含必要字段
					if (!item || typeof item !== "object") {
						this.addLog("warning", `⚠️ 跳过无效数据项: ${JSON.stringify(item)}`);
						skippedCount++;
						continue;
					}

					// 防护检查：确保必要字段存在
					if (!item.type || !item.value) {
						this.addLog(
							"warning",
							`⚠️ 跳过缺少必要字段的数据项: type=${item.type}, value=${!!item.value}`,
						);
						skippedCount++;
						continue;
					}

					// 处理按需下载项目的数据恢复
					const processedItem = await this.processLazyDownloadItem(item);

					// 再次防护检查处理后的数据
					if (!processedItem || !processedItem.type || !processedItem.value) {
						this.addLog(
							"warning",
							`⚠️ 跳过处理后无效的数据项: ${processedItem?.type}`,
						);
						skippedCount++;
						continue;
					}

					// 检查是否已存在相同 type + value 的记录（排除已删除的）
					const { selectSQL } = await import("@/database");
					const existingRecords = (await selectSQL("history", {
						type: processedItem.type,
						value: processedItem.value,
						deleted: false, // 只查找未删除的记录
					})) as any[];

					if (existingRecords && existingRecords.length > 0) {
						// 如果存在，检查是否需要更新
						const existing = existingRecords[0];

						// 防护检查：确保existing有createTime字段
						if (!existing.createTime) {
							this.addLog(
								"warning",
								`⚠️ 现有记录缺少createTime字段，跳过更新: ${processedItem.type}`,
							);
							skippedCount++;
							continue;
						}

						// 防护检查：确保processedItem有createTime字段
						if (!processedItem.createTime) {
							this.addLog(
								"warning",
								`⚠️ 新记录缺少createTime字段，跳过更新: ${processedItem.type}`,
							);
							skippedCount++;
							continue;
						}

						const newTime = new Date(processedItem.createTime).getTime();
						const existingTime = new Date(existing.createTime).getTime();

						// 防护检查：确保时间戳有效
						if (Number.isNaN(newTime) || Number.isNaN(existingTime)) {
							this.addLog(
								"warning",
								`⚠️ 时间戳无效，跳过更新: ${processedItem.type}`,
							);
							skippedCount++;
							continue;
						}

						// 只有当时间戳不同或收藏状态不同时才更新
						const favoriteChanged =
							existing.favorite !== processedItem.favorite;
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
							updatedCount++;
							this.addLog("info", `🔄 更新现有记录: ${processedItem.type}`);
						} else {
							skippedCount++;
							this.addLog("info", `⏭️ 跳过重复记录: ${processedItem.type}`);
						}
					} else {
						// 不存在，插入新记录
						await this.insertForSync("history", processedItem);
						addedCount++;
					}
				} catch (itemError) {
					this.addLog(
						"error",
						`❌ 处理单条记录失败: ${item?.type || "unknown"}`,
						{
							error:
								itemError instanceof Error
									? itemError.message
									: String(itemError),
							item: item ? JSON.stringify(item).substring(0, 200) : "null",
						},
					);
					skippedCount++;
				}
			}

			// 3. 删除在新数据中不存在的现有数据（可选）
			// 这里不删除，保持数据完整性

			this.addLog(
				"success",
				`✅ 智能合并完成：新增 ${addedCount} 条，更新 ${updatedCount} 条，跳过重复 ${skippedCount} 条`,
			);
		} catch (error) {
			this.addLog("error", "❌ 智能合并失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
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
				this.addLog(
					"info",
					`🔄 处理按需下载项目: ${item.type} - ${item.search?.substring(0, 20)}...`,
				);

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
					} catch (fileStatusError) {
						this.addLog(
							"warning",
							`⚠️ 获取文件状态失败，跳过处理: ${item.type}`,
							{
								error:
									fileStatusError instanceof Error
										? fileStatusError.message
										: String(fileStatusError),
							},
						);
						return item; // 返回原始项目
					}

					this.addLog("info", "📊 文件状态信息", {
						isLazyDownload: fileStatus?.isLazyDownload || false,
						isAvailable: fileStatus?.isAvailable || false,
						fileSize: fileStatus?.fileSize || 0,
						fileType: fileStatus?.fileType || "",
					});

					// 如果文件不可用且是按需下载，保留原始value（WebDAV路径）
					// 这样在用户需要时可以触发下载
					if (fileStatus?.isLazyDownload && !fileStatus?.isAvailable) {
						this.addLog(
							"info",
							`📥 按需下载文件暂未缓存，保留云端引用: ${item.value}`,
						);
						return item; // 保持原始value不变
					}
				} catch (processError) {
					this.addLog("error", `❌ 处理文件项目失败: ${item.type}`, {
						error:
							processError instanceof Error
								? processError.message
								: String(processError),
						itemId: item.id,
					});
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
		} catch (error) {
			this.addLog("error", "❌ 处理按需下载项目失败", {
				error: error instanceof Error ? error.message : String(error),
				itemId: item.id,
			});
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
			this.addLog(
				"info",
				`🔄 开始处理文件同步项: ${item.type} - ${item.search?.substring(0, 30)}...`,
			);

			if (item.type === "image") {
				return await this.processImageFile(item);
			}
			if (item.type === "files") {
				return await this.processFilesArray(item);
			}

			return this.convertToSyncItem(item);
		} catch (error) {
			this.addLog("error", "文件同步处理失败", { error, item });
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
								(item) =>
									typeof item === "string" &&
									(item.includes(":") ||
										item.includes("/") ||
										item.includes("\\")),
							) || parsed[0];
					}
				} catch (error) {
					console.error("解析图片路径数组失败:", error);
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
				} catch (parseError) {
					this.addLog("warning", "解析包信息失败，按常规图片处理", {
						error: parseError,
					});
				}
			}

			// 检查文件大小
			const fileSize = await this.getFileSize(imagePath);
			const maxFileSize = 50 * 1024 * 1024; // 50MB限制

			if (fileSize > maxFileSize) {
				this.addLog(
					"warning",
					`图片文件过大跳过同步: ${imagePath} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`,
				);
				return this.convertToSyncItem(item);
			}

			if (!this.config) {
				this.addLog("error", "WebDAV配置未设置，无法处理图片文件");
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
				this.addLog("error", `图片文件打包失败: ${imagePath}`);
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
		} catch (error) {
			this.addLog("error", `❌ 图片文件包处理失败: ${item.value}`, {
				error: error instanceof Error ? error.message : String(error),
			});
			return this.convertToSyncItem(item); // 失败时回退到普通模式
		}
	}

	// 处理文件数组（使用文件包存储）
	private async processFilesArray(item: any): Promise<SyncItem | null> {
		try {
			let filePaths: string[];
			try {
				filePaths = JSON.parse(item.value);
			} catch (parseError) {
				this.addLog("error", "文件路径JSON解析失败", { error: parseError });
				return this.convertToSyncItem(item);
			}

			// 过滤和验证文件
			const validFilePaths: string[] = [];
			const maxFileSize = 50 * 1024 * 1024; // 50MB限制
			let totalSize = 0;

			for (const filePath of filePaths) {
				// 检查文件类型
				if (!this.isSupportedFileType(filePath)) {
					continue;
				}

				// 检查文件大小
				const fileSize = await this.getFileSize(filePath);
				if (fileSize > maxFileSize) {
					this.addLog(
						"warning",
						`文件过大跳过同步: ${filePath} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`,
					);
					continue;
				}

				// 检查文件类型是否支持
				const fileType = this.getFileType(filePath);
				if (!globalStore.cloudSync.fileSync.supportedTypes[fileType]) {
					continue;
				}

				validFilePaths.push(filePath);
				totalSize += fileSize;
			}

			if (validFilePaths.length === 0) {
				this.addLog("warning", "没有有效文件，回退到基本同步");
				return this.convertToSyncItem(item);
			}

			if (!this.config) {
				this.addLog("error", "WebDAV配置未设置，无法处理文件数组");
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
				this.addLog("error", "文件数组打包失败");
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
				fileSize: totalSize,
				fileType: "files",
			};
			return syncItem;
		} catch (error) {
			this.addLog("error", "文件数组包处理失败，回退到基本同步", {
				error: error instanceof Error ? error.message : String(error),
				item: { type: item.type, search: item.search?.substring(0, 30) },
			});
			return this.convertToSyncItem(item);
		}
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
	 * 读取图片文件
	 */
	private async readImageFile(filePath: string): Promise<ArrayBuffer | null> {
		try {
			const { readFile } = await import("@tauri-apps/plugin-fs");
			const fileData = await readFile(filePath);
			return fileData.buffer.slice(0) as ArrayBuffer;
		} catch (_error) {
			return null;
		}
	}

	/**
	 * 用于同步的插入操作，避免删除重要信息
	 */
	private async insertForSync(tableName: string, item: any): Promise<void> {
		try {
			this.addLog(
				"info",
				`同步插入数据: ${item.type} - ${item.search?.substring(0, 30)}... (收藏: ${item.favorite})`,
			);

			// 检查是否存在相同 type 和 value 的记录
			const { selectSQL } = await import("@/database");

			const existingRecords = (await selectSQL("history", {
				type: item.type,
				value: item.value,
			})) as any[];

			if (existingRecords && existingRecords.length > 0) {
				// 如果存在，更新现有记录但保留重要字段
				const existing = existingRecords[0];

				// 智能合并策略
				const updateItem = {
					...item,
					id: existing.id, // 保持现有ID
					favorite: this.resolveFavoriteStatus(existing, item), // 智能解决收藏状态冲突
					count: Math.max(existing.count || 0, item.count || 0), // 取更大的计数值
					createTime: existing.createTime, // 保持原有创建时间
				};

				// 如果收藏状态有变化，记录日志
				if (existing.favorite !== updateItem.favorite) {
					this.addLog(
						"info",
						`🔖 收藏状态更新: ${existing.favorite} → ${updateItem.favorite}`,
						{
							content: item.search?.substring(0, 30),
						},
					);
				}

				const { updateSQL } = await import("@/database");
				await updateSQL("history", updateItem);
				this.addLog("info", `更新现有同步数据: ${item.type}`);
			} else {
				// 如果不存在，使用同步专用的去重插入函数
				const { insertWithDeduplicationForSync } = await import("@/database");
				await insertWithDeduplicationForSync(tableName as any, item);
				this.addLog(
					"info",
					`插入新同步数据: ${item.type} (收藏: ${item.favorite})`,
				);
			}
		} catch (error) {
			this.addLog("error", "同步插入失败", { error, item });
			throw error;
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
	 * 确保WebDAV目录存在
	 */
	private async ensureWebDAVDirectory(dirPath: string): Promise<void> {
		try {
			this.addLog("info", `检查WebDAV目录: ${dirPath}`);

			const { createDirectory } = await import("@/plugins/webdav");
			const result = await createDirectory(this.config!, dirPath);

			if (result && typeof result === "object" && "success" in result) {
				if ((result as any).success) {
					this.addLog("success", `WebDAV目录创建成功: ${dirPath}`);
				} else {
					// 目录可能已存在，这是正常情况
					this.addLog("info", `WebDAV目录已存在或创建失败: ${dirPath}`, {
						error_message: (result as any).error_message,
					});
				}
			}
		} catch (error) {
			this.addLog("warning", `WebDAV目录检查失败，但继续尝试上传: ${dirPath}`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
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
				this.addLog("info", "✅ 远程数据下载成功", {
					远程项目数量: remoteData.items?.length || 0,
					删除记录数量: remoteData.deleted?.length || 0,
				});
				return remoteData;
			}
			this.addLog("warning", "⚠️ 远程数据下载失败", {
				error: result.error_message,
			});
			return null;
		} catch (error) {
			this.addLog("error", "❌ 下载远程数据异常", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	/**
	 * 处理ZIP图片文件同步
	 */

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
				console.error("WebDAV配置未设置，无法同步文件包");
				return;
			}
			filePackageManager.setWebDAVConfig(this.config);

			for (const item of packageItems) {
				try {
					// 解析文件包信息
					let packageInfo: any;
					try {
						packageInfo = JSON.parse(item.value);
					} catch (parseError) {
						this.addLog("error", `文件包信息解析失败: ${item.value}`, {
							error: parseError,
						});
						continue;
					}

					this.addLog("info", `🔄 开始智能同步文件包: ${item.id}`);

					// 使用智能同步策略处理文件
					const syncResult = await filePackageManager.syncFilesIntelligently(
						packageInfo,
						this.config,
					);

					if (syncResult.paths.length > 0) {
						// 更新本地数据库中的路径
						await this.updateFilePathsInDatabase(item.id, syncResult.paths);
						this.addLog(
							"success",
							`✅ 文件包同步成功: ${item.id} -> ${syncResult.paths.length} 个文件`,
						);
					} else {
						this.addLog("error", `❌ 文件包同步失败: ${item.id}`);
					}
				} catch (error) {
					this.addLog("error", `❌ 文件包项处理失败: ${item.id}`, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}

			this.addLog("success", "🎉 文件包同步处理完成");
		} catch (error) {
			this.addLog("error", "❌ 文件包同步失败", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * 更新数据库中的文件路径
	 */
	private async updateFilePathsInDatabase(
		itemId: string,
		filePaths: string[],
	): Promise<void> {
		try {
			const { updateSQL } = await import("@/database");

			// 始终存储为JSON数组以保持一致性
			await updateSQL("history", {
				id: itemId,
				value: JSON.stringify(filePaths),
			});
			this.addLog(
				"info",
				`✅ 数据库文件路径已更新: ${itemId} -> ${filePaths.length} 个文件`,
			);
		} catch (error) {
			this.addLog("error", `❌ 更新数据库文件路径失败: ${itemId}`, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * 检查项目是否在本地存在
	 */
	private itemExistsInLocal(itemId: string): boolean {
		return this.lastLocalSnapshot?.has(itemId) || false;
	}

	/**
	 * 将云端数据合并到本地数据库
	 */
	private async mergeCloudDataToLocal(remoteData: SyncData): Promise<void> {
		try {
			// 先处理删除记录（必须在数据合并之前）
			if (remoteData.deleted && remoteData.deleted.length > 0) {
				let _deletedCount = 0;
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
							_deletedCount++;

							// 验证软删除是否成功 - 直接查询不过滤deleted字段
							const verifyItems = (await executeSQL(
								"SELECT deleted FROM history WHERE id = ?;",
								[deletedId],
							)) as any[];
							const _verifyItem =
								verifyItems.length > 0 ? verifyItems[0] : null;

							// 验证getHistoryData是否能正确过滤
							const allItems = (await executeSQL(
								"SELECT id, deleted FROM history;",
							)) as any[];
							const _activeItems = allItems.filter(
								(item) => item.deleted === false,
							);
						} else {
						}
					} catch (deleteError) {
						console.error(`❌ 删除本地条目失败: ${deletedId}`, deleteError);
					}
				}

				// 立即触发界面刷新以显示删除效果
				try {
					// 直接清除Main组件的缓存并刷新
					const _cacheKey = JSON.stringify({
						group: undefined,
						search: undefined,
						favorite: undefined,
						deleted: 0,
					});

					// 清除缓存
					try {
						// 触发界面刷新事件
						emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					} catch (_importError) {
						// 忽略导入错误
					}

					// 触发界面刷新事件
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (refreshError) {
					console.error("❌ 删除记录处理后界面刷新失败", refreshError);
				}
			}

			// 根据同步模式配置过滤云端数据
			let filteredItems = remoteData.items;

			// 过滤删除记录（优先级最高）
			if (remoteData.deleted && remoteData.deleted.length > 0) {
				const deletedSet = new Set(remoteData.deleted);
				const _originalCount = filteredItems.length;
				filteredItems = filteredItems.filter(
					(item) => !deletedSet.has(item.id),
				);
			}

			if (this.syncModeConfig?.settings) {
				const settings = this.syncModeConfig.settings;
				const originalCount = filteredItems.length;

				// 收藏模式：只处理收藏的内容
				if (settings.onlyFavorites) {
					filteredItems = filteredItems.filter((item) => {
						return item.favorite === true;
					});
					this.addLog("info", "🔖 收藏模式过滤云端数据", {
						过滤前: originalCount,
						过滤后: filteredItems.length,
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

				this.addLog("info", "🎯 云端数据过滤完成", {
					最终条数: filteredItems.length,
				});
			}

			// 转换为本地格式
			const localData = [];
			for (const item of filteredItems) {
				// 跳过本地软删除的项（避免被重新激活）
				if (item.deleted === true) {
					this.addLog("info", `⏭️ 跳过本地软删除的条目: ${item.id}`);
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

								this.addLog("info", "📥 设置图片为按需下载模式", {
									itemId: item.id,
									originalPath: segmentData[0].originalPath,
									fileSize: localItem.fileSize,
								});
							} else {
								// JSON格式不正确，跳过此项目
								this.addLog(
									"warning",
									"⚠️ 图片JSON metadata格式不正确，跳过此项目",
									{
										itemId: item.id,
										value: item.value.substring(0, 100),
									},
								);
								continue;
							}
						} catch (parseError) {
							// JSON解析失败，跳过此项目
							this.addLog(
								"warning",
								"⚠️ 图片JSON metadata解析失败，跳过此项目",
								{
									itemId: item.id,
									value: item.value.substring(0, 100),
									error:
										parseError instanceof Error
											? parseError.message
											: String(parseError),
								},
							);
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
				this.addLog("info", "💾 开始导入云端数据到数据库");

				await this.mergeHistoryData(localData);
				this.addLog("success", "✅ 云端数据合并完成");
			} else {
				this.addLog("info", "📭 没有需要合并的云端数据");
			}
		} catch (error) {
			this.addLog("error", "❌ 合并云端数据失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
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
			const originalCount = currentRemoteData.items.length;

			// 从云端数据中移除被删除的条目
			const filteredItems = currentRemoteData.items.filter(
				(item) => !deletedSet.has(item.id),
			);

			// 如果有条目被删除，更新云端数据
			if (filteredItems.length !== originalCount) {
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
					console.error("❌ 云端条目删除失败", uploadResult.error_message);
				}
			} else {
			}
		} catch (error) {
			console.error("❌ 删除云端条目异常", error);
		}
	}

	/**
	 * 清理云端删除记录（仅清理所有设备都已确认的删除记录）
	 */
	private async clearRemoteDeletedRecords(
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

			// 只有当云端数据中完全不包含被删除的条目时，才清理删除记录
			const deletedSet = new Set(deletedItems);
			const _originalCount = currentRemoteData.deleted?.length || 0;

			// 检查云端数据是否还包含被删除的条目
			const hasDeletedItemsInCloudData = currentRemoteData.items.some((item) =>
				deletedSet.has(item.id),
			);

			if (hasDeletedItemsInCloudData) {
				return;
			}

			// 确认所有相关数据都已从云端移除后，才清理删除记录
			const newDeletedRecords = (currentRemoteData.deleted || []).filter(
				(id) => !deletedSet.has(id),
			);

			// 重新上传清理后的同步数据
			const cleanedSyncData: SyncData = {
				...currentRemoteData,
				deleted: newDeletedRecords,
				timestamp: Date.now(),
			};

			const filePath = this.getFullSyncFilePath();
			const uploadResult = await uploadSyncData(
				this.config,
				filePath,
				JSON.stringify(cleanedSyncData, null, 2),
			);

			if (uploadResult.success) {
			} else {
				console.error("❌ 云端删除记录清理失败", uploadResult.error_message);
			}
		} catch (error) {
			console.error("❌ 清理云端删除记录异常", error);
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
				this.addLog("info", "🚫 轻量模式已启用，跳过图片文件下载");
				return;
			}

			// 1. 下载远程数据
			const remoteData = await this.downloadRemoteData();
			if (!remoteData) {
				this.addLog("info", "📭 没有远程数据，跳过图片同步");
				return;
			}

			// 过滤删除记录（避免重复处理已删除的项目）
			if (deletedItems.length > 0) {
				const deletedSet = new Set(deletedItems);
				const _originalCount = remoteData.items.length;
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
			this.addLog("info", "🔄 包模式 - 开始自动图片下载");

			try {
				await this.processPackageFilesSync(remoteData.items, localItems);
			} catch (packageError) {
				console.error("❌ 文件包同步失败详细调试", {
					error:
						packageError instanceof Error
							? packageError.message
							: String(packageError),
					errorStack:
						packageError instanceof Error ? packageError.stack : undefined,
					remoteDataItems: remoteData.items.length,
					localItems: localItems.length,
				});
				throw packageError;
			}
		} catch (error) {
			this.addLog("error", "❌ 下载远程数据并处理图片同步失败", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

// 创建全局同步引擎实例
export const syncEngine = new SyncEngine();
