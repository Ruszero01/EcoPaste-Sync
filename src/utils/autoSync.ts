import { LISTEN_KEY } from "@/constants";
import { emit } from "@tauri-apps/api/event";

export type SyncInterval = 1 | 2 | 6 | 12 | 24; // 小时

export interface AutoSyncConfig {
	enabled: boolean;
	intervalHours: SyncInterval; // 同步间隔（小时）
}

/**
 * 自动同步引擎
 * 简单的定时同步功能，每隔指定时间自动触发同步
 */
class AutoSyncManager {
	private config: AutoSyncConfig = {
		enabled: false,
		intervalHours: 1, // 默认1小时
	};

	private syncTimer: NodeJS.Timeout | null = null;
	private isSyncing = false;

	constructor() {
		// 立即清除任何现有定时器
		this.clearSyncTimer();
	}

	/**
	 * 初始化自动同步
	 */
	initialize(config: Partial<AutoSyncConfig>): void {
		this.config = { ...this.config, ...config };

		if (this.config.enabled) {
			this.startAutoSync();
		}
	}

	/**
	 * 启用/禁用自动同步
	 */
	setEnabled(enabled: boolean): void {
		this.config.enabled = enabled;
		if (!enabled) {
			this.clearSyncTimer();
		} else {
			this.startAutoSync();
		}
	}

	/**
	 * 设置同步间隔
	 */
	setIntervalHours(hours: SyncInterval): void {
		this.config.intervalHours = hours;
		if (this.config.enabled) {
			this.restartAutoSync();
		}
	}

	/**
	 * 启动自动同步
	 */
	private startAutoSync(): void {
		if (!this.config.enabled) return;

		this.clearSyncTimer(); // 清除现有定时器

		const intervalMs = this.config.intervalHours * 60 * 60 * 1000; // 转换为毫秒

		// 设置定时同步，立即触发一次同步
		this.triggerManualSync();

		// 设置定时同步
		this.syncTimer = setInterval(() => {
			this.triggerManualSync();
		}, intervalMs);
	}

	/**
	 * 重启自动同步（当间隔时间改变时）
	 */
	private restartAutoSync(): void {
		if (this.config.enabled) {
			this.startAutoSync();
		}
	}

	/**
	 * 触发手动同步事件
	 */
	private triggerManualSync(): void {
		if (this.isSyncing) {
			return;
		}

		this.isSyncing = true;

		try {
			// 发送事件，触发同步
			emit(LISTEN_KEY.TRIGGER_MANUAL_SYNC, {
				type: "auto_trigger",
				timestamp: Date.now(),
				intervalHours: this.config.intervalHours,
			});
		} catch (error) {
			console.error("❌ 自动同步触发失败:", error);
		} finally {
			// 短暂延迟后重置同步状态
			setTimeout(() => {
				this.isSyncing = false;
			}, 1000);
		}
	}

	/**
	 * 清除同步定时器
	 */
	private clearSyncTimer(): void {
		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
	}

	/**
	 * 停止所有同步
	 */
	stop(): void {
		this.config.enabled = false;
		this.clearSyncTimer();
		this.isSyncing = false;
	}

	/**
	 * 获取当前配置
	 */
	getConfig(): AutoSyncConfig {
		return { ...this.config };
	}

	/**
	 * 检查是否正在同步
	 */
	getIsSyncing(): boolean {
		return this.isSyncing;
	}

	/**
	 * 销毁实例
	 */
	destroy(): void {
		this.clearSyncTimer();
		this.isSyncing = false;
		this.config.enabled = false;
	}
}

// 导出单例实例
export const autoSync = new AutoSyncManager();

// 导出类型
export type { AutoSyncManager };
