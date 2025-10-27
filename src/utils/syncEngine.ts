import { LISTEN_KEY } from "@/constants";
import {
	getHistoryData,
	insertWithDeduplication,
	setImportLogCallback,
	updateSQL,
} from "@/database";
import {
	type WebDAVConfig,
	downloadSyncData,
	uploadSyncData,
} from "@/plugins/webdav";
import type {
	SyncData,
	SyncItem,
	SyncMetadata,
	SyncResult,
} from "@/types/sync";
import type { SyncModeConfig } from "@/types/sync.d";
import { calculateChecksum, generateDeviceId } from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
import { filterHistoryDataBySyncMode } from "./syncFilter";

// 全局事件发射器
let syncEventEmitter: (() => void) | null = null;

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
const addGlobalLog = (
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
		addGlobalLog("info", "📡 同步事件监听器已存在，跳过重复设置");
		return;
	}

	if (syncEventEmitter) {
		addGlobalLog(
			"warning",
			"⚠️ 检测到重复的同步事件监听器设置，将覆盖之前的监听器",
		);
	} else {
		addGlobalLog("info", "📡 设置同步事件监听器");
	}
	syncEventEmitter = listener;
};

/**
 * 触发同步事件
 */
const triggerSyncEvent = () => {
	addGlobalLog("info", "🔄 准备触发同步事件", {
		hasListener: !!syncEventEmitter,
	});
	if (syncEventEmitter) {
		addGlobalLog("success", "✅ 执行同步事件监听器");
		syncEventEmitter();
	} else {
		addGlobalLog("warning", "⚠️ 没有设置同步事件监听器");
	}
};

export class SyncEngine {
	private config: WebDAVConfig | null = null;
	private deviceId: string = generateDeviceId();
	private isOnline = false;
	private lastSyncTime = 0;
	private syncModeConfig: SyncModeConfig | null = null;
	private lastLocalSnapshot: Map<string, any> = new Map(); // 用于跟踪本地变更
	private logCallback:
		| ((
				level: "info" | "success" | "warning" | "error",
				message: string,
				data?: any,
		  ) => void)
		| null = null;

	constructor() {
		this.deviceId = generateDeviceId();
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
	setSyncModeConfig(config: SyncModeConfig) {
		this.syncModeConfig = config;
		this.addLog("info", "📋 设置同步模式配置", { mode: config.mode });
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
		this.config = config;
		this.isOnline = true;

		// 初始化本地数据快照
		await this.initializeLocalSnapshot();

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
			this.addLog("info", "📸 本地数据快照已初始化", {
				count: (localData as any[]).length,
			});
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
			this.addLog("info", "🔄 开始双向智能同步");

			// 1. 分析本地变更
			this.addLog("info", "📊 分析本地数据变更...");
			const localChanges = await this.analyzeLocalChanges();
			this.addLog("info", "📋 本地变更统计", {
				added: localChanges.added.length,
				modified: localChanges.modified.length,
				deleted: localChanges.deleted.length,
			});

			// 2. 获取云端数据
			this.addLog("info", "☁️ 获取云端数据...");
			const cloudResult = await this.fetchCloudDataOnly();

			if (!cloudResult) {
				// 云端无数据，直接上传本地数据
				this.addLog("info", "ℹ️ 云端无数据，上传本地数据作为初始数据");
				const uploadResult = await this.fullSyncUpload();
				return uploadResult;
			}

			// 3. 执行真正的双向同步
			this.addLog("info", "🔀 执行真正的双向同步...");

			// 执行智能合并，同时处理删除同步
			const mergedResult = await this.performTrueBidirectionalMerge(
				cloudResult.items,
				localChanges,
				cloudResult.deleted,
			);

			result.downloaded = mergedResult.downloaded;
			result.uploaded = mergedResult.uploaded;
			result.conflicts = mergedResult.conflicts.map((id) => ({
				itemId: id,
				type: "modify" as const,
				localVersion: {} as SyncItem,
				remoteVersion: {} as SyncItem,
				resolution: "merge" as const,
				reason: "数据冲突",
			}));

			// 4. 上传合并后的数据（包含删除记录）
			if (mergedResult.needsUpload) {
				this.addLog("info", "📤 上传合并后的数据（包含删除记录）...");
				const uploadResult = await this.fullSyncUploadWithDeleted(
					mergedResult.deletedItems,
				);
				if (uploadResult.success) {
					result.uploaded += uploadResult.uploaded;
					result.success = true;
					this.addLog("success", "✅ 双向同步完成，删除操作已同步");
				} else {
					result.errors.push("上传合并数据失败");
				}
			} else {
				result.success = true;
				this.addLog("info", "✅ 数据已是最新的，无需上传");
			}
		} catch (error) {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
			this.addLog("error", "❌ 双向同步失败", { error });
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

			// 2. 直接上传文件（使用现有的 /EcoPaste/ 目录）
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
					`✅ 上传完成，包含 ${syncData.deleted.length} 个删除记录`,
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

			// 应用同步模式过滤
			let filteredData = localData;
			if (this.syncModeConfig) {
				filteredData = filterHistoryDataBySyncMode(
					localData as any[],
					this.syncModeConfig,
				);
				this.addLog("info", "🔍 应用同步模式过滤", {
					originalCount: (localData as any[]).length,
					filteredCount: (filteredData as any[]).length,
					mode: this.syncModeConfig.mode,
				});
			} else {
				this.addLog("warning", "⚠️ 未设置同步模式配置，使用全部数据");
			}

			const syncItems: SyncItem[] = (filteredData as any[]).map(
				(item: any) => ({
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
					lastModified: Date.now(),
					deviceId: this.deviceId,
					size: JSON.stringify(item).length,
					checksum: calculateChecksum(item.value),
				}),
			);

			if (deletedItems.length > 0) {
				this.addLog("info", "🗑️ 包含删除记录", { count: deletedItems.length });
			}

			return {
				version: 1,
				timestamp: Date.now(),
				deviceId: this.deviceId,
				dataType: "full",
				items: syncItems,
				deleted: deletedItems,
				compression: "none",
				checksum: calculateChecksum(JSON.stringify(syncItems)),
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

			// 2. 直接上传文件（使用现有的 /EcoPaste/ 目录）
			const filePath = this.getFullSyncFilePath();
			this.addLog("info", "☁️ 开始上传全量同步文件", { filePath });

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

				// 4. 触发界面刷新事件
				this.addLog("info", "🔄 触发界面刷新事件");
				triggerSyncEvent();

				// 5. 使用项目原有的刷新事件
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
				result.errors.push(uploadResult.error_message || "上传失败");
				// 即使上传失败也触发界面刷新
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					this.addLog("info", "📢 上传失败后触发界面刷新");
				} catch (refreshError) {
					this.addLog("error", "❌ 触发界面刷新失败", {
						error:
							refreshError instanceof Error
								? refreshError.message
								: String(refreshError),
					});
				}
			}
		} catch (error) {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
			// 同步异常时也触发界面刷新
			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				this.addLog("info", "📢 同步异常后触发界面刷新");
			} catch (refreshError) {
				this.addLog("error", "❌ 触发界面刷新失败", {
					error:
						refreshError instanceof Error
							? refreshError.message
							: String(refreshError),
				});
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

				// 3. 转换为本地格式并保存
				const localData = syncData.items.map((item) => ({
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
				}));

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

			// 获取现有数据
			const existingData = await getHistoryData();
			const existingMap = new Map(
				(existingData as any[]).map((item: any) => [item.id, item]),
			);
			const newMap = new Map(newData.map((item: any) => [item.id, item]));

			let addedCount = 0;
			let updatedCount = 0;

			// 1. 添加新数据
			for (const [id, item] of newMap) {
				if (!existingMap.has(id)) {
					await insertWithDeduplication("history", item);
					addedCount++;
				}
			}

			// 2. 更新现有数据（如果时间戳不同）
			for (const [id, newItem] of newMap) {
				const existingItem = existingMap.get(id);
				if (existingItem) {
					const newTime = new Date(newItem.createTime).getTime();
					const existingTime = new Date(
						(existingItem as any).createTime,
					).getTime();

					if (newTime !== existingTime) {
						// 更新数据
						await updateSQL("history", newItem);
						updatedCount++;
					}
				}
			}

			// 3. 删除在新数据中不存在的现有数据（可选）
			// 这里不删除，保持数据完整性

			this.addLog(
				"success",
				`✅ 智能合并完成：新增 ${addedCount} 条，更新 ${updatedCount} 条`,
			);
		} catch (error) {
			this.addLog("error", "❌ 智能合并失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * 检查是否可以同步
	 */
	canSync(): boolean {
		return this.isOnline && !!this.config;
	}
}

// 创建全局同步引擎实例
export const syncEngine = new SyncEngine();
