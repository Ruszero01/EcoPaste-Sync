import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import type { Store } from "@/types/store.d";
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
			// 1. 从云端下载配置
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

			// 2. 解析云端配置
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

			// 3. 应用云端配置到本地文件
			const configPath = await getSaveStorePath();
			await writeTextFile(
				configPath,
				JSON.stringify(remoteConfigData, null, 2),
			);

			// 4. 重新加载配置到store
			await this.reloadStore();

			return {
				success: true,
				message: "云端配置已应用",
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

		// 2. 移除运行时状态和临时数据
		if (filtered.globalStore?.cloudSync) {
			const { cloudSync } = filtered.globalStore;

			// 移除运行时状态，重新设置为默认值
			cloudSync.lastSyncTime = 0;
			cloudSync.isSyncing = false;

			// WebDAV密码等敏感信息可以选择不同步，或者加密后同步
			// 这里我们保留所有配置，但移除密码（出于安全考虑）
			if (cloudSync.serverConfig) {
				// 不同步密码，密码信息需要用户在每个设备上单独配置
				cloudSync.serverConfig.password = "";
			}
		}

		// 4. 移除剪贴板存储中的临时状态
		if (filtered.clipboardStore?.internalCopy) {
			filtered.clipboardStore.internalCopy = {
				isCopying: false,
				itemId: null,
			};
		}

		// 5. 移除不必要同步的配置项（这些配置通常是设备特定的）
		if (filtered.globalStore?.app) {
			const { app } = filtered.globalStore;
			// autoStart 和 showTaskbarIcon 是平台相关的，不同设备可能有不同设置
			// 保留用户的主观偏好设置
			(app as any).autoStart = undefined;
			(app as any).showTaskbarIcon = undefined;
		}

		return filtered;
	}

	/**
	 * 重新加载配置到store
	 */
	private async reloadStore(): Promise<void> {
		await restoreStore();
	}
}

// 导出单例实例
export const configSync = new ConfigSync();
