import type { SyncModeConfig } from "@/types/sync.d";

// 配置存储键名
const SYNC_MODE_CONFIG_KEY = "ecopaste-sync-mode-config";

// 获取默认配置（双开关模式）
export const getDefaultSyncModeConfig = (): SyncModeConfig => {
	return {
		settings: {
			includeText: true, // 总是启用
			includeHtml: true, // 总是启用
			includeRtf: true, // 总是启用
			includeImages: false, // 文件模式开关，默认关闭
			includeFiles: false, // 文件模式开关，默认关闭
			onlyFavorites: false, // 收藏模式开关，默认关闭
		},
	};
};

// 保存同步模式配置
export const saveSyncModeConfig = (config: SyncModeConfig): boolean => {
	try {
		localStorage.setItem(SYNC_MODE_CONFIG_KEY, JSON.stringify(config));
		return true;
	} catch (error) {
		console.error("保存同步配置失败:", {
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
};

// 加载同步模式配置
export const loadSyncModeConfig = (): SyncModeConfig => {
	try {
		const saved = localStorage.getItem(SYNC_MODE_CONFIG_KEY);
		if (saved) {
			const config = JSON.parse(saved);
			return config;
		}
	} catch (error) {
		console.error("加载同步配置失败:", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const defaultConfig = getDefaultSyncModeConfig();
	return defaultConfig;
};

// 重置同步模式配置为默认值
export const resetSyncModeConfig = (): boolean => {
	try {
		const defaultConfig = getDefaultSyncModeConfig();
		return saveSyncModeConfig(defaultConfig);
	} catch (error) {
		console.error("重置同步配置失败:", error);
		return false;
	}
};
