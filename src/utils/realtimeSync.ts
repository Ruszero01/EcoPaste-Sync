import { LISTEN_KEY } from "@/constants";
import { getHistoryData, setHistoryData } from "@/database";
import {
	type WebDAVConfig,
	downloadSyncData,
	uploadSyncData,
} from "@/plugins/webdav";
import type { HistoryTablePayload } from "@/types/database";
import { calculateChecksum, generateDeviceId } from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";

export type SyncInterval = 1 | 2 | 6 | 12 | 24; // 小时

export interface IntervalSyncConfig {
	enabled: boolean;
	intervalHours: SyncInterval; // 同步间隔（小时）
	webdavConfig?: WebDAVConfig; // WebDAV配置
}

export interface SyncChange {
	type: "insert" | "update" | "delete";
	item: any;
	timestamp: number;
	deviceId: string;
}

class IntervalSyncEngine {
	private config: IntervalSyncConfig = {
		enabled: false,
		intervalHours: 1, // 默认1小时
	};

	private deviceId: string = generateDeviceId();
	private syncTimer: NodeJS.Timeout | null = null;
	private lastSyncTime = 0;
	private isSyncing = false;
	private webdavConfig: WebDAVConfig | null = null;

	constructor() {
		this.deviceId = generateDeviceId();
	}

	/**
	 * 获取完整文件路径
	 */
	private getFullPath(fileName: string): string {
		if (!this.webdavConfig) return `/${fileName}`;
		const basePath = this.webdavConfig.path.startsWith("/")
			? this.webdavConfig.path
			: `/${this.webdavConfig.path}`;
		return `${basePath}/${fileName}`;
	}

	/**
	 * 初始化间隔同步
	 */
	initialize(config: Partial<IntervalSyncConfig>): void {
		this.config = { ...this.config, ...config };
		if (config.webdavConfig) {
			this.webdavConfig = config.webdavConfig;
		}

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
		if (!this.config.enabled || !this.webdavConfig) return;

		this.clearSyncTimer(); // 清除现有定时器

		const intervalMs = this.config.intervalHours * 60 * 60 * 1000; // 转换为毫秒

		// 启动间隔同步

		// 立即执行一次同步
		this.performSync();

		// 设置定时同步
		this.syncTimer = setInterval(() => {
			this.performSync();
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
	 * 执行同步操作
	 */
	private async performSync(): Promise<void> {
		if (this.isSyncing || !this.webdavConfig) return;

		this.isSyncing = true;

		try {
			// 开始执行间隔同步

			// 1. 先上传本地数据到云端
			await this.uploadLocalData();

			// 2. 下载云端数据并合并
			await this.downloadAndMergeData();

			this.lastSyncTime = Date.now();
			// 间隔同步完成

			// 通知前端同步完成
			emit(LISTEN_KEY.REALTIME_SYNC_COMPLETED, {
				type: "interval_sync",
				timestamp: this.lastSyncTime,
				intervalHours: this.config.intervalHours,
			});
		} catch (_error) {
			// 间隔同步失败
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * 上传本地数据到云端
	 */
	private async uploadLocalData(): Promise<void> {
		const localData = (await getHistoryData()) as HistoryTablePayload[];

		// 创建同步数据包（使用与 syncEngine 相同的格式）
		const syncData = {
			version: 1,
			timestamp: Date.now(),
			deviceId: this.deviceId,
			dataType: "full",
			items: localData.map((item) => ({
				...item,
				lastModified: item.createTime || Date.now(),
				deviceId: this.deviceId,
				size: JSON.stringify(item).length,
				checksum: calculateChecksum(item.value || ""),
			})),
			deleted: [],
			compression: "none",
		};

		const filePath = this.getFullPath("sync-data.json");

		await uploadSyncData(
			this.webdavConfig!,
			filePath,
			JSON.stringify(syncData),
		);
	}

	/**
	 * 下载云端数据并合并到本地
	 */
	private async downloadAndMergeData(): Promise<void> {
		// 下载主同步文件
		const remoteData = await this.downloadRemoteData();

		// 适配新的数据格式
		const remoteItems = remoteData?.items || remoteData?.data || [];
		if (remoteItems && Array.isArray(remoteItems)) {
			// 合并数据
			const mergedData = this.mergeData(
				(await getHistoryData()) as HistoryTablePayload[],
				remoteItems,
			);

			// 更新本地数据库
			await setHistoryData(mergedData);
			// 云端数据合并成功

			// 通知界面数据已更新
			emit(LISTEN_KEY.REALTIME_SYNC_COMPLETED, {
				type: "merge",
				timestamp: Date.now(),
				itemsCount: remoteItems.length,
				sourceDevice: remoteData.deviceId,
			});
		} else {
			// 云端无数据，跳过下载合并
		}
	}

	/**
	 * 下载云端同步文件
	 */
	private async downloadRemoteData(): Promise<any> {
		try {
			const fileContent = await downloadSyncData(
				this.webdavConfig!,
				this.getFullPath("sync-data.json"),
			);
			if (fileContent) {
				return JSON.parse(fileContent as unknown as string);
			}
		} catch (_error) {
			// 文件不存在是正常情况，忽略错误
			// 同步文件不存在或无数据
		}
		return null;
	}

	/**
	 * 合并数据（去重逻辑）
	 */
	private mergeData(localData: any[], remoteData: any[]): any[] {
		const mergedMap = new Map();

		// 先添加本地数据
		for (const item of localData) {
			const key = `${item.type}:${item.value}`;
			mergedMap.set(key, {
				...item,
				lastModified: item.createTime || Date.now(),
			});
		}

		// 再添加远程数据，远程数据优先
		for (const item of remoteData) {
			const key = `${item.type}:${item.value}`;
			const existing = mergedMap.get(key);

			if (!existing || item.createTime > existing.createTime) {
				// 如果远程数据更新，合并时保留本地的备注和收藏状态
				mergedMap.set(key, {
					...item,
					// 如果本地有备注而远程没有，保留本地备注
					note: item.note || existing?.note || "",
					// 如果本地有收藏状态而远程没有，保留本地收藏状态
					favorite:
						item.favorite !== undefined
							? item.favorite
							: existing?.favorite || false,
					// 保持原有的创建时间
					createTime: existing?.createTime || item.createTime || Date.now(),
				});
			}
		}

		// 转换为数组并按时间排序
		return Array.from(mergedMap.values()).sort(
			(a, b) =>
				new Date(b.createTime).getTime() - new Date(a.createTime).getTime(),
		);
	}

	/**
	 * 清除同步计时器
	 */
	private clearSyncTimer(): void {
		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
	}

	/**
	 * 获取同步状态
	 */
	getStatus() {
		return {
			enabled: this.config.enabled,
			isSyncing: this.isSyncing,
			lastSyncTime: this.lastSyncTime,
			intervalHours: this.config.intervalHours,
		};
	}

	/**
	 * 强制执行一次同步
	 */
	async forceSync(): Promise<void> {
		if (this.config.enabled) {
			await this.performSync();
		}
	}
}

// 创建全局间隔同步实例
export const realtimeSync = new IntervalSyncEngine();
