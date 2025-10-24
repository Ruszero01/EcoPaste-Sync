import { invoke } from "@tauri-apps/api/core";

export interface WebDAVConfig {
	url: string;
	username: string;
	password: string;
	path: string;
	timeout: number;
}

export interface ConnectionTestResult {
	success: boolean;
	latency_ms: number;
	status_code?: number;
	error_message?: string;
	server_info?: string;
}

export interface WebDAVTestResult {
	success: boolean;
	operations: Record<string, OperationResult>;
	error_message?: string;
}

export interface OperationResult {
	success: boolean;
	duration_ms: number;
	error_message?: string;
}

export interface FileUploadResult {
	success: boolean;
	path: string;
	size: number;
	duration_ms: number;
	error_message?: string;
}

export interface FileDownloadResult {
	success: boolean;
	path: string;
	size: number;
	duration_ms: number;
	data?: string;
	error_message?: string;
}

const COMMAND = {
	SET_SERVER_CONFIG: "plugin:eco-webdav|set_server_config",
	GET_SERVER_CONFIG: "plugin:eco-webdav|get_server_config",
	TEST_CONNECTION: "plugin:eco-webdav|test_connection",
	TEST_WEBDAV_OPERATIONS: "plugin:eco-webdav|test_webdav_operations",
	CREATE_DIRECTORY: "plugin:eco-webdav|create_directory",
	UPLOAD_SYNC_DATA: "plugin:eco-webdav|upload_sync_data",
	DOWNLOAD_SYNC_DATA: "plugin:eco-webdav|download_sync_data",
} as const;

/**
 * 设置WebDAV服务器配置
 */
export const setServerConfig = (config: WebDAVConfig) => {
	return invoke<void>(COMMAND.SET_SERVER_CONFIG, { config });
};

/**
 * 获取WebDAV服务器配置
 */
export const getServerConfig = () => {
	return invoke<WebDAVConfig | undefined>(COMMAND.GET_SERVER_CONFIG);
};

/**
 * 测试WebDAV连接
 */
export const testConnection = (config: WebDAVConfig) => {
	return invoke<ConnectionTestResult>(COMMAND.TEST_CONNECTION, { config });
};

/**
 * 测试WebDAV操作
 */
export const testWebDAVOperations = (config: WebDAVConfig) => {
	return invoke<WebDAVTestResult>(COMMAND.TEST_WEBDAV_OPERATIONS, { config });
};

/**
 * 创建目录
 */
export const createDirectory = (config: WebDAVConfig, dirPath: string) => {
	return invoke<boolean>(COMMAND.CREATE_DIRECTORY, { config, dirPath });
};

/**
 * 上传同步数据
 */
export const uploadSyncData = (
	config: WebDAVConfig,
	filePath: string,
	content: string,
) => {
	return invoke<FileUploadResult>(COMMAND.UPLOAD_SYNC_DATA, {
		config,
		filePath,
		content,
	});
};

/**
 * 下载同步数据
 */
export const downloadSyncData = (config: WebDAVConfig, filePath: string) => {
	return invoke<FileDownloadResult>(COMMAND.DOWNLOAD_SYNC_DATA, {
		config,
		filePath,
	});
};
