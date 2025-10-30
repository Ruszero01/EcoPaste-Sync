import { LISTEN_KEY } from "@/constants";
import { emit } from "@tauri-apps/api/event";

export type SyncInterval = 1 | 2 | 6 | 12 | 24; // 小时

export interface IntervalSyncConfig {
	enabled: boolean;
	intervalHours: SyncInterval; // 同步间隔（小时）
}

class IntervalSyncEngine {
	private config: IntervalSyncConfig = {
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
	 * 初始化间隔同步
	 */
	initialize(config: Partial<IntervalSyncConfig>): void {
		this.config = { ...this.config, ...config };

		if (this.config.enabled) {
			this.startIntervalSync();
		}
	}

	/**
	 * 启用/禁用间隔同步
	 */
	setEnabled(enabled: boolean): void {
		this.config.enabled = enabled;
		if (!enabled) {
			this.clearSyncTimer();
		} else {
			this.startIntervalSync();
		}
	}

	/**
	 * 设置同步间隔
	 */
	setIntervalHours(hours: SyncInterval): void {
		this.config.intervalHours = hours;
		if (this.config.enabled) {
			this.restartIntervalSync();
		}
	}

	/**
	 * 启动间隔同步
	 */
	startIntervalSync(): void {
		if (!this.config.enabled) return;

		this.clearSyncTimer(); // 清除现有定时器

		const intervalMs = this.config.intervalHours * 60 * 60 * 1000; // 转换为毫秒

		// 设置定时同步，立即触发一次同步按钮点击事件
		this.triggerManualSync();

		// 设置定时同步
		this.syncTimer = setInterval(() => {
			this.triggerManualSync();
		}, intervalMs);
	}

	/**
	 * 重启间隔同步（当间隔时间改变时）
	 */
	private restartIntervalSync(): void {
		if (this.config.enabled) {
			this.startIntervalSync();
		}
	}

	/**
	 * 触发手动同步按钮点击事件
	 */
	private triggerManualSync(): void {
		if (this.isSyncing) {
			return;
		}

		this.isSyncing = true;

		try {
			// 发送事件，触发立即同步按钮的点击
			emit(LISTEN_KEY.TRIGGER_MANUAL_SYNC, {
				type: "interval_trigger",
				timestamp: Date.now(),
				intervalHours: this.config.intervalHours,
			});
		} catch (error) {
			console.error("❌ 间隔同步触发失败:", error);
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
	 * 强制停止所有同步
	 */
	forceStopAllSync(): void {
		this.config.enabled = false;
		this.clearSyncTimer();
		this.isSyncing = false;
	}

	/**
	 * 获取当前配置
	 */
	getConfig(): IntervalSyncConfig {
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

// 创建单例实例
export const realtimeSync = new IntervalSyncEngine();

// 导出类型和工具函数
export type { IntervalSyncEngine };

/**
 * 设置同步事件监听器
 */
export const setSyncEventListener = (listener: () => void) => {
	// 保留此函数以保持向后兼容性
};
