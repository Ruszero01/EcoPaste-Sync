import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import type { Store } from "@/types/store.d";
import { type SyncInterval, autoSync } from "@/utils/autoSync";
import { getSaveStorePath } from "@/utils/path";
import { restoreStore, saveStore } from "@/utils/store";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export class ConfigSync {
	private webdavConfig: WebDAVConfig | null = null;

	/**
	 * 初始化配置同步
	 */
	async initialize(config: WebDAVConfig): Promise<void> {
		this.webdavConfig = config;
	}

	/**
	 * 上传本地配置到云端
	 */
	async uploadLocalConfig(): Promise<{ success: boolean; message: string }> {
		if (!this.webdavConfig) {
			return {
				success: false,
				message: "WebDAV配置无效",
			};
		}

		try {
			// 1. 保存当前配置到本地文件
			await saveStore();

			// 2. 读取配置文件内容
			const configPath = await getSaveStorePath();
			const configContent = await readTextFile(configPath);

			// 3. 过滤环境相关的配置
			const configData = JSON.parse(configContent) as Store;
			const filteredConfig = this.filterConfigForSync(configData);

			// 4. 上传到云端
			const remotePath = `${this.webdavConfig.path}/store-config.json`;
			const uploadResult = await uploadSyncData(
				this.webdavConfig,
				remotePath,
				JSON.stringify(filteredConfig, null, 2),
			);

			if (uploadResult.success) {
				return {
					success: true,
					message: "配置已上传到云端",
				};
			}

			return {
				success: false,
				message: `上传失败：${uploadResult.error_message || "未知错误"}`,
			};
		} catch (error) {
			return {
				success: false,
				message: `上传配置失败：${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
	}

	/**
	 * 应用云端配置
	 */
	async applyRemoteConfig(): Promise<{ success: boolean; message: string }> {
		if (!this.webdavConfig) {
			return {
				success: false,
				message: "WebDAV配置无效",
			};
		}

		try {
			// 1. 读取当前本地配置，保存重要信息
			const configPath = await getSaveStorePath();
			let localConfigData: Store;

			try {
				const localConfigContent = await readTextFile(configPath);
				localConfigData = JSON.parse(localConfigContent) as Store;
			} catch (readError) {
				console.error("读取本地配置失败:", readError);
				return {
					success: false,
					message: "读取本地配置失败",
				};
			}

			// 保存本地服务器配置信息
			const localServerConfig =
				localConfigData.globalStore?.cloudSync?.serverConfig;

			// 2. 从云端下载配置
			const remotePath = `${this.webdavConfig.path}/store-config.json`;
			const downloadResult = await downloadSyncData(
				this.webdavConfig,
				remotePath,
			);

			if (!downloadResult.success) {
				return {
					success: false,
					message: `下载配置失败：${downloadResult.error_message || "未知错误"}`,
				};
			}

			// 3. 解析云端配置
			if (!downloadResult.data) {
				return {
					success: false,
					message: "云端配置数据为空",
				};
			}

			let remoteConfigData: Store;
			try {
				remoteConfigData = JSON.parse(downloadResult.data) as Store;
			} catch (_parseError) {
				return {
					success: false,
					message: "云端配置格式错误",
				};
			}

			// 4. 合并配置：应用云端配置，但保留本地服务器配置信息
			const mergedConfig = this.mergeRemoteConfigWithLocalSettings(
				remoteConfigData,
				localServerConfig,
			);

			// 5. 应用合并后的配置到本地文件
			await writeTextFile(configPath, JSON.stringify(mergedConfig, null, 2));

			// 6. 重新加载配置到store
			await this.reloadStore();

			// 7. 重新初始化自动同步以确保新的配置生效
			try {
				if (mergedConfig.globalStore?.cloudSync?.autoSyncSettings) {
					const { enabled, intervalHours } =
						mergedConfig.globalStore.cloudSync.autoSyncSettings;
					// 确保intervalHours符合SyncInterval类型
					const validInterval: SyncInterval = intervalHours as SyncInterval;
					await autoSync.initialize({ enabled, intervalHours: validInterval });
				}
			} catch (error) {
				console.error("⚠️ ConfigSync: 自动同步重新初始化失败:", error);
				// 静默处理自动同步重新初始化失败，不影响配置同步的成功状态
				// 自动同步功能可以稍后在CloudSync组件中重新初始化
			}

			return {
				success: true,
				message: "云端配置已应用，服务器配置保持不变，自动同步已重新初始化",
			};
		} catch (error) {
			return {
				success: false,
				message: `应用配置失败：${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
	}

	/**
	 * 过滤配置，移除环境相关和不需要同步的字段
	 */
	private filterConfigForSync(config: Store): Store {
		const filtered = JSON.parse(JSON.stringify(config)) as Store; // 深拷贝

		// 1. 移除环境相关的配置
		if (filtered.globalStore?.env) {
			filtered.globalStore.env = {};
		}

		// 2. 移除运行时状态和服务器配置信息，但保留用户偏好
		if (filtered.globalStore?.cloudSync) {
			const { cloudSync } = filtered.globalStore;

			// 保存用户偏好配置（这些应该被同步）
			const userAutoSyncSettings = cloudSync.autoSyncSettings;
			const userSyncModeConfig = cloudSync.syncModeConfig;
			const userFileSync = cloudSync.fileSync;

			// 移除运行时状态，重新设置为默认值
			cloudSync.lastSyncTime = 0;
			cloudSync.isSyncing = false;

			// 完全移除服务器配置信息，不应该同步到云端
			// 理由：
			// 1. 先有鸡还是先有蛋的问题：必须先配置服务器才能同步
			// 2. 安全性考虑：密码等敏感信息不应同步
			// 3. 避免覆盖：云端配置会覆盖本地服务器配置，导致连接失败
			cloudSync.serverConfig = {
				url: "",
				username: "",
				password: "",
				path: "",
				timeout: 30000, // 默认超时时间
			};

			// 恢复用户偏好配置（这些是重要的，需要同步）
			if (userAutoSyncSettings) {
				cloudSync.autoSyncSettings = { ...userAutoSyncSettings };
			}
			if (userSyncModeConfig) {
				cloudSync.syncModeConfig = { ...userSyncModeConfig };
			}
			if (userFileSync) {
				cloudSync.fileSync = { ...userFileSync };
			}
		}

		// 3. 移除剪贴板存储中的临时状态
		if (filtered.clipboardStore?.internalCopy) {
			filtered.clipboardStore.internalCopy = {
				isCopying: false,
				itemId: null,
			};
		}

		// 4. 移除设备特定的配置项
		if (filtered.globalStore?.app) {
			const { app } = filtered.globalStore;
			// autoStart 和 showTaskbarIcon 是平台相关的，不同设备可能有不同设置
			// 保留用户的主观偏好设置，但重置为默认值避免冲突
			app.autoStart = false; // 默认值
			app.showTaskbarIcon = true; // 默认值
			app.silentStart = false; // 默认值
		}

		return filtered;
	}

	/**
	 * 重新加载配置到store
	 */
	private async reloadStore(): Promise<void> {
		await restoreStore();
	}

	/**
	 * 合并云端配置和本地服务器配置
	 */
	private mergeRemoteConfigWithLocalSettings(
		remoteConfig: Store,
		localServerConfig: any,
	): Store {
		const merged = JSON.parse(JSON.stringify(remoteConfig)) as Store;

		// 保留本地服务器配置信息，避免云端空配置覆盖本地设置
		if (merged.globalStore?.cloudSync && localServerConfig) {
			// 只有当本地服务器配置存在时才保留
			if (localServerConfig.url || localServerConfig.username) {
				merged.globalStore.cloudSync.serverConfig = { ...localServerConfig };
			}
		}

		return merged;
	}
}

// 导出单例实例
export const configSync = new ConfigSync();
