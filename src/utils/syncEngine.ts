import { LISTEN_KEY } from "@/constants";
import { getHistoryData } from "@/database";
import type { WebDAVConfig } from "@/plugins/webdav";
import type { SyncItem, SyncModeConfig, SyncResult } from "@/types/sync";
import { generateDeviceId } from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
import { bookmarkSync } from "./bookmarkSync";
import { cloudDataManager } from "./cloudDataManager";
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

		// 执行数据完整性检查，特别是针对覆盖安装后的状态问题
		try {
			console.info("🔍 正在执行同步前的数据完整性检查...");
			const integrityCheck = await this.performDataIntegrityCheck();

			if (integrityCheck.fixed > 0) {
				console.info(
					`✅ 数据完整性检查完成，修复了 ${integrityCheck.fixed} 个问题`,
				);
				// 触发UI刷新
				syncEventEmitter?.();
			}

			if (integrityCheck.errors.length > 0) {
				console.warn("⚠️ 数据完整性检查发现问题:", integrityCheck.errors);
			}
		} catch (error) {
			console.error("❌ 数据完整性检查失败:", error);
		}

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
	 * 优化的统一流程设计：
	 * 1. 根据文件模式筛选和过滤数据
	 * 2. 同步数据（不包含文件内容）
	 * 3. 按需处理文件包上传和下载
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

		try {
			// 1. 获取原始本地数据（包含已删除的项目）
			const localRawData = await getHistoryData(true);

			// 2. 检测本地已删除的项目（软删除标记）
			const localDeletedItems = localRawData.filter(
				(item) => item.deleted === true || (item.deleted as any) === 1,
			);

			// 3. localDataManager 根据同步模式和文件限制筛选本地数据（不包括已删除的）
			let filteredLocalData = localDataManager.filterLocalDataForSync(
				localRawData,
				this.syncModeConfig,
				{ includeDeleted: false },
			);

			// 4. cloudDataManager 检查云端是否有数据
			const remoteIndex = await cloudDataManager.downloadSyncIndex();

			// 5. cloudDataManager 筛选出云端符合条件的数据（不包括已删除的）
			let cloudSyncItems: SyncItem[] = [];
			if (remoteIndex) {
				cloudSyncItems = cloudDataManager.filterCloudDataForSync(
					remoteIndex,
					this.syncModeConfig,
					{ includeDeleted: false },
				);
			}

			// 6. 处理本地删除的项目：从云端删除对应记录和文件
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

					// 只有云端删除成功时，才清理本地删除标记
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

			// 10. 只处理真正有冲突的项目（ID相同但内容不同）
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

			// 10. 处理同步结果
			const { localResult, cloudResult } = this.processSyncResults(
				filteredLocalData,
				cloudSyncItems,
				conflictResults,
			);

			// 11. 处理需要上传的文件包
			const fileUploadResult = await fileSyncManager.handleFilePackageUploads(
				localRawData,
				cloudResult,
			);

			// 12. 处理需要下载的文件包（排除已删除项目和文件包类型，避免重复下载）
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

			// 13. localDataManager 接收处理后的本地数据，对本地数据库进行操作
			if (
				localResult.itemsToAdd.length > 0 ||
				localResult.itemsToUpdate.length > 0
			) {
				await this.applyLocalChanges(localRawData, localResult);
				result.downloaded =
					localResult.itemsToAdd.length + localResult.itemsToUpdate.length;
			}

			// 14. cloudDataManager 接收处理后的云端数据，对云端数据进行操作
			if (
				cloudResult.itemsToAdd.length > 0 ||
				cloudResult.itemsToUpdate.length > 0
			) {
				const uploadSuccess = await this.applyCloudChanges(cloudResult);
				if (uploadSuccess) {
					// 只计算数据上传，排除已删除项目避免重复计数
					const uploadedItemIds = [
						...cloudResult.itemsToAdd.map((item) => item.id),
						...cloudResult.itemsToUpdate.map((item) => item.id),
					];

					// 排除已删除的项目ID，避免重复计数
					const deletedItemIds = new Set(
						localDeletedItems.map((item) => item.id),
					);
					const nonDeletedUploadedIds = uploadedItemIds.filter(
						(id) => !deletedItemIds.has(id),
					);

					result.uploaded = nonDeletedUploadedIds.length;

					// 上传成功后，更新本地项目的同步状态为"已同步"
					await this.markItemsAsSynced(uploadedItemIds);
				}
			}

			// 13. 添加文件包上传结果（独立于数据上传计数）
			if (fileUploadResult.uploaded > 0) {
				// 文件包上传是额外的操作，已经通过 fileUploadResult.uploaded 统计
				// 不再累加到 result.uploaded 中避免重复计数
			}

			// 14. 同步书签数据
			await this.syncBookmarks();

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

	/**
	 * 标记项目为已同步状态
	 * @param itemIds 要标记的项目ID列表
	 */
	private async markItemsAsSynced(itemIds: string[]): Promise<void> {
		if (itemIds.length === 0) {
			return;
		}

		try {
			const { batchUpdateSyncStatus } = await import("@/database");

			const success = await batchUpdateSyncStatus(itemIds, "synced");
			if (success) {
				console.info(`已标记 ${itemIds.length} 个项目为已同步状态`);
			}
		} catch (error) {
			console.error("标记已同步状态失败:", error);
		}
	}

	/**
	 * 清理本地数据库中已删除的项目
	 * 只删除数据库记录，不影响用户的原始文件
	 */
	private async cleanupDeletedItems(deletedItemIds: string[]): Promise<void> {
		if (deletedItemIds.length === 0) {
			return;
		}

		try {
			const { executeSQL } = await import("@/database");

			// 批量删除数据库记录（彻底删除，不是软删除）
			const deletePromises = deletedItemIds.map(async (itemId) => {
				try {
					await executeSQL("DELETE FROM history WHERE id = ?;", [itemId]);
				} catch (error) {
					console.error(`删除数据库记录失败 (${itemId}):`, error);
				}
			});

			await Promise.allSettled(deletePromises);
			console.info(`已清理 ${deletedItemIds.length} 个本地删除项目`);
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

	/**
	 * 执行数据完整性检查
	 * 专门用于检测和修复覆盖安装后可能出现的同步状态不一致问题
	 */
	private async performDataIntegrityCheck(): Promise<{
		fixed: number;
		errors: string[];
	}> {
		const result = {
			fixed: 0,
			errors: [] as string[],
		};

		try {
			// 导入数据库模块
			const { checkAndFixSyncStatusConsistency } = await import("@/database");

			// 1. 执行同步状态一致性检查
			const consistencyResult = await checkAndFixSyncStatusConsistency();
			result.fixed += consistencyResult.fixed;
			result.errors.push(...consistencyResult.errors);

			// 2. 如果有云端连接，检查云端与本地数据的一致性
			if (this.isOnline && this.webdavConfig) {
				try {
					const remoteIndex = await cloudDataManager.downloadSyncIndex();

					if (remoteIndex) {
						const { getHistoryData } = await import("@/database");
						const localData = await getHistoryData(false);

						// 查找本地标记为已同步但云端不存在的条目
						const localSyncedIds = new Set(
							localData
								.filter((item) => item.syncStatus === "synced")
								.map((item) => item.id),
						);

						const cloudIds = new Set(remoteIndex.items.map((item) => item.id));

						const inconsistentIds = Array.from(localSyncedIds).filter(
							(id) => !cloudIds.has(id),
						);

						if (inconsistentIds.length > 0) {
							console.warn(
								`发现 ${inconsistentIds.length} 个本地已同步但云端不存在的条目`,
							);

							// 修复这些条目：将状态重置为none
							const { batchUpdateSyncStatus } = await import("@/database");
							await batchUpdateSyncStatus(inconsistentIds, "none", false);
							result.fixed += inconsistentIds.length;
						}
					}
				} catch (cloudError) {
					const errorMessage = `云端数据一致性检查失败: ${cloudError instanceof Error ? cloudError.message : String(cloudError)}`;
					console.warn(errorMessage);
					result.errors.push(errorMessage);
				}
			}
		} catch (error) {
			const errorMessage = `数据完整性检查执行失败: ${error instanceof Error ? error.message : String(error)}`;
			console.error(errorMessage);
			result.errors.push(errorMessage);
		}

		return result;
	}
}

export const syncEngine = new SyncEngine();
