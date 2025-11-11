import type { SyncItem } from "@/types/sync";

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

// 导出单例实例
export const syncConflictResolver = new SyncConflictResolver();
