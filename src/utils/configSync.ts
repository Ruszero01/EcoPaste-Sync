import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
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
			const configData = JSON.parse(configContent);
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

			let remoteConfigData: any;
			try {
				remoteConfigData = JSON.parse(downloadResult.data);
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
	 * 过滤配置，移除环境相关的字段
	 */
	private filterConfigForSync(config: any): any {
		const filtered = { ...config };

		// 移除环境相关的配置
		if (filtered.globalStore?.env) {
			filtered.globalStore = {
				...filtered.globalStore,
				env: {}, // 清空环境配置
			};
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
