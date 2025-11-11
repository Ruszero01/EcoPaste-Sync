// ================================
// 统一的剪贴板项类型定义
// ================================

/**
 * 剪贴板项基础类型
 * 包含所有剪贴板项共有的核心字段
 */
export interface BaseClipboardItem {
	id: string;
	type: "text" | "image" | "files" | "html" | "rtf";
	group: "text" | "image" | "files";
	value: string; // 文本内容或文件引用
	search: string; // 搜索关键词
	width?: number; // 图片宽度
	height?: number; // 图片高度
	favorite: boolean; // 是否收藏
	createTime: string; // 创建时间
	note?: string; // 备注
	subtype?: string; // 子类型
	size?: number; // 数据大小
	checksum?: string; // 数据校验和
	deleted?: boolean; // 软删除标识
}

// ================================
// 本地和同步专用类型
// ================================

/**
 * 本地历史项类型
 * 用于本地数据库存储，扩展基础类型添加本地相关字段
 */
export interface HistoryItem extends BaseClipboardItem {
	count?: number; // 使用次数
	lastModified?: number; // 最后修改时间
	deviceId?: string; // 创建设备ID
}

/**
 * 同步项类型
 * 用于云端同步，扩展基础类型添加同步相关字段
 */
export interface SyncItem extends BaseClipboardItem {
	count: number; // 使用次数（同步时必需）
	lastModified: number; // 最后修改时间（同步时必需）
	deviceId: string; // 创建设备ID（同步时必需）

	// 同步专用字段
	_syncType?: string; // 同步类型标识
	_originalPath?: string; // 原始路径
	_originalSize?: number; // 原始大小
	_compressedSize?: number; // 压缩后大小
	_originalFiles?: Array<{
		// 原始文件信息
		originalPath: string;
		webdavPath: string;
		originalSize: number;
		compressedSize: number;
	}>;
	files?: Array<{
		// 文件数组信息
		name: string;
		data: string;
		_syncType?: string;
	}>;
	// 按需下载标识
	lazyDownload?: boolean; // 是否需要按需下载
	fileSize?: number; // 原始文件大小（用于下载提示）
	fileType?: string; // 文件类型
}

// ================================
// 类型转换工具
// ================================

/**
 * 将 HistoryItem 转换为 SyncItem
 * @param historyItem 历史项
 * @param deviceId 设备ID（可选）
 * @returns 同步项
 */
export const HistoryToSync = (
	historyItem: HistoryItem,
	deviceId?: string,
): SyncItem => {
	return {
		...historyItem,
		count: historyItem.count || 0,
		lastModified: historyItem.lastModified || Date.now(),
		deviceId: historyItem.deviceId || deviceId || "",
	};
};

/**
 * 将 SyncItem 转换为 HistoryItem
 * @param syncItem 同步项
 * @returns 历史项
 */
export const SyncToHistory = (syncItem: SyncItem): HistoryItem => {
	const {
		_syncType,
		_originalPath,
		_originalSize,
		_compressedSize,
		_originalFiles,
		files,
		lazyDownload,
		fileSize,
		fileType,
		...historyFields
	} = syncItem;

	return {
		...historyFields,
		count: syncItem.count,
		lastModified: syncItem.lastModified,
		deviceId: syncItem.deviceId,
	};
};

/**
 * 将 SyncItem 转换为轻量级数据（用于差异检测）
 * @param syncItem 同步项
 * @returns 轻量级数据
 */
export const SyncToLightweight = (
	syncItem: SyncItem,
): Omit<HistoryItem, "width" | "height" | "subtype"> => {
	return {
		id: syncItem.id,
		type: syncItem.type,
		group: syncItem.group,
		value: syncItem.value,
		search: syncItem.search,
		favorite: syncItem.favorite,
		createTime: syncItem.createTime,
		note: syncItem.note,
		lastModified: syncItem.lastModified,
		deviceId: syncItem.deviceId,
		size: syncItem.size,
		checksum: syncItem.checksum,
		deleted: syncItem.deleted,
		count: syncItem.count,
	};
};

// ================================
// 同步数据结构
// ================================

// 同步数据包结构
export interface SyncData {
	timestamp: number; // 数据时间戳
	deviceId: string; // 设备唯一标识
	dataType: "full" | "incremental"; // 数据类型
	items: SyncItem[]; // 同步项列表
	deleted: string[]; // 已删除项ID列表
	compression?: "gzip" | "none"; // 压缩类型
	checksum?: string; // 数据校验和
}

// 统一的云端同步索引
export interface CloudSyncIndex {
	format: "unified";
	timestamp: number;
	deviceId: string;
	lastSyncTime: number;
	conflictResolution: "local" | "remote" | "merge" | "prompt";
	networkQuality: "high" | "medium" | "low";
	performanceMetrics: {
		avgUploadSpeed: number;
		avgDownloadSpeed: number;
		avgLatency: number;
	};
	items: CloudItemFingerprint[];
	totalItems: number;
	dataChecksum: string;
	deletedItems: string[];
	statistics: {
		typeCounts: Record<string, number>;
		totalSize: number;
		favoriteCount: number;
		lastModified: number;
	};
}

// 云端项目指纹
export interface CloudItemFingerprint {
	id: string;
	type: "text" | "image" | "files" | "html" | "rtf";
	checksum: string;
	favoriteChecksum?: string;
	size: number;
	timestamp: number;
	favorite: boolean;
	deleted?: boolean;
	note?: string;
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

// 同步差异结果
export interface SyncDiffResult {
	added: CloudItemFingerprint[];
	modified: CloudItemFingerprint[];
	favoriteChanged: CloudItemFingerprint[];
	deleted: string[];
	toDownload: CloudItemFingerprint[];
	unchanged: string[];
	statistics: {
		totalLocal: number;
		totalRemote: number;
		conflicts: number;
	};
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

// 同步模式类型
export type SyncMode = "lightweight" | "full" | "favorites";

// 同步模式配置
export interface SyncModeConfig {
	mode: SyncMode;

	// 文件大小限制（仅在需要时生效）
	fileLimits?: {
		maxImageSize: number; // 5MB
		maxFileSize: number; // 10MB
		maxPackageSize: number; // 50MB
	};

	// 模式特定设置
	settings: {
		includeText: boolean; // 是否包含文本
		includeHtml: boolean; // 是否包含HTML
		includeRtf: boolean; // 是否包含富文本
		includeImages: boolean; // 是否包含图片
		includeFiles: boolean; // 是否包含文件
		onlyFavorites: boolean; // 仅同步收藏内容
	};
}

// 同步模式预设配置
export const SYNC_MODE_PRESETS: Record<SyncMode, SyncModeConfig> = {
	lightweight: {
		mode: "lightweight",
		settings: {
			includeText: true,
			includeHtml: true,
			includeRtf: true,
			includeImages: false,
			includeFiles: false,
			onlyFavorites: false,
		},
	},
	full: {
		mode: "full",
		fileLimits: {
			maxImageSize: 5,
			maxFileSize: 10,
			maxPackageSize: 50,
		},
		settings: {
			includeText: true,
			includeHtml: true,
			includeRtf: true,
			includeImages: true,
			includeFiles: true,
			onlyFavorites: false,
		},
	},
	favorites: {
		mode: "favorites",
		fileLimits: {
			maxImageSize: 5,
			maxFileSize: 10,
			maxPackageSize: 50,
		},
		settings: {
			includeText: true,
			includeHtml: true,
			includeRtf: true,
			includeImages: true,
			includeFiles: true,
			onlyFavorites: true,
		},
	},
};
