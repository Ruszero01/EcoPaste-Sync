// 同步数据包结构
export interface SyncData {
	version: number; // 同步协议版本
	timestamp: number; // 数据时间戳
	deviceId: string; // 设备唯一标识
	dataType: "full" | "incremental"; // 数据类型
	items: SyncItem[]; // 同步项列表
	deleted: string[]; // 已删除项ID列表
	compression?: "gzip" | "none"; // 压缩类型
	checksum?: string; // 数据校验和
}

// 同步项结构
export interface SyncItem {
	id: string; // 剪贴板项ID
	type: "text" | "image" | "files" | "html" | "rtf";
	group: "text" | "image" | "files";
	value: string; // 文本内容或文件引用
	search: string; // 搜索关键词
	count: number; // 使用次数
	width?: number; // 图片宽度
	height?: number; // 图片高度
	favorite: boolean; // 是否收藏
	createTime: string; // 创建时间
	note?: string; // 备注
	subtype?: string; // 子类型
	lastModified: number; // 最后修改时间
	deviceId: string; // 创建设备ID
	size?: number; // 数据大小
	checksum?: string; // 数据校验和
}

// 同步元数据
export interface SyncMetadata {
	lastSyncTime: number; // 最后同步时间
	deviceId: string; // 设备ID
	syncVersion: number; // 同步版本号
	conflictResolution: "local" | "remote" | "merge" | "prompt"; // 冲突解决策略
	networkQuality: "high" | "medium" | "low"; // 网络质量评估
	performanceMetrics: {
		avgUploadSpeed: number; // 平均上传速度
		avgDownloadSpeed: number; // 平均下载速度
		avgLatency: number; // 平均延迟
	};
}

// 同步配置
export interface SyncConfig {
	enabled: boolean; // 是否启用同步
	autoSync: boolean; // 自动同步
	syncInterval: number; // 同步间隔(毫秒)
	conflictResolution: "local" | "remote" | "merge" | "prompt"; // 冲突解决策略
	encryption: boolean; // 是否加密
	compression: boolean; // 是否压缩
	maxRetries: number; // 最大重试次数
	retryInterval: number; // 重试间隔
}

// 同步状态
export interface SyncStatus {
	isOnline: boolean; // 网络状态
	isSyncing: boolean; // 是否正在同步
	lastSyncTime: number; // 最后同步时间
	pendingCount: number; // 待同步数量
	errorCount: number; // 错误次数
	syncProgress: number; // 同步进度
	lastError?: string; // 最后错误信息
}

// 同步操作
export interface SyncOperation {
	id: string;
	type: "create" | "update" | "delete";
	data: SyncItem;
	timestamp: number;
	retryCount: number;
}

// 冲突信息
export interface ConflictInfo {
	itemId: string;
	type: "modify" | "delete" | "create";
	localVersion: SyncItem;
	remoteVersion: SyncItem;
	resolution: "local" | "remote" | "merge" | "prompt";
	reason: string;
}

// WebDAV 文件信息
export interface WebDAVFileInfo {
	name: string;
	path: string;
	size: number;
	lastModified: Date;
	isDirectory: boolean;
	etag?: string;
}

// 同步结果
export interface SyncResult {
	success: boolean;
	uploaded: number;
	downloaded: number;
	conflicts: ConflictInfo[];
	errors: string[];
	duration: number;
	timestamp: number;
}
