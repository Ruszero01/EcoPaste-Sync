import type { SyncItem } from "@/types/sync";

/**
 * 同步冲突解决器
 *
 * 职责：
 * - 处理本地和云端数据的实际冲突
 * - 提供合并、本地优先、远程优先三种解决策略
 * - 检测真实冲突（ID相同但内容不同）
 */

export interface ConflictResolutionContext {
	localItem: SyncItem;
	remoteItem: SyncItem;
	deviceId: string;
	mergePreference?: "local" | "remote" | "merge";
}

export interface ConflictResolutionResult {
	resolvedItem: SyncItem;
	strategy: "local" | "remote" | "merge";
}

/**
 * 检测真实的冲突（ID相同但内容不同）
 * @param localItems 本地同步项
 * @param cloudItems 云端同步项
 * @returns 真实冲突列表
 */
export const detectRealConflicts = (
	localItems: SyncItem[],
	cloudItems: SyncItem[],
): Array<{
	localItem: SyncItem;
	remoteItem: SyncItem;
}> => {
	const conflicts: Array<{
		localItem: SyncItem;
		remoteItem: SyncItem;
	}> = [];

	const cloudItemMap = new Map(cloudItems.map((item) => [item.id, item]));

	for (const localItem of localItems) {
		const cloudItem = cloudItemMap.get(localItem.id);
		if (cloudItem) {
			// 检查是否真的有冲突 - 只有当内容确实不同时才认为是冲突
			// 1. 优先使用校验和比较，因为云端指纹可能不包含完整内容
			const hasChecksumConflict =
				localItem.checksum &&
				cloudItem.checksum &&
				localItem.checksum !== cloudItem.checksum;

			// 2. 如果校验和不可用，则直接比较内容
			const hasContentConflict =
				localItem.value &&
				cloudItem.value &&
				localItem.value !== cloudItem.value;

			// 3. 检查其他字段的变更
			const hasFavoriteConflict = localItem.favorite !== cloudItem.favorite;
			const hasNoteConflict = (localItem.note || "") !== (cloudItem.note || "");

			// 只有在内容或重要元数据不同时才认为是冲突
			// 时间戳差异本身不应被视为冲突，而应作为内容变更的辅助判断
			if (
				hasChecksumConflict ||
				hasContentConflict ||
				hasFavoriteConflict ||
				hasNoteConflict
			) {
				conflicts.push({
					localItem,
					remoteItem: cloudItem,
				});
			}
		}
	}

	return conflicts;
};

/**
 * 智能合并函数 - 合并本地和远程项目的最佳属性
 */
function mergeItems(localItem: SyncItem, remoteItem: SyncItem): SyncItem {
	// 选择较新的修改时间
	const lastModified = Math.max(
		localItem.lastModified || 0,
		remoteItem.lastModified || 0,
	);

	// 合并策略：
	// 1. 内容：优先使用本地内容（编辑后的最新内容）
	// 2. 收藏状态：优先使用本地状态（用户的最新操作）
	// 3. 备注：优先使用非空且较新的版本
	// 4. 其他字段：基于修改时间选择
	const localNote = (localItem.note || "").trim();
	const remoteNote = (remoteItem.note || "").trim();
	const finalNote = localNote || remoteNote;

	return {
		// 优先使用本地版本作为基础，确保编辑后的内容被保留
		...localItem,

		// 使用最新的修改时间（通常是编辑后的时间）
		lastModified,

		// 合并备注，优先使用本地非空备注
		note: finalNote,

		// 确保重要字段不丢失，但优先使用本地版本
		search: localItem.search || remoteItem.search,
		checksum: localItem.checksum || remoteItem.checksum,

		// 如果本地有更新的内容，确保使用本地的value
		value: localItem.value || remoteItem.value,

		// 其他字段优先本地，确保编辑后的元数据被保留
		size: localItem.size || remoteItem.size,
		width: localItem.width || remoteItem.width,
		height: localItem.height || remoteItem.height,
		subtype: localItem.subtype || remoteItem.subtype,
	};
}

/**
 * 同步冲突解决器
 */
export class SyncConflictResolver {
	/**
	 * 解决单个冲突项
	 */
	resolveConflict(
		context: ConflictResolutionContext,
	): ConflictResolutionResult {
		const { localItem, remoteItem, mergePreference = "merge" } = context;

		// 根据合并偏好解决冲突
		switch (mergePreference) {
			case "local":
				return {
					resolvedItem: localItem,
					strategy: "local",
				};

			case "remote":
				return {
					resolvedItem: remoteItem,
					strategy: "remote",
				};

			default:
				return {
					resolvedItem: mergeItems(localItem, remoteItem),
					strategy: "merge",
				};
		}
	}

	/**
	 * 解决多个冲突项
	 */
	resolveMultipleConflicts(
		conflicts: ConflictResolutionContext[],
		_deviceId: string,
		defaultStrategy: "local" | "remote" | "merge" = "merge",
	): ConflictResolutionResult[] {
		return conflicts.map((conflict) => {
			// 使用指定的默认策略
			const result = this.resolveConflict({
				...conflict,
				mergePreference: defaultStrategy,
			});

			return result;
		});
	}
}

// 导出单例实例
export const syncConflictResolver = new SyncConflictResolver();
