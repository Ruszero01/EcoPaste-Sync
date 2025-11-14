import {
	type AutoSyncStatus,
	getAutoSyncStatus,
	startAutoSync,
	stopAutoSync,
	updateSyncInterval,
} from "@/plugins/autoSync";

/**
 * 将后端的时间戳转换为前端使用的时间戳
 * 后端使用Unix秒级时间戳，前端使用毫秒级时间戳
 */
function transformBackendTimestamp(
	backendTimestamp?: number,
): number | undefined {
	if (!backendTimestamp || backendTimestamp === 0) {
		return undefined;
	}
	return backendTimestamp * 1000; // 秒转毫秒
}
import { LISTEN_KEY } from "@/constants";
import { getServerConfig } from "@/plugins/webdav";
import { globalStore } from "@/stores/global";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import { syncEngine } from "./syncEngine";

export type SyncInterval = 1 | 2 | 6 | 12 | 24; // 小时

export interface AutoSyncConfig {
	enabled: boolean;
	intervalHours: SyncInterval; // 同步间隔（小时）
}

/**
 * 自动同步引擎 - 后端版本
 * 使用Tauri后端插件管理定时器，支持静默后台同步
 */
class AutoSyncManager {
	private config: AutoSyncConfig = {
		enabled: false,
		intervalHours: 1, // 默认1小时
	};

	private statusChangeUnlisten: (() => void) | null = null;
	private syncTriggerUnlisten: (() => void) | null = null;
	private isSyncing = false;

	constructor() {
		// 设置事件监听
		this.setupEventListeners();
	}

	/**
	 * 设置事件监听器
	 */
	private async setupEventListeners(): Promise<void> {
		try {
			// 监听后端状态变化事件
			this.statusChangeUnlisten = await listen<AutoSyncStatus>(
				"auto-sync-status-changed",
				(_event) => {
					// 可以在这里更新UI状态
				},
			);

			// 监听后端同步触发事件
			this.syncTriggerUnlisten = await listen(
				"auto-sync-trigger",
				async (event) => {
					await this.handleBackgroundSyncTrigger(event.payload);
				},
			);
		} catch (_error) {
			// 静默处理错误
		}
	}

	/**
	 * 处理后台同步触发
	 */
	private async handleBackgroundSyncTrigger(payload: any): Promise<void> {
		if (this.isSyncing) {
			return; // 避免重复同步
		}

		try {
			this.isSyncing = true;

			// 获取WebDAV配置
			const webdavConfig = await getServerConfig();
			if (!webdavConfig?.url) {
				return; // 配置不存在，跳过同步
			}

			// 确保同步引擎已初始化
			await syncEngine.initialize(webdavConfig);

			// 获取同步模式配置（双开关模式）
			const syncModeConfig = {
				settings: {
					includeText:
						globalStore.cloudSync.syncModeConfig.settings.includeText,
					includeHtml:
						globalStore.cloudSync.syncModeConfig.settings.includeHtml,
					includeRtf: globalStore.cloudSync.syncModeConfig.settings.includeRtf,
					includeImages:
						globalStore.cloudSync.syncModeConfig.settings.includeImages,
					includeFiles:
						globalStore.cloudSync.syncModeConfig.settings.includeFiles,
					onlyFavorites:
						globalStore.cloudSync.syncModeConfig.settings.onlyFavorites,
				},
				fileLimits: {
					maxImageSize: globalStore.cloudSync.fileSync.maxFileSize,
					maxFileSize: globalStore.cloudSync.fileSync.maxFileSize,
					maxPackageSize: globalStore.cloudSync.fileSync.maxFileSize,
				},
			};

			syncEngine.setSyncModeConfig(syncModeConfig);

			// 执行同步（与前端"立即同步"使用同一套逻辑）
			const syncResult = await syncEngine.performBidirectionalSync();

			if (syncResult.success) {
				// 触发前端UI更新事件
				try {
					// 转换后端时间戳（秒）为前端时间戳（毫秒）
					const backendTimestamp = payload.timestamp;
					const frontendTimestamp =
						transformBackendTimestamp(backendTimestamp) || syncResult.timestamp;

					emit(LISTEN_KEY.REALTIME_SYNC_COMPLETED, {
						type: "auto_sync",
						timestamp: frontendTimestamp,
						result: syncResult,
					});

					// 触发列表刷新
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_error) {
					// 静默处理错误
				}
			}
		} catch (_error) {
			// 静默处理错误，避免在后台同步时显示错误消息
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * 初始化自动同步
	 */
	async initialize(config: Partial<AutoSyncConfig>): Promise<void> {
		this.config = { ...this.config, ...config };

		try {
			// 如果启用，启动后端定时器
			if (this.config.enabled) {
				await this.startAutoSync();
			}
		} catch (error) {
			console.error("❌ 自动同步初始化失败:", error);
		}
	}

	/**
	 * 启用/禁用自动同步
	 */
	async setEnabled(enabled: boolean): Promise<void> {
		if (this.config.enabled === enabled) return; // 状态未变化

		this.config.enabled = enabled;

		try {
			if (enabled) {
				await this.startAutoSync();
			} else {
				await this.stopAutoSync();
			}
		} catch (error) {
			console.error("❌ 设置自动同步状态失败:", error);
			// 回滚状态
			this.config.enabled = !enabled;
			throw error;
		}
	}

	/**
	 * 设置同步间隔
	 */
	async setIntervalHours(hours: SyncInterval): Promise<void> {
		if (this.config.intervalHours === hours) return; // 间隔未变化

		this.config.intervalHours = hours;

		try {
			// 如果当前已启用，更新间隔
			if (this.config.enabled) {
				await updateSyncInterval(hours);
			}
		} catch (error) {
			console.error("❌ 更新同步间隔失败:", error);
			// 回滚间隔
			this.config.intervalHours = hours === 1 ? 2 : 1; // 简单回滚逻辑
			throw error;
		}
	}

	/**
	 * 启动自动同步
	 */
	private async startAutoSync(): Promise<void> {
		try {
			await startAutoSync(this.config.intervalHours);
		} catch (error) {
			console.error("❌ 启动自动同步失败:", error);
			throw error;
		}
	}

	/**
	 * 停止自动同步
	 */
	private async stopAutoSync(): Promise<void> {
		try {
			await stopAutoSync();
		} catch (error) {
			console.error("❌ 停止自动同步失败:", error);
			throw error;
		}
	}

	/**
	 * 获取当前配置
	 */
	getConfig(): AutoSyncConfig {
		return { ...this.config };
	}

	/**
	 * 获取后端状态
	 */
	async getBackendStatus(): Promise<AutoSyncStatus | null> {
		try {
			const status = await getAutoSyncStatus();

			// 转换后端时间戳格式为前端格式（如果需要）
			if (status) {
				return {
					...status,
					// 转换 Unix 时间戳（秒）为前端时间戳（毫秒）
					last_sync_time: transformBackendTimestamp(status.last_sync_time),
					next_sync_time: transformBackendTimestamp(status.next_sync_time),
				};
			}

			return status;
		} catch (error) {
			console.error("❌ 获取后端自动同步状态失败:", error);
			return null;
		}
	}

	/**
	 * 检查是否正在同步
	 */
	getIsSyncing(): boolean {
		// 后端版本中，同步状态由后端管理
		// 这里返回配置的启用状态
		return this.config.enabled;
	}

	/**
	 * 停止所有同步
	 */
	async stop(): Promise<void> {
		this.config.enabled = false;
		try {
			await this.stopAutoSync();
		} catch (error) {
			console.error("❌ 停止自动同步失败:", error);
		}
	}

	/**
	 * 销毁实例
	 */
	async destroy(): Promise<void> {
		this.config.enabled = false;

		// 清理事件监听
		if (this.statusChangeUnlisten) {
			this.statusChangeUnlisten();
			this.statusChangeUnlisten = null;
		}

		if (this.syncTriggerUnlisten) {
			this.syncTriggerUnlisten();
			this.syncTriggerUnlisten = null;
		}

		// 停止后端定时器
		try {
			await this.stopAutoSync();
		} catch (_error) {
			// 静默处理错误
		}
	}
}

// 导出单例实例
export const autoSync = new AutoSyncManager();

// 导出类型
export type { AutoSyncManager };
