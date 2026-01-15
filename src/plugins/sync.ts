import { invoke } from "@tauri-apps/api/core";

// 后端同步配置（与 Rust SyncConfig 对应）
export interface BackendSyncConfig {
	server_url: string;
	username: string;
	password: string;
	path: string;
	auto_sync: boolean;
	auto_sync_interval_minutes: number;
	only_favorites: boolean;
	include_images: boolean;
	include_files: boolean;
	timeout: number;
}

// 连接测试结果
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
	is_syncing: boolean;
}

// 连接测试结果
export interface BackendConnectionTestResult {
	success: boolean;
	latency_ms: number;
	error_message?: string;
}

const COMMAND = {
	INIT_SYNC: "plugin:eco-sync|init_sync",
	GET_SYNC_STATUS: "plugin:eco-sync|get_sync_status",
	TRIGGER_SYNC: "plugin:eco-sync|trigger_sync",
	START_AUTO_SYNC: "plugin:eco-sync|start_auto_sync",
	STOP_AUTO_SYNC: "plugin:eco-sync|stop_auto_sync",
	GET_AUTO_SYNC_STATUS: "plugin:eco-sync|get_auto_sync_status",
	UPDATE_AUTO_SYNC_INTERVAL: "plugin:eco-sync|update_auto_sync_interval",
	TEST_WEBDAV_CONNECTION: "plugin:eco-sync|test_webdav_connection",
	UPDATE_SYNC_CONFIG: "plugin:eco-sync|update_sync_config",
	UPLOAD_LOCAL_CONFIG: "plugin:eco-sync|upload_local_config",
	APPLY_REMOTE_CONFIG: "plugin:eco-sync|apply_remote_config",
	// 服务器配置本地管理命令（不参与云同步）
	SAVE_SERVER_CONFIG: "plugin:eco-sync|save_server_config",
	LOAD_SERVER_CONFIG: "plugin:eco-sync|load_server_config",
} as const;

/**
 * 初始化后端同步引擎
 */
export const backendInitSync = (config: BackendSyncConfig) => {
	return invoke<{ success: boolean; message: string }>(COMMAND.INIT_SYNC, {
		config,
	});
};

/**
 * 获取后端同步状态
 */
export const backendGetSyncStatus = () => {
	return invoke<BackendSyncStatus>(COMMAND.GET_SYNC_STATUS);
};

/**
 * 触发立即同步（后端直接从数据库读取数据，无需前端传参）
 */
export const backendTriggerSync = () => {
	return invoke<{ success: boolean; message: string }>(COMMAND.TRIGGER_SYNC);
};

/**
 * 启动后端自动同步
 */
export const backendStartAutoSync = (intervalMinutes: number) => {
	return invoke<{ success: boolean; message: string }>(
		COMMAND.START_AUTO_SYNC,
		{ intervalMinutes },
	);
};

/**
 * 停止后端自动同步
 */
export const backendStopAutoSync = () => {
	return invoke<{ success: boolean; message: string }>(COMMAND.STOP_AUTO_SYNC);
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
	return invoke<{ success: boolean; message: string }>(
		COMMAND.UPDATE_AUTO_SYNC_INTERVAL,
		{
			intervalMinutes,
		},
	);
};

/**
 * 测试后端 WebDAV 连接（使用后端已初始化的同步引擎）
 */
export const backendTestWebdavConnection = () => {
	return invoke<BackendConnectionTestResult>(COMMAND.TEST_WEBDAV_CONNECTION);
};

/**
 * 更新后端同步配置
 */
export const backendUpdateSyncConfig = (config: BackendSyncConfig) => {
	return invoke<{ success: boolean; message: string }>(
		COMMAND.UPDATE_SYNC_CONFIG,
		{ config },
	);
};

/**
 * 上传本地配置到云端
 */
export const backendUploadLocalConfig = () => {
	return invoke<{ success: boolean; message: string }>(
		COMMAND.UPLOAD_LOCAL_CONFIG,
	);
};

/**
 * 应用云端配置
 */
export const backendApplyRemoteConfig = () => {
	return invoke<{ success: boolean; message: string }>(
		COMMAND.APPLY_REMOTE_CONFIG,
	);
};

// ================================
// 服务器配置本地管理命令（不参与云同步）
// ================================

/**
 * 服务器配置数据类型
 */
export interface BackendServerConfigData {
	url: string;
	username: string;
	password: string;
	path: string;
	timeout: number;
}

/**
 * 保存服务器配置到单独文件
 */
export const backendSaveServerConfig = (config: BackendServerConfigData) => {
	return invoke<{ type: "Success" } | { type: "Error"; data: string }>(
		COMMAND.SAVE_SERVER_CONFIG,
		{ config },
	);
};

/**
 * 从单独文件加载服务器配置
 */
export const backendLoadServerConfig = () => {
	return invoke<BackendServerConfigData>(COMMAND.LOAD_SERVER_CONFIG);
};
