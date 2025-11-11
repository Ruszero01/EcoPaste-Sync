import type {
	CloudItemFingerprint,
	CloudSyncIndex,
	HistoryItem,
	SyncItem,
	SyncModeConfig,
} from "@/types/sync";

/**
 * 同步冲突解决器
 *
 * 职责：
 * - 接收和处理本地与云端筛选后数据的实际冲突
 * - 提供多种冲突解决策略（本地优先、远程优先、智能合并）
 * - 检测需要用户干预的复杂冲突
 * - 生成冲突解决报告
 * - 处理本地与云端数据合并策略
 *
 * 注意：此模块处理的是经过 localDataManager 和 cloudDataManager
 * 筛选后的实际数据冲突和合并，而不是数据筛选逻辑
 */

// 简单的合并函数
function mergeItems(
	localItem: SyncItem,
	remoteItem: SyncItem,
	_deviceId: string,
): SyncItem {
	// 使用最新修改时间的项
	return localItem.lastModified &&
		localItem.lastModified > (remoteItem.lastModified || 0)
		? localItem
		: remoteItem;
}

export interface ConflictResolutionContext {
	localItem: SyncItem;
	remoteItem: SyncItem;
	deviceId: string;
	mergePreference?: "local" | "remote" | "merge";
}

export interface ConflictResolutionResult {
	resolvedItem: SyncItem;
	strategy: "local" | "remote" | "merge";
	requiresUserChoice?: boolean;
	conflictReason?: string;
}

/**
 * 同步冲突解决器
 * 负责处理本地和云端数据冲突的检测和解决
 */
export class SyncConflictResolver {
	/**
	 * 解决单个冲突项
	 */
	resolveConflict(
		context: ConflictResolutionContext,
	): ConflictResolutionResult {
		const {
			localItem,
			remoteItem,
			deviceId,
			mergePreference = "merge",
		} = context;

		// 检查是否真的有冲突
		const conflictAnalysis = this.analyzeConflict(localItem, remoteItem);
		if (!conflictAnalysis.hasConflict) {
			return {
				resolvedItem:
					localItem.lastModified &&
					localItem.lastModified > remoteItem.lastModified
						? localItem
						: remoteItem,
				strategy: "local",
			};
		}

		// 根据合并偏好解决冲突
		switch (mergePreference) {
			case "local":
				return {
					resolvedItem: this.resolveWithLocal(
						localItem,
						remoteItem,
						conflictAnalysis,
					),
					strategy: "local",
					conflictReason: conflictAnalysis.reason,
				};

			case "remote":
				return {
					resolvedItem: this.resolveWithRemote(
						localItem,
						remoteItem,
						conflictAnalysis,
					),
					strategy: "remote",
					conflictReason: conflictAnalysis.reason,
				};

			default:
				return {
					resolvedItem: this.mergeConflictItems(
						localItem,
						remoteItem,
						deviceId,
						conflictAnalysis,
					),
					strategy: "merge",
					conflictReason: conflictAnalysis.reason,
				};
		}
	}

	/**
	 * 批量解决冲突
	 */
	resolveMultipleConflicts(
		conflicts: ConflictResolutionContext[],
		deviceId: string,
		mergePreference?: "local" | "remote" | "merge",
	): ConflictResolutionResult[] {
		return conflicts.map((context) =>
			this.resolveConflict({
				...context,
				deviceId: context.deviceId || deviceId,
				mergePreference: mergePreference || context.mergePreference,
			}),
		);
	}

	/**
	 * 分析冲突详情
	 */
	private analyzeConflict(
		localItem: SyncItem,
		remoteItem: SyncItem,
	): {
		hasConflict: boolean;
		reason: string;
		conflictType: "content" | "favorite" | "metadata" | "timestamp";
	} {
		// 检查内容冲突
		const localContent =
			typeof localItem.value === "string"
				? localItem.value
				: JSON.stringify(localItem.value);
		const remoteContent =
			typeof remoteItem.value === "string"
				? remoteItem.value
				: JSON.stringify(remoteItem.value);

		if (localContent !== remoteContent) {
			return {
				hasConflict: true,
				reason: "内容不同",
				conflictType: "content",
			};
		}

		// 检查收藏状态冲突
		if (!!localItem.favorite !== !!remoteItem.favorite) {
			return {
				hasConflict: true,
				reason: "收藏状态不同",
				conflictType: "favorite",
			};
		}

		// 检查注释冲突
		const localNote = localItem.note || "";
		const remoteNote = remoteItem.note || "";
		if (localNote !== remoteNote) {
			return {
				hasConflict: true,
				reason: "注释不同",
				conflictType: "metadata",
			};
		}

		// 检查时间戳冲突（相同内容但时间戳不同）
		if (localItem.lastModified !== remoteItem.lastModified) {
			return {
				hasConflict: true,
				reason: "时间戳不同",
				conflictType: "timestamp",
			};
		}

		return {
			hasConflict: false,
			reason: "无冲突",
			conflictType: "content",
		};
	}

	/**
	 * 以本地为准解决冲突
	 */
	private resolveWithLocal(
		localItem: SyncItem,
		remoteItem: SyncItem,
		_conflictAnalysis: {
			hasConflict: boolean;
			reason: string;
			conflictType: string;
		},
	): SyncItem {
		const resolved = { ...localItem };

		// 保留远程的有用元数据
		if (
			remoteItem.lastModified &&
			(!localItem.lastModified ||
				remoteItem.lastModified > localItem.lastModified)
		) {
			resolved.lastModified = remoteItem.lastModified;
		}

		// 如果本地没有注释但远程有，保留远程注释
		if (!localItem.note && remoteItem.note) {
			resolved.note = remoteItem.note;
		}

		return resolved;
	}

	/**
	 * 以远程为准解决冲突
	 */
	private resolveWithRemote(
		localItem: SyncItem,
		remoteItem: SyncItem,
		_conflictAnalysis: {
			hasConflict: boolean;
			reason: string;
			conflictType: string;
		},
	): SyncItem {
		const resolved = { ...remoteItem };

		// 保留本地的有用元数据
		if (
			localItem.createTime &&
			(!remoteItem.createTime || localItem.createTime < remoteItem.createTime)
		) {
			resolved.createTime = localItem.createTime;
		}

		// 如果远程没有注释但本地有，保留本地注释
		if (!remoteItem.note && localItem.note) {
			resolved.note = localItem.note;
		}

		return resolved;
	}

	/**
	 * 合并冲突项
	 */
	private mergeConflictItems(
		localItem: SyncItem,
		remoteItem: SyncItem,
		deviceId: string,
		_conflictAnalysis: {
			hasConflict: boolean;
			reason: string;
			conflictType: string;
		},
	): SyncItem {
		// 使用现有的 mergeItems 函数
		const merged = mergeItems(localItem, remoteItem, deviceId);

		// 添加冲突解决标记
		return {
			...merged,
			note: merged.note ? `${merged.note} [自动合并冲突]` : "[自动合并冲突]",
		};
	}

	/**
	 * 检测需要用户干预的复杂冲突
	 */
	detectComplexConflicts(
		conflicts: ConflictResolutionContext[],
	): ConflictResolutionContext[] {
		return conflicts.filter((context) => {
			const analysis = this.analyzeConflict(
				context.localItem,
				context.remoteItem,
			);

			// 内容冲突且都有重要修改的视为复杂冲突
			if (analysis.conflictType === "content") {
				const localTime = context.localItem.lastModified || 0;
				const remoteTime = context.remoteItem.lastModified || 0;
				const timeDiff = Math.abs(localTime - remoteTime);

				// 如果时间差很小（几分钟内），可能是同时编辑，需要用户干预
				return timeDiff < 5 * 60 * 1000; // 5分钟
			}

			return false;
		});
	}

	/**
	 * 生成冲突解决报告
	 */
	generateConflictReport(results: ConflictResolutionResult[]): {
		total: number;
		byStrategy: Record<string, number>;
		complexConflicts: number;
		resolved: number;
	} {
		const report = {
			total: results.length,
			byStrategy: {} as Record<string, number>,
			complexConflicts: 0,
			resolved: 0,
		};

		for (const result of results) {
			// 统计解决策略
			report.byStrategy[result.strategy] =
				(report.byStrategy[result.strategy] || 0) + 1;

			// 统计复杂冲突
			if (result.requiresUserChoice) {
				report.complexConflicts++;
			}

			// 统计已解决的冲突
			if (result.resolvedItem) {
				report.resolved++;
			}
		}

		return report;
	}
}

// ================================
// 数据合并策略
// ================================

/**
 * 智能数据合并策略
 * 合并本地和远程数据，处理删除状态和冲突
 * 注意：此函数处理冲突解决后的数据合并，不包括冲突检测
 * @param localItems 本地数据
 * @param remoteItems 远程数据
 * @param options 合并选项
 * @returns 合并结果
 */
export const mergeLocalAndRemoteData = <T extends HistoryItem>(
	localItems: T[],
	remoteItems: T[],
	options: {
		localDeletionPriority?: boolean; // 本地删除优先，默认为true
		mergeMetadata?: boolean; // 是否合并元数据，默认为true
		conflictResolution?: "local" | "remote" | "merge"; // 冲突解决策略
	} = {},
): {
	mergedItems: T[];
	itemsToDelete: string[];
	conflicts: Array<{
		itemId: string;
		localItem: T;
		remoteItem: T;
		reason: string;
	}>;
} => {
	const {
		localDeletionPriority = true,
		mergeMetadata = true,
		conflictResolution = "merge",
	} = options;

	const conflicts: Array<{
		itemId: string;
		localItem: T;
		remoteItem: T;
		reason: string;
	}> = [];

	const remoteMap = new Map(remoteItems.map((item) => [item.id, item]));
	const mergedItems: T[] = [];
	const itemsToDelete: string[] = [];
	const processedIds = new Set<string>();

	// 1. 处理本地数据
	for (const localItem of localItems) {
		const remoteItem = remoteMap.get(localItem.id);
		processedIds.add(localItem.id);

		if (!remoteItem) {
			// 仅本地存在
			if (
				localDeletionPriority &&
				(localItem.deleted || (localItem.deleted as any) === 1)
			) {
				itemsToDelete.push(localItem.id);
			} else {
				mergedItems.push(localItem);
			}
		} else {
			// 两端都存在
			if (
				localDeletionPriority &&
				(localItem.deleted || (localItem.deleted as any) === 1)
			) {
				// 本地删除优先：需要从云端删除
				itemsToDelete.push(localItem.id);
			} else {
				// 检测冲突
				const hasContentConflict = localItem.value !== remoteItem.value;
				const hasFavoriteConflict = localItem.favorite !== remoteItem.favorite;
				const hasNoteConflict =
					(localItem.note || "") !== (remoteItem.note || "");

				if (hasContentConflict || hasFavoriteConflict || hasNoteConflict) {
					conflicts.push({
						itemId: localItem.id,
						localItem,
						remoteItem,
						reason: hasContentConflict
							? "内容冲突"
							: hasFavoriteConflict
								? "收藏状态冲突"
								: "备注冲突",
					});

					// 根据冲突解决策略处理
					let resolvedItem: T;

					switch (conflictResolution) {
						case "local":
							resolvedItem = localItem;
							break;
						case "remote":
							resolvedItem = remoteItem;
							break;
						default:
							// merge case (以及其他未定义的情况)
							if (mergeMetadata) {
								// 智能合并元数据
								resolvedItem = {
									...remoteItem,
									// 保留较新的修改时间
									lastModified:
										(localItem.lastModified || 0) >
										(remoteItem.lastModified || 0)
											? localItem.lastModified
											: remoteItem.lastModified,
									// 合并收藏状态：任一端收藏则为收藏
									favorite: localItem.favorite || remoteItem.favorite,
									// 合并备注：优先非空的备注
									note: localItem.note?.trim() || remoteItem.note?.trim() || "",
									// 保留最大的使用次数
									count: Math.max(localItem.count || 0, remoteItem.count || 0),
								} as T;
							} else {
								// 选择较新的版本
								resolvedItem =
									(localItem.lastModified || 0) > (remoteItem.lastModified || 0)
										? localItem
										: remoteItem;
							}
							break;
					}

					mergedItems.push(resolvedItem);
				} else {
					// 无冲突：选择较新的版本
					const newerItem =
						(localItem.lastModified || 0) > (remoteItem.lastModified || 0)
							? localItem
							: remoteItem;
					mergedItems.push(newerItem);
				}
			}
		}
	}

	// 2. 添加仅云端存在的项目
	for (const remoteItem of remoteItems) {
		if (!processedIds.has(remoteItem.id)) {
			// 云端独有数据：直接添加（云端不存在删除概念，删除标记仅在本地有效）
			mergedItems.push(remoteItem);
		}
	}

	return {
		mergedItems,
		itemsToDelete,
		conflicts,
	};
};

// ================================
// 差异检测器
// ================================

export interface SyncDiffResult {
	added: SyncItem[];
	modified: SyncItem[];
	favoriteChanged: SyncItem[];
	deleted: string[];
	toDownload: CloudItemFingerprint[];
	unchanged: string[];
	statistics: {
		totalLocal: number;
		totalRemote: number;
		conflicts: number;
	};
}

/**
 * 同步差异检测器
 * 职责：集中处理本地和云端数据的差异检测
 */
export class SyncDiffDetector {
	/**
	 * 检测本地和云端数据的差异
	 * @param localItems 本地数据
	 * @param remoteIndex 云端索引
	 * @param deletedItemIds 需要删除的项目ID
	 * @returns 差异检测结果
	 */
	detectSyncDifferences(
		localItems: SyncItem[],
		remoteIndex: CloudSyncIndex | null,
		deletedItemIds: string[] = [],
	): SyncDiffResult {
		if (!remoteIndex) {
			// 无远程数据时，所有本地项目都需要添加
			return {
				added: localItems,
				modified: [],
				favoriteChanged: [],
				deleted: deletedItemIds,
				toDownload: [],
				unchanged: [],
				statistics: {
					totalLocal: localItems.length,
					totalRemote: 0,
					conflicts: 0,
				},
			};
		}

		// 使用优化的差异检测算法
		return this.detectDifferencesOptimized(
			localItems,
			remoteIndex,
			deletedItemIds,
		);
	}

	/**
	 * 优化的差异检测算法（单次遍历）
	 */
	private detectDifferencesOptimized(
		localItems: SyncItem[],
		remoteIndex: CloudSyncIndex,
		deletedItemIds: string[],
	): SyncDiffResult {
		const deletedSet = new Set(deletedItemIds);
		const remoteMap = new Map(remoteIndex.items.map((item) => [item.id, item]));

		const result: SyncDiffResult = {
			added: [],
			modified: [],
			favoriteChanged: [],
			deleted: deletedItemIds,
			toDownload: [],
			unchanged: [],
			statistics: {
				totalLocal: localItems.length,
				totalRemote: remoteIndex.items.length,
				conflicts: 0,
			},
		};

		// 处理本地项目
		for (const localItem of localItems) {
			if (deletedSet.has(localItem.id)) continue;

			const remoteFp = remoteMap.get(localItem.id);

			if (!remoteFp) {
				// 仅本地存在：需要添加
				result.added.push(localItem);
			} else {
				// 两端都存在：检测差异
				const contentChanged = localItem.checksum !== remoteFp.checksum;
				const favoriteChanged = localItem.favorite !== remoteFp.favorite;

				if (contentChanged && favoriteChanged) {
					result.modified.push(localItem);
				} else if (contentChanged) {
					result.modified.push(localItem);
				} else if (favoriteChanged) {
					result.favoriteChanged.push(localItem);
				} else {
					result.unchanged.push(localItem.id);
				}

				// 从远程 Map 中移除已处理的项
				remoteMap.delete(localItem.id);
			}
		}

		// 处理仅远程存在的项目
		for (const [id, remoteFp] of remoteMap) {
			if (remoteFp.deleted) continue;

			// 检查是否需要下载（时间戳更新或内容不同）
			const localFp = localItems.find((item) => item.id === id);
			if (!localFp || this.needsDownload(localFp, remoteFp)) {
				result.toDownload.push(remoteFp);
			}
		}

		return result;
	}

	/**
	 * 判断是否需要下载
	 */
	private needsDownload(
		localItem: SyncItem | undefined,
		remoteFp: CloudItemFingerprint,
	): boolean {
		if (remoteFp.deleted) return false;

		if (!localItem) {
			return true; // 本地不存在，需要下载
		}

		return (
			remoteFp.timestamp > (localItem.lastModified || 0) &&
			remoteFp.checksum !== localItem.checksum
		);
	}
}

// ================================
// 统一同步流程协调器
// ================================

export interface SyncOperationResult {
	local: {
		itemsToAdd: SyncItem[];
		itemsToUpdate: SyncItem[];
		itemsToDelete: string[];
	};
	cloud: {
		itemsToAdd: SyncItem[];
		itemsToUpdate: SyncItem[];
		itemsToDelete: string[];
	};
	statistics: {
		totalConflicts: number;
		resolvedConflicts: number;
	};
}

/**
 * 统一同步流程协调器
 * 职责：
 * 1. 协调本地和云端数据的筛选
 * 2. 调用差异检测器发现差异
 * 3. 调用冲突解决器处理冲突
 * 4. 生成本地和云端各自需要处理的最终数据
 */
export class SyncFlowCoordinator {
	private diffDetector: SyncDiffDetector;
	private conflictResolver: SyncConflictResolver;

	constructor() {
		this.diffDetector = new SyncDiffDetector();
		this.conflictResolver = new SyncConflictResolver();
	}

	/**
	 * 执行完整的同步流程
	 * @param originalLocalData 原始本地数据
	 * @param remoteIndex 云端索引
	 * @param syncConfig 同步模式配置
	 * @param deviceId 当前设备ID
	 * @returns 同步操作结果
	 */
	executeSyncFlow(
		originalLocalData: HistoryItem[],
		remoteIndex: CloudSyncIndex | null,
		syncConfig: SyncModeConfig | null,
		deviceId: string,
	): SyncOperationResult {
		// 1. 获取需要删除的本地项目
		const localDeletedItems = originalLocalData
			.filter((item) => item.deleted === true || (item.deleted as any) === 1)
			.map((item) => item.id);

		// 2. 将原始本地数据转换为 SyncItem 格式
		const allLocalSyncItems = this.convertToSyncItems(originalLocalData);

		// 3. 根据同步模式筛选本地数据
		const localItemsForSync = this.filterLocalItemsBySyncMode(
			allLocalSyncItems,
			syncConfig,
		);

		// 4. 根据同步模式筛选云端数据
		const cloudItemsForSync = this.filterCloudItemsBySyncMode(
			remoteIndex,
			syncConfig,
		);

		// 5. 检测差异
		const diffResult = this.diffDetector.detectSyncDifferences(
			localItemsForSync,
			remoteIndex,
			localDeletedItems,
		);

		// 6. 构建冲突上下文并解决冲突
		const conflictContexts = this.buildConflictContexts(
			localItemsForSync,
			cloudItemsForSync,
			diffResult,
			deviceId,
		);

		const conflictResults = this.conflictResolver.resolveMultipleConflicts(
			conflictContexts,
			deviceId,
			"merge", // 默认使用智能合并策略
		);

		// 7. 生成本地和云端操作结果
		const operationResult = this.generateOperationResult(
			localItemsForSync,
			cloudItemsForSync,
			diffResult,
			conflictResults,
		);

		return operationResult;
	}

	/**
	 * 将 HistoryItem 转换为 SyncItem
	 */
	private convertToSyncItems(historyItems: HistoryItem[]): SyncItem[] {
		return historyItems.map((item) => ({
			id: item.id,
			type: item.type,
			value: item.value || "",
			search: item.search || "",
			createTime: item.createTime,
			lastModified: item.lastModified || Date.now(),
			favorite: item.favorite,
			note: item.note || "",
			checksum: item.checksum || "",
			size: item.size || 0,
			deviceId: item.deviceId || "",
			group: item.group,
			count: item.count || 0,
		}));
	}

	/**
	 * 根据同步模式筛选本地数据
	 */
	private filterLocalItemsBySyncMode(
		localItems: SyncItem[],
		syncConfig: SyncModeConfig | null,
	): SyncItem[] {
		if (!syncConfig?.settings) {
			return localItems;
		}

		const settings = syncConfig.settings;

		return localItems.filter((item) => {
			// 删除状态过滤
			if (item.deleted) {
				return false;
			}

			// 收藏模式过滤
			if (settings.onlyFavorites && !item.favorite) {
				return false;
			}

			// 内容类型过滤
			switch (item.type) {
				case "text":
					return settings.includeText;
				case "html":
					return settings.includeHtml;
				case "rtf":
					return settings.includeRtf;
				case "image":
					return settings.includeImages;
				case "files":
					return settings.includeFiles;
				default:
					return true;
			}
		});
	}

	/**
	 * 根据同步模式筛选云端数据
	 */
	private filterCloudItemsBySyncMode(
		remoteIndex: CloudSyncIndex | null,
		syncConfig: SyncModeConfig | null,
	): SyncItem[] {
		if (!remoteIndex || !remoteIndex.items.length) {
			return [];
		}

		// 将云端指纹转换为 SyncItem 格式
		const cloudItems: SyncItem[] = remoteIndex.items.map((item) => ({
			id: item.id,
			type: item.type,
			value: "", // 云端指纹只包含元数据，不包含完整内容
			search: "",
			createTime: new Date(item.timestamp).toISOString(),
			lastModified: item.timestamp,
			favorite: item.favorite,
			note: item.note,
			checksum: item.checksum,
			size: item.size,
			deviceId: "",
			group: this.determineGroup(item.type),
			count: 0,
		}));

		return this.filterLocalItemsBySyncMode(cloudItems, syncConfig);
	}

	/**
	 * 根据类型确定分组
	 */
	private determineGroup(type: string): "text" | "image" | "files" {
		switch (type) {
			case "text":
			case "html":
			case "rtf":
				return "text";
			case "image":
				return "image";
			case "files":
				return "files";
			default:
				return "text";
		}
	}

	/**
	 * 构建冲突上下文
	 */
	private buildConflictContexts(
		_localItems: SyncItem[],
		cloudItems: SyncItem[],
		diffResult: SyncDiffResult,
		deviceId: string,
	): ConflictResolutionContext[] {
		const contexts: ConflictResolutionContext[] = [];

		// 处理修改的项
		for (const modifiedItem of diffResult.modified) {
			const cloudItem = cloudItems.find((item) => item.id === modifiedItem.id);
			if (cloudItem) {
				contexts.push({
					localItem: modifiedItem,
					remoteItem: cloudItem,
					deviceId,
					mergePreference: "merge",
				});
			}
		}

		// 处理收藏状态变化的项
		for (const favoriteItem of diffResult.favoriteChanged) {
			const cloudItem = cloudItems.find((item) => item.id === favoriteItem.id);
			if (cloudItem) {
				contexts.push({
					localItem: favoriteItem,
					remoteItem: cloudItem,
					deviceId,
					mergePreference: "merge",
				});
			}
		}

		return contexts;
	}

	/**
	 * 生成操作结果
	 */
	private generateOperationResult(
		localItems: SyncItem[],
		cloudItems: SyncItem[],
		diffResult: SyncDiffResult,
		conflictResults: ConflictResolutionResult[],
	): SyncOperationResult {
		// 统计冲突解决结果
		const resolvedConflicts = conflictResults.filter(
			(result) => result.resolvedItem,
		).length;

		const result: SyncOperationResult = {
			local: {
				itemsToAdd: [], // 从云端下载的新项目
				itemsToUpdate: [], // 从云端更新的项目
				itemsToDelete: diffResult.deleted, // 本地删除的项目
			},
			cloud: {
				itemsToAdd: diffResult.added, // 需要上传到云端的新项目
				itemsToUpdate: [...diffResult.modified, ...diffResult.favoriteChanged], // 需要上传到云端的修改项目
				itemsToDelete: [], // 需要从云端删除的项目（由本地删除状态驱动）
			},
			statistics: {
				totalConflicts: conflictResults.length,
				resolvedConflicts,
			},
		};

		// 处理需要从云端下载的项目
		const cloudItemMap = new Map(cloudItems.map((item) => [item.id, item]));
		for (const toDownloadFp of diffResult.toDownload) {
			const cloudItem = cloudItemMap.get(toDownloadFp.id);
			if (cloudItem) {
				const localExists = localItems.find(
					(item) => item.id === toDownloadFp.id,
				);
				if (localExists) {
					result.local.itemsToUpdate.push(cloudItem);
				} else {
					result.local.itemsToAdd.push(cloudItem);
				}
			}
		}

		return result;
	}
}

// 导出单例实例
export const syncConflictResolver = new SyncConflictResolver();
export const syncDiffDetector = new SyncDiffDetector();
export const syncFlowCoordinator = new SyncFlowCoordinator();
