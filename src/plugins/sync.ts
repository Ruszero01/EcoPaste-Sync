import { invoke } from "@tauri-apps/api/core";
import type { WebDAVConfig } from "./webdav";

// 同步配置 - 使用统一的 WebDAVConfig 类型
export type BackendSyncConfig = WebDAVConfig;

// 同步状态
export interface BackendSyncStatus {
	is_syncing: boolean;
	last_sync_time: number;
	last_sync_result: string;
	error_message?: string;
}

// 自动同步状态
export interface BackendAutoSyncStatus {
	enabled: boolean;
	interval_minutes: number;
	last_sync_time: number;
	next_sync_time: number;
}

// 连接测试结果
export interface BackendConnectionTestResult {
	success: boolean;
	latency_ms: number;
	error_message?: string;
}

// 同步进度
export interface BackendSyncProgress {
	total: number;
	completed: number;
	current_item: string;
	phase: string;
}

const COMMAND = {
	INIT_SYNC: "plugin:eco-sync|init_sync",
	START_SYNC: "plugin:eco-sync|start_sync",
	STOP_SYNC: "plugin:eco-sync|stop_sync",
	GET_SYNC_STATUS: "plugin:eco-sync|get_sync_status",
	TRIGGER_SYNC: "plugin:eco-sync|trigger_sync",
	START_AUTO_SYNC: "plugin:eco-sync|start_auto_sync",
	STOP_AUTO_SYNC: "plugin:eco-sync|stop_auto_sync",
	GET_AUTO_SYNC_STATUS: "plugin:eco-sync|get_auto_sync_status",
	UPDATE_AUTO_SYNC_INTERVAL: "plugin:eco-sync|update_auto_sync_interval",
	TEST_WEBDAV_CONNECTION: "plugin:eco-sync|test_webdav_connection",
	GET_SYNC_PROGRESS: "plugin:eco-sync|get_sync_progress",
	UPDATE_SYNC_CONFIG: "plugin:eco-sync|update_sync_config",
	GET_SYNC_CONFIG: "plugin:eco-sync|get_sync_config",
} as const;

/**
 * 初始化后端同步引擎
 */
export const backendInitSync = (config: BackendSyncConfig) => {
	return invoke<boolean>(COMMAND.INIT_SYNC, { config });
};

/**
 * 开始后端同步
 */
export const backendStartSync = () => {
	return invoke<boolean>(COMMAND.START_SYNC);
};

/**
 * 停止后端同步
 */
export const backendStopSync = () => {
	return invoke<boolean>(COMMAND.STOP_SYNC);
};

/**
 * 获取后端同步状态
 */
export const backendGetSyncStatus = () => {
	return invoke<BackendSyncStatus>(COMMAND.GET_SYNC_STATUS);
};

/**
 * 触发立即同步（同步真实剪贴板数据到云端）
 */
export const backendTriggerSync = (localData: any[]) => {
	return invoke<boolean>(COMMAND.TRIGGER_SYNC, { localData });
};

/**
 * 启动后端自动同步
 */
export const backendStartAutoSync = (intervalMinutes: number) => {
	return invoke<boolean>(COMMAND.START_AUTO_SYNC, { intervalMinutes });
};

/**
 * 停止后端自动同步
 */
export const backendStopAutoSync = () => {
	return invoke<boolean>(COMMAND.STOP_AUTO_SYNC);
};

/**
 * 获取后端自动同步状态
 */
export const backendGetAutoSyncStatus = () => {
	return invoke<BackendAutoSyncStatus>(COMMAND.GET_AUTO_SYNC_STATUS);
};

/**
 * 更新后端自动同步间隔
 */
export const backendUpdateAutoSyncInterval = (intervalMinutes: number) => {
	return invoke<boolean>(COMMAND.UPDATE_AUTO_SYNC_INTERVAL, {
		intervalMinutes,
	});
};

/**
 * 测试后端 WebDAV 连接
 */
export const backendTestWebdavConnection = (config: BackendSyncConfig) => {
	return invoke<BackendConnectionTestResult>(COMMAND.TEST_WEBDAV_CONNECTION, {
		config,
	});
};

/**
 * 获取后端同步进度
 */
export const backendGetSyncProgress = () => {
	return invoke<BackendSyncProgress>(COMMAND.GET_SYNC_PROGRESS);
};

/**
 * 更新后端同步配置
 */
export const backendUpdateSyncConfig = (config: BackendSyncConfig) => {
	return invoke<boolean>(COMMAND.UPDATE_SYNC_CONFIG, { config });
};

/**
 * 获取后端同步配置
 */
export const backendGetSyncConfig = () => {
	return invoke<BackendSyncConfig | null>(COMMAND.GET_SYNC_CONFIG);
};
