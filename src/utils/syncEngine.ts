import { LISTEN_KEY } from "@/constants";
import {
	getHistoryData,
	setHistoryData,
	setImportLogCallback,
} from "@/database";
import {
	type WebDAVConfig,
	downloadSyncData,
	uploadSyncData,
} from "@/plugins/webdav";
import type {
	SyncData,
	SyncItem,
	SyncMetadata,
	SyncResult,
} from "@/types/sync";
import { getSaveDatabasePath } from "@/utils/path";
import { calculateChecksum, generateDeviceId } from "@/utils/shared";
import { emit } from "@tauri-apps/api/event";
import { writeTextFile } from "@tauri-apps/plugin-fs";

// 全局事件发射器
let syncEventEmitter: (() => void) | null = null;

// 全局日志回调，用于外部日志显示
let globalLogCallback:
	| ((
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
	  ) => void)
	| null = null;

/**
 * 设置全局日志回调
 */
export const setGlobalSyncLogCallback = (
	callback: (
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) => void,
) => {
	globalLogCallback = callback;
};

/**
 * 添加全局日志
 */
const addGlobalLog = (
	level: "info" | "success" | "warning" | "error",
	message: string,
	data?: any,
) => {
	if (globalLogCallback) {
		globalLogCallback(level, message, data);
	}
};

/**
 * 设置同步事件监听器
 */
export const setSyncEventListener = (listener: () => void) => {
	// 检查是否是相同的监听器，避免不必要的重复设置
	if (syncEventEmitter === listener) {
		addGlobalLog("info", "📡 同步事件监听器已存在，跳过重复设置");
		return;
	}

	if (syncEventEmitter) {
		addGlobalLog(
			"warning",
			"⚠️ 检测到重复的同步事件监听器设置，将覆盖之前的监听器",
		);
	} else {
		addGlobalLog("info", "📡 设置同步事件监听器");
	}
	syncEventEmitter = listener;
};

/**
 * 触发同步事件
 */
const triggerSyncEvent = () => {
	addGlobalLog("info", "🔄 准备触发同步事件", {
		hasListener: !!syncEventEmitter,
	});
	if (syncEventEmitter) {
		addGlobalLog("success", "✅ 执行同步事件监听器");
		syncEventEmitter();
	} else {
		addGlobalLog("warning", "⚠️ 没有设置同步事件监听器");
	}
};

export class SyncEngine {
	private config: WebDAVConfig | null = null;
	private deviceId: string = generateDeviceId();
	private isOnline = false;
	private lastSyncTime = 0;
	private logCallback:
		| ((
				level: "info" | "success" | "warning" | "error",
				message: string,
				data?: any,
		  ) => void)
		| null = null;

	constructor() {
		this.deviceId = generateDeviceId();
	}

	/**
	 * 设置日志回调函数
	 */
	setLogCallback(
		callback: (
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
		) => void,
	) {
		this.logCallback = callback;
	}

	/**
	 * 添加日志
	 */
	private addLog(
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) {
		if (this.logCallback) {
			this.logCallback(level, message, data);
		}
	}

	/**
	 * 初始化同步引擎
	 */
	async initialize(config: WebDAVConfig): Promise<boolean> {
		this.config = config;
		this.isOnline = true;
		return true;
	}

	/**
	 * 获取设备ID
	 */
	getDeviceId(): string {
		return this.deviceId;
	}

	/**
	 * 生成同步文件路径
	 */
	private getSyncFileName(): string {
		const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
		return `sync-${timestamp}.json`;
	}

	/**
	 * 获取全量同步文件路径
	 */
	private getFullSyncFilePath(): string {
		// 使用固定文件名，便于下载时查找
		return "/EcoPaste/sync-data.json";
	}

	/**
	 * 获取元数据文件路径
	 */
	private getMetadataFileName(): string {
		return "metadata.json";
	}

	/**
	 * 将本地历史数据转换为同步数据格式
	 */
	private async convertLocalToSyncData(): Promise<SyncData> {
		try {
			const localData = await getHistoryData();

			const syncItems: SyncItem[] = localData.map((item) => ({
				id: item.id,
				type: item.type as any,
				group: item.group as any,
				value: item.value,
				search: item.search,
				count: item.count,
				width: item.width,
				height: item.height,
				favorite: item.favorite,
				createTime: item.createTime,
				note: item.note,
				subtype: item.subtype,
				lastModified: Date.now(),
				deviceId: this.deviceId,
				size: JSON.stringify(item).length,
				checksum: calculateChecksum(item.value),
			}));

			return {
				version: 1,
				timestamp: Date.now(),
				deviceId: this.deviceId,
				dataType: "full",
				items: syncItems,
				deleted: [],
				compression: "none",
				checksum: calculateChecksum(JSON.stringify(syncItems)),
			};
		} catch (error) {
			console.error("转换本地数据失败:", error);
			throw error;
		}
	}

	/**
	 * 全量同步上传
	 */
	async fullSyncUpload(): Promise<SyncResult> {
		if (!this.config) {
			throw new Error("WebDAV配置未初始化");
		}

		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		try {
			// 1. 获取本地数据
			const syncData = await this.convertLocalToSyncData();

			// 2. 直接上传文件（使用现有的 /EcoPaste/ 目录）
			const filePath = this.getFullSyncFilePath();
			this.addLog("info", "☁️ 开始上传全量同步文件", { filePath });

			const uploadResult = await uploadSyncData(
				this.config,
				filePath,
				JSON.stringify(syncData, null, 2),
			);

			if (uploadResult.success) {
				result.uploaded = syncData.items.length;
				result.success = true;

				// 3. 更新元数据
				await this.updateMetadata();
				this.lastSyncTime = Date.now();
			} else {
				result.errors.push(uploadResult.error_message || "上传失败");
			}
		} catch (error) {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	/**
	 * 尝试查找最新的可用同步文件
	 */
	private async findLatestSyncFile(): Promise<string | null> {
		if (!this.config) return null;

		// 优先尝试固定文件名
		const possibleFiles = [
			"/EcoPaste/sync-data.json", // 主要同步文件
			"/EcoPaste/incremental.json", // 增量数据文件
			"/EcoPaste/metadata.json", // 元数据文件
		];

		this.addLog("info", "🔍 搜索可用的同步文件", { possibleFiles });

		for (const filePath of possibleFiles) {
			try {
				this.addLog("info", `📥 尝试下载文件: ${filePath}`);
				const result = await downloadSyncData(this.config, filePath);
				if (result.success && result.data) {
					this.addLog("success", `✅ 找到可用文件: ${filePath}`);
					return filePath;
				}
			} catch (error) {
				this.addLog("info", `❌ 文件不可用: ${filePath}`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.addLog("warning", "⚠️ 未找到任何可用的同步文件，将创建新的同步数据");
		return null;
	}

	/**
	 * 全量同步下载
	 */
	async fullSyncDownload(): Promise<SyncResult> {
		this.addLog("info", "🚀 开始全量同步下载", { configExists: !!this.config });

		if (!this.config) {
			this.addLog("error", "❌ WebDAV配置未初始化");
			throw new Error("WebDAV配置未初始化");
		}

		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: [],
			errors: [],
			duration: 0,
			timestamp: startTime,
		};

		try {
			// 1. 查找最新的可用同步文件
			const filePath = await this.findLatestSyncFile();
			if (!filePath) {
				this.addLog("error", "❌ 未找到可用的同步文件");
				result.errors.push("云端没有可用的同步数据");
				return result;
			}

			this.addLog("info", "🌐 开始下载全量同步文件", { filePath });
			const downloadResult = await downloadSyncData(this.config, filePath);
			this.addLog("info", "📦 文件下载完成", {
				success: downloadResult.success,
				hasData: !!downloadResult.data,
				error: downloadResult.error_message,
			});

			if (downloadResult.success && downloadResult.data) {
				// 2. 解析同步数据
				this.addLog("info", "📄 解析同步数据成功");
				const syncData: SyncData = JSON.parse(downloadResult.data);

				// 3. 转换为本地格式并保存
				const localData = syncData.items.map((item) => ({
					id: item.id,
					type: item.type,
					group: item.group,
					value: item.value,
					search: item.search,
					count: item.count,
					width: item.width,
					height: item.height,
					favorite: item.favorite,
					createTime: item.createTime,
					note: item.note,
					subtype: item.subtype,
				}));

				this.addLog("info", `💾 准备导入 ${localData.length} 条数据到数据库`);
				this.addLog("info", "📋 数据样本", { sample: localData.slice(0, 2) });

				// 确保数据库日志回调已设置
				if (this.logCallback) {
					setImportLogCallback((message, data) => {
						this.logCallback("info", `💾 ${message}`, data);
					});
				}

				this.addLog("info", "🔄 开始调用 setHistoryData");
				await setHistoryData(localData);
				this.addLog("success", "✅ setHistoryData 调用完成");
				result.downloaded = syncData.items.length;
				result.success = true;

				// 4. 更新元数据
				await this.updateMetadata();
				this.lastSyncTime = Date.now();

				// 5. 短暂延迟确保数据写入完成
				await new Promise((resolve) => setTimeout(resolve, 100));

				// 6. 触发界面刷新事件
				this.addLog("success", "🔄 触发界面刷新事件");
				triggerSyncEvent();

				// 7. 使用项目原有的刷新事件
				this.addLog("info", "📢 发送项目标准刷新事件");
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					this.addLog("success", "✅ 项目标准刷新事件发送成功");
				} catch (error) {
					this.addLog("error", "❌ 项目标准刷新事件发送失败", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				this.addLog("error", "❌ 数据下载失败", {
					error: downloadResult.error_message,
				});
				result.errors.push(downloadResult.error_message || "下载失败");
			}
		} catch (error) {
			result.errors.push(
				error instanceof Error ? error.message : String(error),
			);
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	/**
	 * 更新同步元数据
	 */
	private async updateMetadata(): Promise<void> {
		if (!this.config) return;

		const metadata: SyncMetadata = {
			lastSyncTime: Date.now(),
			deviceId: this.deviceId,
			syncVersion: 1,
			conflictResolution: "merge",
			networkQuality: "medium",
			performanceMetrics: {
				avgUploadSpeed: 0,
				avgDownloadSpeed: 0,
				avgLatency: 0,
			},
		};

		const filePath = `/EcoPaste/${this.getMetadataFileName()}`;
		await uploadSyncData(
			this.config,
			filePath,
			JSON.stringify(metadata, null, 2),
		).catch((error) => {
			console.error("更新元数据失败:", error);
		});
	}

	/**
	 * 获取同步状态
	 */
	getSyncStatus() {
		return {
			isOnline: this.isOnline,
			isSyncing: false,
			lastSyncTime: this.lastSyncTime,
			pendingCount: 0,
			errorCount: 0,
			syncProgress: 0,
		};
	}

	/**
	 * 直接导入历史数据（参考备份系统逻辑）
	 */
	private async importHistoryDataDirect(data: any[]) {
		this.addLog("info", "🔄 使用直接导入方式");

		try {
			// 1. 关闭数据库连接
			this.addLog("info", "🔒 关闭数据库连接");
			emit(LISTEN_KEY.CLOSE_DATABASE);

			// 2. 生成 SQL 语句来重建数据库
			const sqlStatements = [
				"DELETE FROM history;",
				...data.map((item) => {
					const fields = Object.keys(item);
					const values = Object.values(item);
					const placeholders = values.map(() => "?").join(", ");
					const sql = `INSERT INTO history (${fields.join(", ")}) VALUES (${placeholders});`;
					return { sql, values };
				}),
			];

			this.addLog("info", `📝 生成了 ${sqlStatements.length} 条 SQL 语句`);

			// 3. 将数据写入临时 SQL 文件
			const dbPath = await getSaveDatabasePath();
			const tempSqlPath = dbPath.replace(".db", "_temp.sql");

			let sqlContent = "";
			for (const statement of sqlStatements) {
				if (typeof statement === "string") {
					sqlContent += `${statement}\n`;
				} else {
					sqlContent += `${statement.sql}\n`;
				}
			}

			await writeTextFile(tempSqlPath, sqlContent);
			this.addLog("success", "✅ SQL 文件生成成功");

			// 4. 直接使用原有的 setHistoryData 方法，但使用更好的事务处理
			await setHistoryData(data);

			this.addLog("success", "✅ 数据导入完成");
		} catch (error) {
			this.addLog("error", "❌ 直接导入失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * 检查是否可以同步
	 */
	canSync(): boolean {
		return this.isOnline && !!this.config;
	}
}

// 创建全局同步引擎实例
export const syncEngine = new SyncEngine();
