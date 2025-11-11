import { LISTEN_KEY } from "@/constants";
import { getHistoryData } from "@/database";
import type { WebDAVConfig } from "@/plugins/webdav";
import type { SyncItem, SyncModeConfig, SyncResult } from "@/types/sync";
import { generateDeviceId } from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
import { cloudDataManager } from "./cloudDataManager";
import { localDataManager } from "./localDataManager";
import { syncConflictResolver } from "./syncConflictResolver";

let syncEventEmitter: (() => void) | null = null;

const setDefaultSyncListener = () => {
	if (!syncEventEmitter) {
		syncEventEmitter = () => {};
	}
};

export const setSyncEventListener = (listener: () => void) => {
	if (syncEventEmitter === listener) {
		return;
	}
	syncEventEmitter = listener;
};

export class SyncEngine {
	private webdavConfig: WebDAVConfig | null = null;
	private deviceId: string = generateDeviceId();
	private isOnline = false;
	private lastSyncTime = 0;
	private syncModeConfig: SyncModeConfig | null = null;
	private isInitialized = false;
	private syncInProgress = false;

	constructor() {
		this.deviceId = generateDeviceId();
		setDefaultSyncListener();
	}

	async initialize(config: WebDAVConfig): Promise<boolean> {
		if (this.isInitialized && this.webdavConfig) {
			const isSameConfig =
				this.webdavConfig.url === config.url &&
				this.webdavConfig.username === config.username &&
				this.webdavConfig.path === config.path;
			if (isSameConfig) return true;
		}

		this.webdavConfig = config;
		this.isOnline = true;
		cloudDataManager.setWebDAVConfig(config);

		const index = await cloudDataManager.downloadSyncIndex();
		this.isInitialized = true;

		return index !== null;
	}

	setSyncModeConfig(config: SyncModeConfig): void {
		if (this.syncModeConfig) {
			const configString = JSON.stringify(config);
			const currentConfigString = JSON.stringify(this.syncModeConfig);
			if (configString === currentConfigString) return;
		}

		this.syncModeConfig = config;
		this.clearCache();
		cloudDataManager.clearCache();
	}

	getDeviceId(): string {
		return this.deviceId;
	}

	/**
	 * 执行完整的双向同步流程
	 * 按照新的统一流程设计：
	 * 1. localDataManager 筛选本地数据
	 * 2. cloudDataManager 检查云端数据
	 * 3. syncConflictResolver 处理冲突
	 * 4. localDataManager 和 cloudDataManager 分别处理结果
	 */
	async performBidirectionalSync(): Promise<SyncResult> {
		if (this.syncInProgress) {
			return {
				success: false,
				uploaded: 0,
				downloaded: 0,
				conflicts: [],
				errors: ["同步正在进行中"],
				duration: 0,
				timestamp: Date.now(),
			};
		}

		if (!this.webdavConfig) {
			throw new Error("WebDAV配置未初始化");
		}

		this.syncInProgress = true;
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
			// 1. 获取原始本地数据
			const localRawData = await getHistoryData(false);

			// 2. localDataManager 根据同步模式筛选出符合条件的本地数据，生成同步项和校验和
			const localSyncItems = localDataManager.filterLocalDataForSync(
				localRawData,
				this.syncModeConfig,
				{ includeDeleted: false },
			);

			// 3. cloudDataManager 检查云端是否有数据
			const remoteIndex = await cloudDataManager.downloadSyncIndex();

			// 4. cloudDataManager 筛选出云端符合条件的数据
			let cloudSyncItems: SyncItem[] = [];
			if (remoteIndex) {
				cloudSyncItems = cloudDataManager.filterCloudDataForSync(
					remoteIndex,
					this.syncModeConfig,
				);
			}

			// 5. 把本地和云端的数据统一发送给 syncConflictResolver 处理冲突
			// 只处理真正有冲突的项目（ID相同但内容不同）
			const conflictContexts = localSyncItems
				.map((localItem) => {
					const remoteItem = cloudSyncItems.find(
						(item) => item.id === localItem.id,
					);
					if (remoteItem && this.hasRealConflict(localItem, remoteItem)) {
						return {
							localItem,
							remoteItem,
							deviceId: this.deviceId,
							mergePreference: "merge" as const,
						};
					}
					return null;
				})
				.filter((item): item is NonNullable<typeof item> => item !== null);

			const conflictResults = syncConflictResolver.resolveMultipleConflicts(
				conflictContexts,
				this.deviceId,
				"merge",
			);

			// 6. 处理同步结果
			const { localResult, cloudResult } = this.processSyncResults(
				localSyncItems,
				cloudSyncItems,
				conflictResults,
			);

			// 7. localDataManager 接收处理后的本地数据，对本地数据库进行操作
			if (
				localResult.itemsToAdd.length > 0 ||
				localResult.itemsToUpdate.length > 0
			) {
				await this.applyLocalChanges(localRawData, localResult);
				result.downloaded =
					localResult.itemsToAdd.length + localResult.itemsToUpdate.length;
			}

			// 8. cloudDataManager 接收处理后的云端数据，对云端数据进行操作
			if (
				cloudResult.itemsToAdd.length > 0 ||
				cloudResult.itemsToUpdate.length > 0
			) {
				const uploadSuccess = await this.applyCloudChanges(cloudResult);
				if (uploadSuccess) {
					result.uploaded =
						cloudResult.itemsToAdd.length + cloudResult.itemsToUpdate.length;
				}
			}

			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch {}

			result.success = true;
			this.lastSyncTime = Date.now();
		} catch (error) {
			result.errors.push(
				`同步异常: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			this.syncInProgress = false;
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	/**
	 * 处理同步结果，分离本地和云端需要处理的数据
	 */
	private processSyncResults(
		localSyncItems: SyncItem[],
		cloudSyncItems: SyncItem[],
		conflictResults: any[],
	) {
		const localResult = {
			itemsToAdd: [] as SyncItem[],
			itemsToUpdate: [] as SyncItem[],
			itemsToDelete: [] as string[],
		};

		const cloudResult = {
			itemsToAdd: [] as SyncItem[],
			itemsToUpdate: [] as SyncItem[],
			itemsToDelete: [] as string[],
		};

		// 处理本地独有的项目（需要上传到云端）
		for (const localItem of localSyncItems) {
			const cloudExists = cloudSyncItems.find(
				(item) => item.id === localItem.id,
			);
			if (!cloudExists) {
				cloudResult.itemsToAdd.push(localItem);
			}
		}

		// 处理云端独有的项目（需要下载到本地）
		for (const cloudItem of cloudSyncItems) {
			const localExists = localSyncItems.find(
				(item) => item.id === cloudItem.id,
			);
			if (!localExists) {
				localResult.itemsToAdd.push(cloudItem);
			}
		}

		// 处理冲突解决结果
		const processedConflictIds = new Set<string>();

		for (const conflictResult of conflictResults) {
			const { resolvedItem, strategy } = conflictResult;

			// 避免重复处理同一个项目
			if (processedConflictIds.has(resolvedItem.id)) {
				continue;
			}
			processedConflictIds.add(resolvedItem.id);

			if (strategy === "remote") {
				// 远程优先，更新本地
				const localExists = localSyncItems.find(
					(item) => item.id === resolvedItem.id,
				);
				if (localExists) {
					// 检查是否已经在待更新列表中
					if (
						!localResult.itemsToUpdate.some(
							(item) => item.id === resolvedItem.id,
						)
					) {
						localResult.itemsToUpdate.push(resolvedItem);
					}
				} else {
					// 检查是否已经在待添加列表中
					if (
						!localResult.itemsToAdd.some((item) => item.id === resolvedItem.id)
					) {
						localResult.itemsToAdd.push(resolvedItem);
					}
				}
			} else if (strategy === "local") {
				// 本地优先，更新云端
				const cloudExists = cloudSyncItems.find(
					(item) => item.id === resolvedItem.id,
				);
				if (cloudExists) {
					// 检查是否已经在待更新列表中
					if (
						!cloudResult.itemsToUpdate.some(
							(item) => item.id === resolvedItem.id,
						)
					) {
						cloudResult.itemsToUpdate.push(resolvedItem);
					}
				} else {
					// 检查是否已经在待添加列表中
					if (
						!cloudResult.itemsToAdd.some((item) => item.id === resolvedItem.id)
					) {
						cloudResult.itemsToAdd.push(resolvedItem);
					}
				}
			} else if (strategy === "merge") {
				// 合并策略，双向更新
				const localExists = localSyncItems.find(
					(item) => item.id === resolvedItem.id,
				);
				const cloudExists = cloudSyncItems.find(
					(item) => item.id === resolvedItem.id,
				);

				if (localExists) {
					// 检查是否已经在待更新列表中
					if (
						!localResult.itemsToUpdate.some(
							(item) => item.id === resolvedItem.id,
						)
					) {
						localResult.itemsToUpdate.push(resolvedItem);
					}
				} else {
					// 检查是否已经在待添加列表中
					if (
						!localResult.itemsToAdd.some((item) => item.id === resolvedItem.id)
					) {
						localResult.itemsToAdd.push(resolvedItem);
					}
				}

				if (cloudExists) {
					// 检查是否已经在待更新列表中
					if (
						!cloudResult.itemsToUpdate.some(
							(item) => item.id === resolvedItem.id,
						)
					) {
						cloudResult.itemsToUpdate.push(resolvedItem);
					}
				} else {
					// 检查是否已经在待添加列表中
					if (
						!cloudResult.itemsToAdd.some((item) => item.id === resolvedItem.id)
					) {
						cloudResult.itemsToAdd.push(resolvedItem);
					}
				}
			}
		}

		return { localResult, cloudResult };
	}

	/**
	 * 应用本地变更
	 */
	private async applyLocalChanges(
		originalData: any[],
		localResult: {
			itemsToAdd: SyncItem[];
			itemsToUpdate: SyncItem[];
			itemsToDelete: string[];
		},
	): Promise<void> {
		// 使用 localDataManager 处理本地数据变更
		await localDataManager.applySyncChanges(originalData, localResult);
	}

	/**
	 * 应用云端变更
	 */
	private async applyCloudChanges(cloudResult: {
		itemsToAdd: SyncItem[];
		itemsToUpdate: SyncItem[];
		itemsToDelete: string[];
	}): Promise<boolean> {
		// 使用 cloudDataManager 处理云端数据变更
		const currentIndex = await cloudDataManager.downloadSyncIndex();
		return await cloudDataManager.applySyncChanges(
			currentIndex,
			cloudResult,
			this.deviceId,
		);
	}

	/**
	 * 检查是否真的有冲突
	 * @param localItem 本地项目
	 * @param remoteItem 云端项目
	 * @returns 是否有真正冲突
	 */
	private hasRealConflict(localItem: SyncItem, remoteItem: SyncItem): boolean {
		// 比较内容
		if (localItem.value !== remoteItem.value) {
			return true;
		}

		// 比较收藏状态
		if (localItem.favorite !== remoteItem.favorite) {
			return true;
		}

		// 比较注释
		const localNote = localItem.note || "";
		const remoteNote = remoteItem.note || "";
		if (localNote !== remoteNote) {
			return true;
		}

		return false;
	}

	getSyncStatus() {
		return {
			isOnline: this.isOnline,
			isSyncing: this.syncInProgress,
			lastSyncTime: this.lastSyncTime,
			pendingCount: 0,
			errorCount: 0,
			syncProgress: 0,
		};
	}

	clearCache(): void {
		cloudDataManager.clearCache();
	}

	canSync(): boolean {
		return this.isOnline && !!this.webdavConfig && !this.syncInProgress;
	}

	async markItemAsDeleted(itemId: string): Promise<boolean> {
		try {
			await updateSQL("history", {
				id: itemId,
				deleted: true,
			});

			return true;
		} catch {
			return false;
		}
	}
}

export const syncEngine = new SyncEngine();
