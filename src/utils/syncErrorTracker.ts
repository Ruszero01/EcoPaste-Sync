/**
 * 全局同步错误跟踪器
 * 用于跟踪和管理智能同步过程中的错误，防止无限重试
 */

interface SyncErrorRecord {
	packageId: string;
	errorCount: number;
	lastErrorTime: number;
	lastErrorMessage: string;
	isPermanentlyFailed: boolean;
}

class SyncErrorTracker {
	private errorRecords: Map<string, SyncErrorRecord> = new Map();
	private readonly MAX_ERROR_COUNT = 5; // 最大错误次数
	private readonly ERROR_COOLDOWN = 5 * 60 * 1000; // 5分钟冷却时间
	private readonly PERMANENT_FAILURE_THRESHOLD = 10; // 永久失败阈值

	/**
	 * 记录同步错误
	 */
	recordError(packageId: string, errorMessage: string): void {
		const existing = this.errorRecords.get(packageId);
		const now = Date.now();

		if (existing) {
			// 如果距离上次错误超过冷却时间，重置错误计数
			if (now - existing.lastErrorTime > this.ERROR_COOLDOWN) {
				existing.errorCount = 1;
			} else {
				existing.errorCount++;
			}

			existing.lastErrorTime = now;
			existing.lastErrorMessage = errorMessage;

			// 检查是否达到永久失败阈值
			if (existing.errorCount >= this.PERMANENT_FAILURE_THRESHOLD) {
				existing.isPermanentlyFailed = true;
				console.error(
					`🚫 [SyncErrorTracker] 包 ${packageId} 已标记为永久失败，错误次数: ${existing.errorCount}`,
				);
			}
		} else {
			// 创建新的错误记录
			this.errorRecords.set(packageId, {
				packageId,
				errorCount: 1,
				lastErrorTime: now,
				lastErrorMessage: errorMessage,
				isPermanentlyFailed: false,
			});
		}

		// 记录错误日志
		const record = this.errorRecords.get(packageId)!;
		console.error("📝 [SyncErrorTracker] 记录错误:", {
			packageId,
			errorCount: record.errorCount,
			errorMessage,
			isPermanentlyFailed: record.isPermanentlyFailed,
		});
	}

	/**
	 * 检查是否失败次数过多
	 */
	hasFailedTooManyTimes(packageId: string): boolean {
		const record = this.errorRecords.get(packageId);

		if (!record) {
			return false;
		}

		// 如果已标记为永久失败，直接返回true
		if (record.isPermanentlyFailed) {
			return true;
		}

		// 如果错误次数超过阈值，检查是否在冷却期内
		if (record.errorCount >= this.MAX_ERROR_COUNT) {
			const now = Date.now();
			const isInCooldown = now - record.lastErrorTime < this.ERROR_COOLDOWN;

			if (isInCooldown) {
				console.warn(
					`⏳ [SyncErrorTracker] 包 ${packageId} 在冷却期内，暂停同步`,
					{
						errorCount: record.errorCount,
						remainingCooldown:
							this.ERROR_COOLDOWN - (now - record.lastErrorTime),
					},
				);
				return true;
			}
		}

		return false;
	}

	/**
	 * 清除错误记录
	 */
	clearError(packageId: string): void {
		this.errorRecords.delete(packageId);
		// biome-ignore lint/suspicious/noConsoleLog: 允许在关键操作时使用日志
		console.log(`✅ [SyncErrorTracker] 已清除包 ${packageId} 的错误记录`);
	}

	/**
	 * 重置永久失败状态（用于手动恢复）
	 */
	resetPermanentFailure(packageId: string): void {
		const record = this.errorRecords.get(packageId);
		if (record) {
			record.isPermanentlyFailed = false;
			record.errorCount = 0;
			// biome-ignore lint/suspicious/noConsoleLog: 允许在关键操作时使用日志
			console.log(`🔄 [SyncErrorTracker] 已重置包 ${packageId} 的永久失败状态`);
		}
	}

	/**
	 * 获取错误记录
	 */
	getErrorRecord(packageId: string): SyncErrorRecord | undefined {
		return this.errorRecords.get(packageId);
	}

	/**
	 * 获取所有错误记录
	 */
	getAllErrorRecords(): SyncErrorRecord[] {
		return Array.from(this.errorRecords.values());
	}

	/**
	 * 清除过期的错误记录
	 */
	cleanupExpiredRecords(): void {
		const now = Date.now();
		const expiredIds: string[] = [];

		for (const [packageId, record] of this.errorRecords) {
			// 清除超过1小时且未标记为永久失败的记录
			if (
				!record.isPermanentlyFailed &&
				now - record.lastErrorTime > 60 * 60 * 1000
			) {
				expiredIds.push(packageId);
			}
		}

		for (const id of expiredIds) {
			this.errorRecords.delete(id);
		}

		if (expiredIds.length > 0) {
			// biome-ignore lint/suspicious/noConsoleLog: 允许在清理操作时使用日志
			console.log(
				`🧹 [SyncErrorTracker] 清除了 ${expiredIds.length} 条过期错误记录`,
			);
		}
	}

	/**
	 * 获取统计信息
	 */
	getStats(): {
		totalRecords: number;
		permanentlyFailed: number;
		inCooldown: number;
	} {
		const now = Date.now();
		let permanentlyFailed = 0;
		let inCooldown = 0;

		for (const record of this.errorRecords.values()) {
			if (record.isPermanentlyFailed) {
				permanentlyFailed++;
			} else if (
				record.errorCount >= this.MAX_ERROR_COUNT &&
				now - record.lastErrorTime < this.ERROR_COOLDOWN
			) {
				inCooldown++;
			}
		}

		return {
			totalRecords: this.errorRecords.size,
			permanentlyFailed,
			inCooldown,
		};
	}
}

// 创建全局单例实例
export const syncErrorTracker = new SyncErrorTracker();

// 定期清理过期记录（每10分钟）
setInterval(
	() => {
		syncErrorTracker.cleanupExpiredRecords();
	},
	10 * 60 * 1000,
);

// 导出获取全局实例的函数
export const getGlobalSyncErrorTracker = () => syncErrorTracker;
