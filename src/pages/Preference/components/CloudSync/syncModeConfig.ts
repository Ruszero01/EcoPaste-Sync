import { SYNC_MODE_PRESETS, type SyncModeConfig } from "@/types/sync.d";

// 配置存储键名
const SYNC_MODE_CONFIG_KEY = "ecopaste-sync-mode-config";

// 获取默认配置
export const getDefaultSyncModeConfig = (): SyncModeConfig => {
	return SYNC_MODE_PRESETS.lightweight;
};

// 保存同步模式配置
export const saveSyncModeConfig = (config: SyncModeConfig): boolean => {
	try {
		localStorage.setItem(SYNC_MODE_CONFIG_KEY, JSON.stringify(config));
		return true;
	} catch (error) {
		console.error("保存同步配置失败:", error);
		return false;
	}
};

// 加载同步模式配置
export const loadSyncModeConfig = (): SyncModeConfig => {
	try {
		const saved = localStorage.getItem(SYNC_MODE_CONFIG_KEY);
		if (saved) {
			return JSON.parse(saved);
		}
	} catch (error) {
		console.error("加载同步配置失败:", error);
	}
	return getDefaultSyncModeConfig();
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
