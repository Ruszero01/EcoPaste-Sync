import { LISTEN_KEY } from "@/constants";
import { getHistoryData } from "@/database";
import type { WebDAVConfig } from "@/plugins/webdav";
import type { SyncItem, SyncModeConfig, SyncResult } from "@/types/sync";
import { generateDeviceId } from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
import { bookmarkSync } from "./bookmarkSync";
import { cloudDataManager } from "./cloudDataManager";
import { deleteManager } from "./deleteManager";
import { fileSyncManager } from "./fileSyncManager";
import { localDataManager } from "./localDataManager";
import {
	detectRealConflicts,
	syncConflictResolver,
} from "./syncConflictResolver";

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
		// 初始化文件同步管理器
		fileSyncManager.setWebDAVConfig(null);
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
		fileSyncManager.setWebDAVConfig(config);

		// 修复版本升级后的同步状态问题
		await this.fixSyncStatusAfterUpgrade();

		const index = await cloudDataManager.downloadSyncIndex();
		this.isInitialized = true;

		return index !== null;
	}

	/**
	 * 修复版本升级后的同步状态问题
	 * 解决覆盖安装后所有数据被错误标记为已同步的问题
	 */
	private async fixSyncStatusAfterUpgrade(): Promise<void> {
		if (!this.syncModeConfig) {
			return; // 如果没有同步配置，跳过修复
		}

		try {
			const { getHistoryData, batchUpdateSyncStatus } = await import(
				"@/database"
			);
			const allItems = await getHistoryData(true);

			// 找出同步状态异常的项目
			const abnormalItems = allItems.filter((item) => {
				// 如果项目显示为已同步，但实际不符合同步要求，需要修复
				if (item.syncStatus === "synced") {
					const isValidForSync =
						localDataManager.filterLocalDataForSync(
							[item],
							this.syncModeConfig,
							{ includeDeleted: false },
						).length > 0;

					return !isValidForSync;
				}

				// 如果同步状态为空或异常，也进行修复
				if (!item.syncStatus || item.syncStatus === "") {
					return true;
				}

				return false;
			});

			if (abnormalItems.length > 0) {
				console.info(
					`发现 ${abnormalItems.length} 个异常同步状态项目，正在修复...`,
				);
				await batchUpdateSyncStatus(
					abnormalItems.map((item) => item.id),
					"none",
				);
				console.info(`已修复 ${abnormalItems.length} 个异常同步状态项目`);
			}
		} catch (error) {
			console.error("修复同步状态失败:", error);
		}
	}

	setSyncModeConfig(config: SyncModeConfig): void {
		if (this.syncModeConfig) {
			const configString = JSON.stringify(config);
			const currentConfigString = JSON.stringify(this.syncModeConfig);
			if (configString === currentConfigString) return;
		}

		const previousConfig = this.syncModeConfig;
		this.syncModeConfig = config;
		this.clearCache();
		cloudDataManager.clearCache();

		// 检测是否发生了模式切换（特别是收藏模式的开关）
		const modeChanged = this.hasSyncModeChanged(previousConfig, config);
		if (modeChanged) {
			console.info("🔄 检测到同步模式变更，触发全量同步");
			// 在下一个事件循环中触发全量同步
			setTimeout(() => {
				this.triggerFullSyncAfterModeChange();
			}, 100);
		}
	}

	getDeviceId(): string {
		return this.deviceId;
	}

	/**
	 * 检测同步模式是否发生重要变化
	 * @param previousConfig 之前的配置
	 * @param newConfig 新的配置
	 * @returns 是否发生了重要变化
	 */
	private hasSyncModeChanged(
		previousConfig: SyncModeConfig | null,
		newConfig: SyncModeConfig | null,
	): boolean {
		// 首次初始化不算模式变更
		if (!previousConfig && newConfig) {
			return false;
		}
		if (!previousConfig && !newConfig) {
			return false;
		}
		if (previousConfig && !newConfig) {
			return true; // 配置被清除算变更
		}

		// 到这里两个配置都不为null
		if (!previousConfig || !newConfig) {
			return false; // TypeScript类型保护
		}

		// 检查收藏模式是否发生变化
		const previousFavoritesOnly =
			previousConfig.settings?.onlyFavorites || false;
		const newFavoritesOnly = newConfig.settings?.onlyFavorites || false;

		if (previousFavoritesOnly !== newFavoritesOnly) {
			return true;
		}

		// 检查内容类型设置是否发生变化
		const previousTypes = {
			includeText: previousConfig.settings?.includeText ?? true,
			includeHtml: previousConfig.settings?.includeHtml ?? true,
			includeRtf: previousConfig.settings?.includeRtf ?? true,
			includeImages: previousConfig.settings?.includeImages ?? true,
			includeFiles: previousConfig.settings?.includeFiles ?? true,
		};

		const newTypes = {
			includeText: newConfig.settings?.includeText ?? true,
			includeHtml: newConfig.settings?.includeHtml ?? true,
			includeRtf: newConfig.settings?.includeRtf ?? true,
			includeImages: newConfig.settings?.includeImages ?? true,
			includeFiles: newConfig.settings?.includeFiles ?? true,
		};

		return JSON.stringify(previousTypes) !== JSON.stringify(newTypes);
	}

	/**
	 * 模式变更后触发智能全量同步
	 */
	private async triggerFullSyncAfterModeChange(): Promise<void> {
		if (!this.canSync() || !this.syncModeConfig) return;

		try {
			const { executeSQL, getHistoryData } = await import("@/database");

			// 获取所有本地项目
			const allItems = await getHistoryData(true);

			// 重置已同步项目的状态，确保重新同步验证
			const itemsToReset = allItems.filter(
				(item) => item.syncStatus === "synced",
			);

			if (itemsToReset.length > 0) {
				const itemIds = itemsToReset.map((item) => item.id);
				const placeholders = itemIds.map(() => "?").join(",");

				await executeSQL(
					`UPDATE history SET syncStatus = 'none' WHERE id IN (${placeholders});`,
					itemIds,
				);

				console.info(`🔄 模式变更：重置 ${itemsToReset.length} 个项目状态`);
			}

			// 触发同步事件
			if (syncEventEmitter) {
				syncEventEmitter();
			}
		} catch (error) {
			console.error("🔄 模式变更后全量同步失败:", error);
		}
	}

	/**
	 * 执行完整的双向同步流程
	 * 重新设计：支持多设备不同同步模式的渐进式同步
	 * 1. 筛选本地数据（基于当前模式）
	 * 2. 筛选云端数据（基于当前模式）
	 * 3. 执行模式感知的双向同步
	 * 4. 保留所有云端数据，由各设备自行筛选使用
	 */
	async performBidirectionalSync(): Promise<SyncResult> {
		if (this.syncInProgress) {
			return {
				success: false,
				uploaded: 0,
				downloaded: 0,
				deleted: 0,
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
			deleted: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		console.info("🚀 开始双向同步...");

		try {
			// 1. 获取原始本地数据（包含已删除的项目）
			const localRawData = await getHistoryData(true);

			// 2. 检测本地已删除的项目
			const localDeletedItems = localRawData.filter(
				(item) => item.deleted === true || (item.deleted as any) === 1,
			);

			// 3. 根据同步模式筛选本地数据
			let filteredLocalData = localDataManager.filterLocalDataForSync(
				localRawData,
				this.syncModeConfig,
				{ includeDeleted: false },
			);

			console.info(
				`📊 数据筛选: 本地 ${localRawData.length}→${filteredLocalData.length} 项，删除 ${localDeletedItems.length} 项`,
			);

			// 4. 检查云端数据
			const remoteIndex = await cloudDataManager.downloadSyncIndex();

			// 5. 获取云端筛选数据
			let cloudSyncItems: SyncItem[] = [];

			if (remoteIndex) {
				cloudSyncItems = cloudDataManager.filterCloudDataForSync(
					remoteIndex,
					this.syncModeConfig,
					{ includeDeleted: false },
				);
				// 云端数据筛选结果，调试时可取消注释
				// console.info(`📊 云端数据: ${remoteIndex.items.length}→${cloudSyncItems.length} 项`);
			} else {
				console.info("📊 云端无数据");
			}

			// 6. 处理本地删除的项目：统一删除所有软删除标记的项目
			if (localDeletedItems.length > 0) {
				const deletedItemIds = localDeletedItems.map((item) => item.id);

				// 先删除云端文件（在索引更新之前执行）
				console.info(`准备删除云端文件，项目: ${deletedItemIds.join(", ")}`);
				await fileSyncManager.deleteRemoteFiles(deletedItemIds);

				// 再从云端删除记录和索引
				const cloudDeleteResult =
					await cloudDataManager.deleteCloudItems(deletedItemIds);

				// 检查删除是否真正成功（success是数字，failed也必须为0）
				const deleteSuccess =
					cloudDeleteResult.success > 0 && cloudDeleteResult.failed === 0;

				if (deleteSuccess) {
					result.deleted += cloudDeleteResult.success; // 统计实际删除成功的数量
					console.info(`成功从云端删除 ${cloudDeleteResult.success} 个项目`);

					// 云端删除成功时，清理本地删除标记
					await this.cleanupDeletedItems(deletedItemIds);
				} else {
					// 删除失败时记录详细错误信息
					const errorMsg = `云端删除失败: 成功 ${cloudDeleteResult.success} 个，失败 ${cloudDeleteResult.failed} 个。错误: ${cloudDeleteResult.errors.join(", ")}`;
					result.errors.push(errorMsg);
					console.error(errorMsg);

					// 不要清理本地删除标记，保留删除状态以便下次同步重试
					// 这样可以确保下次同步时会再次尝试删除云端数据
				}
			}

			// 7. 检测收藏状态变更（处理收藏模式下的状态变更同步）
			const favoriteStatusChanges = await this.detectFavoriteStatusChanges(
				localRawData,
				filteredLocalData,
				remoteIndex,
			);

			// 8. 将收藏状态变更的项目加入同步列表
			filteredLocalData.push(...favoriteStatusChanges.localItems);
			cloudSyncItems.push(...favoriteStatusChanges.cloudItems);

			// 9. 最终过滤：确保已删除的项目完全被排除在后续处理之外
			const deletedItemIds = new Set(localDeletedItems.map((item) => item.id));
			filteredLocalData = filteredLocalData.filter(
				(item) => !deletedItemIds.has(item.id),
			);
			cloudSyncItems = cloudSyncItems.filter(
				(item) => !deletedItemIds.has(item.id),
			);

			// 10. 冲突检测与解决（ID相同但内容不同的项目）
			const realConflicts = detectRealConflicts(
				filteredLocalData,
				cloudSyncItems,
			);
			const conflictContexts = realConflicts.map(
				(conflict: {
					localItem: SyncItem;
					remoteItem: SyncItem;
				}) => ({
					localItem: conflict.localItem,
					remoteItem: conflict.remoteItem,
					deviceId: this.deviceId,
					mergePreference: "merge" as const,
				}),
			);

			const conflictResults = syncConflictResolver.resolveMultipleConflicts(
				conflictContexts,
				this.deviceId,
				"merge",
			);

			// 11. 处理同步结果
			const { localResult, cloudResult } = this.processSyncResults(
				filteredLocalData,
				cloudSyncItems,
				conflictResults,
			);

			const hasLocalChanges =
				localResult.itemsToAdd.length > 0 ||
				localResult.itemsToUpdate.length > 0;
			const hasCloudChanges =
				cloudResult.itemsToAdd.length > 0 ||
				cloudResult.itemsToUpdate.length > 0;

			if (hasLocalChanges || hasCloudChanges) {
				// 数据变更详情，调试时可取消注释
				// console.info(`🔄 数据变更: 本地(+${localResult.itemsToAdd.length},*${localResult.itemsToUpdate.length}) 云端(+${cloudResult.itemsToAdd.length},*${cloudResult.itemsToUpdate.length})`);
			}

			// 12. 处理需要上传的文件包
			const fileUploadResult = await fileSyncManager.handleFilePackageUploads(
				localRawData,
				cloudResult,
			);

			// 13. 处理需要下载的文件包（排除已删除项目和文件包类型，避免重复下载）
			const itemsToDownload = [
				...localResult.itemsToAdd,
				...localResult.itemsToUpdate,
			].filter(
				(item) =>
					// 排除已删除的项目
					!item.deleted &&
					// 排除文件类型，避免与文件包处理冲突
					item.type !== "files",
			);

			if (itemsToDownload.length > 0) {
				console.info(
					`准备下载 ${itemsToDownload.length} 个文件包项目:`,
					itemsToDownload.map((item) => ({ id: item.id, type: item.type })),
				);
				await fileSyncManager.handleFilePackageDownloads(itemsToDownload);
			} else {
				console.info("没有需要下载的文件包项目");
			}

			// 14. 应用本地数据变更
			if (
				localResult.itemsToAdd.length > 0 ||
				localResult.itemsToUpdate.length > 0
			) {
				await this.applyLocalChanges(localRawData, localResult);
				result.downloaded =
					localResult.itemsToAdd.length + localResult.itemsToUpdate.length;
			}

			// 15. 应用云端数据变更
			if (
				cloudResult.itemsToAdd.length > 0 ||
				cloudResult.itemsToUpdate.length > 0
			) {
				console.info(
					`📤 云端上传: 新增 ${cloudResult.itemsToAdd.length} 项, 更新 ${cloudResult.itemsToUpdate.length} 项`,
				);

				const uploadSuccess = await this.applyCloudChanges(cloudResult);
				if (uploadSuccess) {
					// 只计算实际需要上传的项目（新增项目 + 真正需要更新的项目）
					const uploadedItemIds = [
						...cloudResult.itemsToAdd.map((item) => item.id),
						...cloudResult.itemsToUpdate.map((item) => item.id),
					];

					// 排除已删除项目ID，避免重复计数
					const deletedItemIds = new Set(
						localDeletedItems.map((item) => item.id),
					);
					const nonDeletedUploadedIds = uploadedItemIds.filter(
						(id) => !deletedItemIds.has(id),
					);

					// 重新检查实际变更项目，避免重复计数
					const actuallyUploadedIds = await this.filterActuallyChangedItems(
						nonDeletedUploadedIds,
						cloudResult,
					);

					result.uploaded = actuallyUploadedIds.length;

					// 上传成功后，直接标记刚上传的项目为已同步
					if (actuallyUploadedIds.length > 0) {
						const { batchUpdateSyncStatus } = await import("@/database");
						console.info(
							`🔄 直接标记上传项目为已同步: ${actuallyUploadedIds.length} 个项目`,
							actuallyUploadedIds,
						);
						await batchUpdateSyncStatus(actuallyUploadedIds, "synced");
					}

					// 对参与本次同步的数据进行状态一致性检查
					await this.syncLocalStatusWithCloud(cloudSyncItems);
				} else {
					console.error("❌ 云端上传失败");
				}
			} else {
				// 即使没有上传项目，也要对参与同步的数据进行状态一致性检查
				await this.syncLocalStatusWithCloud(cloudSyncItems);
			}

			// 16. 添加文件包上传结果（独立于数据上传计数）
			if (fileUploadResult.uploaded > 0) {
				// 文件包上传是额外的操作，已经通过 fileUploadResult.uploaded 统计
				// 不再累加到 result.uploaded 中避免重复计数
			}

			// 17. 同步书签数据
			await this.syncBookmarks();

			// 18. 完成同步和状态更新

			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch (error) {
				console.warn("刷新剪贴板列表失败:", error);
			}

			result.success = true;
			this.lastSyncTime = Date.now();

			if (result.uploaded > 0 || result.downloaded > 0 || result.deleted > 0) {
				console.info(
					`✅ 同步完成: 上传 ${result.uploaded} 项，下载 ${result.downloaded} 项，删除 ${result.deleted} 项`,
				);
			}
		} catch (error) {
			result.errors.push(
				`同步异常: ${error instanceof Error ? error.message : String(error)}`,
			);
			console.error("❌ 同步失败:", error);
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

		// 获取所有冲突项目的ID，避免重复处理
		const conflictItemIds = new Set<string>();
		for (const conflictResult of conflictResults) {
			conflictItemIds.add(conflictResult.resolvedItem.id);
		}

		// 处理本地独有的项目（需要上传到云端）- 排除已解决冲突的项目
		for (const localItem of localSyncItems) {
			// 跳过已经在冲突处理中的项目
			if (conflictItemIds.has(localItem.id)) {
				continue;
			}

			const cloudExists = cloudSyncItems.find(
				(item) => item.id === localItem.id,
			);
			if (!cloudExists) {
				cloudResult.itemsToAdd.push(localItem);
			}
		}

		// 处理云端独有的项目（需要下载到本地）- 排除已解决冲突的项目
		for (const cloudItem of cloudSyncItems) {
			// 跳过已经在冲突处理中的项目
			if (conflictItemIds.has(cloudItem.id)) {
				continue;
			}

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
				// 智能合并策略：只更新真正需要更新的方向
				const localExists = localSyncItems.find(
					(item) => item.id === resolvedItem.id,
				);
				const cloudExists = cloudSyncItems.find(
					(item) => item.id === resolvedItem.id,
				);

				// 检查哪些字段需要更新
				const needsLocalUpdate =
					localExists &&
					(resolvedItem.favorite !== localExists.favorite ||
						resolvedItem.note !== (localExists.note || "") ||
						resolvedItem.value !== (localExists.value || "") ||
						resolvedItem.checksum !== (localExists.checksum || ""));

				const needsCloudUpdate =
					cloudExists &&
					(resolvedItem.favorite !== cloudExists.favorite ||
						resolvedItem.note !== (cloudExists.note || "") ||
						resolvedItem.value !== (cloudExists.value || "") ||
						resolvedItem.checksum !== (cloudExists.checksum || ""));

				// 本地更新：只有当本地存在且确实需要更新时
				if (localExists && needsLocalUpdate) {
					if (
						!localResult.itemsToUpdate.some(
							(item) => item.id === resolvedItem.id,
						)
					) {
						localResult.itemsToUpdate.push(resolvedItem);
					}
				} else if (!localExists) {
					// 本地不存在，需要添加
					if (
						!localResult.itemsToAdd.some((item) => item.id === resolvedItem.id)
					) {
						localResult.itemsToAdd.push(resolvedItem);
					}
				}

				// 云端更新：只有当云端存在且确实需要更新时
				if (cloudExists && needsCloudUpdate) {
					if (
						!cloudResult.itemsToUpdate.some(
							(item) => item.id === resolvedItem.id,
						)
					) {
						cloudResult.itemsToUpdate.push(resolvedItem);
					}
				} else if (!cloudExists) {
					// 云端不存在，需要添加
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
	 * 检测收藏状态变更（处理收藏模式下的状态变更同步）
	 * @param localRawData 本地原始数据
	 * @param localSyncItems 筛选后的本地同步项
	 * @param remoteIndex 云端索引
	 * @returns 收藏状态变更的项目
	 */
	private async detectFavoriteStatusChanges(
		localRawData: any[],
		localSyncItems: SyncItem[],
		remoteIndex: any,
	): Promise<{ localItems: SyncItem[]; cloudItems: SyncItem[] }> {
		const result = { localItems: [], cloudItems: [] } as {
			localItems: SyncItem[];
			cloudItems: SyncItem[];
		};

		// 如果没有开启收藏模式，不需要检测
		if (!this.syncModeConfig?.settings?.onlyFavorites || !remoteIndex?.items) {
			return result;
		}

		// 获取云端所有符合类型条件的数据（不应用收藏过滤）
		const allCloudItems = cloudDataManager.filterCloudDataForSync(
			remoteIndex,
			{
				...this.syncModeConfig,
				settings: { ...this.syncModeConfig.settings, onlyFavorites: false },
			},
			{ includeDeleted: false },
		);

		// 创建本地同步项ID映射
		const localSyncItemIds = new Set(localSyncItems.map((item) => item.id));

		// 遍历云端数据，找出被收藏模式过滤掉的本地项目
		for (const cloudItem of allCloudItems) {
			// 如果云端项目不在本地筛选列表中，可能是因为收藏状态变更
			if (!localSyncItemIds.has(cloudItem.id)) {
				// 在本地原始数据中查找该项目
				const localOriginalItem = localRawData.find(
					(item) => item.id === cloudItem.id,
				);

				if (localOriginalItem) {
					// 排除已删除的项目，避免重复计数
					if (
						localOriginalItem.deleted === true ||
						(localOriginalItem.deleted as any) === 1
					) {
						continue;
					}

					// 本地存在该项目但被过滤掉，检查收藏状态是否发生变化
					if (localOriginalItem.favorite !== cloudItem.favorite) {
						// 收藏状态发生变化，加入同步列表
						const localSyncItem = localDataManager.filterLocalDataForSync(
							[localOriginalItem],
							{
								...this.syncModeConfig,
								settings: {
									...this.syncModeConfig.settings,
									onlyFavorites: false,
								},
							},
							{ includeDeleted: false },
						)[0];

						if (localSyncItem) {
							result.localItems.push(localSyncItem);
							result.cloudItems.push(cloudItem);
						}
					}
				}
			}
		}

		return result;
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

	/**
	 * 标记项目为已删除（使用统一的删除管理器）
	 * @param itemId 项目ID
	 * @returns 操作是否成功
	 */
	async markItemAsDeleted(itemId: string): Promise<boolean> {
		return await deleteManager.markItemAsDeleted(itemId);
	}

	/**
	 * 过滤真正发生变更的项目，避免重复计数
	 * @param itemIds 要检查的项目ID列表
	 * @param cloudResult 云端同步结果
	 * @returns 真正需要上传的项目ID列表
	 */
	private async filterActuallyChangedItems(
		itemIds: string[],
		cloudResult: {
			itemsToAdd: SyncItem[];
			itemsToUpdate: SyncItem[];
			itemsToDelete: string[];
		},
	): Promise<string[]> {
		if (itemIds.length === 0) {
			console.info("🔍 filterActuallyChangedItems: 没有项目需要检查");
			return [];
		}

		try {
			const { getHistoryData } = await import("@/database");
			const localData = await getHistoryData(true);

			const actuallyChangedIds: string[] = [];

			for (const itemId of itemIds) {
				// 检查是否为新增项目
				const isAddItem = cloudResult.itemsToAdd.some(
					(item) => item.id === itemId,
				);
				if (isAddItem) {
					actuallyChangedIds.push(itemId);
					continue;
				}

				// 检查是否为更新项目
				const updateItem = cloudResult.itemsToUpdate.find(
					(item) => item.id === itemId,
				);
				if (updateItem) {
					const localItem = localData.find((item) => item.id === itemId);
					if (localItem) {
						const hasChanges = this.hasItemActuallyChanged(
							localItem,
							updateItem,
						);
						if (hasChanges) {
							actuallyChangedIds.push(itemId);
						}
					}
				}
			}

			return actuallyChangedIds;
		} catch (error) {
			console.error("❌ 过滤实际变更项目失败:", error);
			return itemIds;
		}
	}

	/**
	 * 严格检查本地项目是否真的与云端项目匹配
	 * 防止重新安装后本地新项目被错误标记为已同步
	 * @param localItem 本地项目
	 * @param cloudItem 云端项目
	 * @returns 是否真的匹配
	 */
	private isItemActuallySynced(localItem: any, cloudItem: SyncItem): boolean {
		// 基础字段匹配检查
		if (localItem.type !== cloudItem.type) return false;
		if (localItem.favorite !== cloudItem.favorite) return false;
		if ((localItem.note || "") !== (cloudItem.note || "")) return false;

		// 内容匹配检查（使用校验和）
		const localChecksum = localItem.checksum || "";
		const cloudChecksum = cloudItem.checksum || "";

		if (localChecksum && cloudChecksum) {
			// 如果双方都有校验和，优先使用校验和比较
			return localChecksum === cloudChecksum;
		}

		// 如果没有校验和，使用内容比较
		const localValue = localItem.value || "";
		const cloudValue = cloudItem.value || "";

		// 对于长内容，只比较前 1000 字符以提高性能
		if (localValue.length > 1000 || cloudValue.length > 1000) {
			return localValue.substring(0, 1000) === cloudValue.substring(0, 1000);
		}

		return localValue === cloudValue;
	}

	/**
	 * 检查项目是否真的发生了变化
	 * @param localItem 本地项目
	 * @param cloudItem 云端项目
	 * @returns 是否发生了变化
	 */
	private hasItemActuallyChanged(localItem: any, cloudItem: SyncItem): boolean {
		// 检查关键字段是否发生变化
		if (localItem.favorite !== cloudItem.favorite) return true;
		if ((localItem.note || "") !== (cloudItem.note || "")) return true;
		if ((localItem.value || "") !== (cloudItem.value || "")) return true;
		if ((localItem.checksum || "") !== (cloudItem.checksum || "")) return true;

		return false;
	}

	/**
	 * 同步本地状态与云端存在性保持一致
	 * 确保云端存在且匹配的本地项目状态正确
	 * @param cloudSyncItems 参与同步的云端项目列表（已根据同步模式筛选）
	 */
	private async syncLocalStatusWithCloud(
		cloudSyncItems: SyncItem[],
	): Promise<void> {
		if (cloudSyncItems.length === 0) return;

		try {
			const { batchUpdateSyncStatus, getHistoryData } = await import(
				"@/database"
			);
			const mismatchedItems: Array<{ id: string; localStatus: string }> = [];

			// 获取最新的本地数据（未经过滤）
			const allLocalItems = await getHistoryData(true);

			for (const cloudItem of cloudSyncItems) {
				const localItem = allLocalItems.find(
					(item: any) => item.id === cloudItem.id,
				);

				if (localItem && !localItem.deleted) {
					const localStatus = localItem.syncStatus || "none";
					const isActuallySynced = this.isItemActuallySynced(
						localItem,
						cloudItem,
					);

					// 状态不匹配且项目实际已同步，需要更新状态
					if (isActuallySynced && localStatus !== "synced") {
						mismatchedItems.push({ id: cloudItem.id, localStatus });
					}
				}
			}

			// 批量更新状态不匹配的项目
			if (mismatchedItems.length > 0) {
				const itemsToSync = mismatchedItems.map((item) => item.id);
				console.info(
					`🔄 状态更新: ${mismatchedItems.length} 个项目标记为已同步`,
				);
				await batchUpdateSyncStatus(itemsToSync, "synced");
			}
		} catch (error) {
			console.error("❌ 状态同步失败:", error);
		}
	}

	/**
	 * 清理本地数据库中已删除的项目（使用统一的删除管理器）
	 * 只删除数据库记录，不影响用户的原始文件
	 */
	private async cleanupDeletedItems(deletedItemIds: string[]): Promise<void> {
		if (deletedItemIds.length === 0) {
			return;
		}

		try {
			const result = await deleteManager.cleanupDeletedItems(deletedItemIds);
			if (result.success) {
				console.info(`已清理 ${result.deletedCount} 个本地删除项目`);
			} else {
				console.error("清理本地删除项目失败:", result.errors);
			}
		} catch (error) {
			console.error("清理本地删除项目失败:", error);
		}
	}

	/**
	 * 同步书签数据
	 */
	private async syncBookmarks(): Promise<void> {
		try {
			// 获取当前云端数据
			const cloudData = await cloudDataManager.downloadSyncData();

			// 执行书签同步（即使本地没有书签也要执行，因为可能需要从云端下载或清理云端数据）
			const syncResult = await bookmarkSync.syncBookmarks(
				cloudData,
				this.deviceId,
			);

			if (syncResult.error) {
				console.error("书签同步失败:", syncResult.error);
				return;
			}

			// 如果需要上传书签到云端
			if (syncResult.needUpload && syncResult.mergedData) {
				const uploadSuccess = await cloudDataManager.uploadSyncData(
					syncResult.mergedData,
				);
				if (uploadSuccess) {
					// 清除云端数据缓存，确保下次同步获取最新数据
					cloudDataManager.clearCache();
				} else {
					console.error("书签数据上传到云端失败");
				}
			}
		} catch (error) {
			console.error("书签同步异常:", error);
		}
	}
}

export const syncEngine = new SyncEngine();
