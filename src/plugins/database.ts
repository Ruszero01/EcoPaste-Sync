import { invoke } from "@tauri-apps/api/core";

// 数据库配置接口
export interface DatabaseConfig {
	save_data_dir: string;
	app_name: string;
	is_dev: boolean;
}

// 历史记录项
export interface HistoryItem {
	id: string;
	item_type?: string;
	group?: string;
	value?: string;
	search?: string;
	count?: number;
	width?: number;
	height?: number;
	favorite: number;
	create_time: number;
	note?: string;
	subtype?: string;
	lazy_download?: boolean;
	file_size?: number;
	file_type?: string;
	deleted?: boolean;
	sync_status?: string;
	is_cloud_data?: boolean;
	code_language?: string;
	is_code?: number;
	last_modified?: number;
	source_app_name?: string;
	source_app_icon?: string;
	position?: number;
}

// 同步数据项
export interface SyncDataItem {
	id: string;
	item_type: string;
	checksum: string;
	value: string;
	favorite: boolean;
	note?: string;
	create_time: number;
	last_modified?: number;
	device_id?: string;
	sync_status?: string;
	deleted?: boolean;
}

// 数据库统计信息
export interface DatabaseStatistics {
	total_items: number;
	active_items: number;
	synced_items: number;
	favorite_items: number;
}

const COMMAND = {
	SET_DATABASE_PATH: "plugin:eco-database|set_database_path",
	QUERY_HISTORY: "plugin:eco-database|query_history",
	QUERY_SYNC_DATA: "plugin:eco-database|query_sync_data",
	UPDATE_SYNC_STATUS: "plugin:eco-database|update_sync_status",
	BATCH_UPDATE_SYNC_STATUS: "plugin:eco-database|batch_update_sync_status",
	UPSERT_FROM_CLOUD: "plugin:eco-database|upsert_from_cloud",
	MARK_DELETED: "plugin:eco-database|mark_deleted",
	GET_STATISTICS: "plugin:eco-database|get_statistics",
} as const;

/**
 * 设置数据库路径并初始化 - 后端自动获取路径
 */
export const backendSetDatabasePath = () => {
	return invoke<void>(COMMAND.SET_DATABASE_PATH, {});
};

/**
 * 查询历史记录
 */
export const backendQueryHistory = (options: {
	only_favorites: boolean;
	exclude_deleted: boolean;
	limit?: number;
	offset?: number;
}) => {
	return invoke<HistoryItem[]>(COMMAND.QUERY_HISTORY, options);
};

/**
 * 查询同步数据
 */
export const backendQuerySyncData = (
	only_favorites: boolean,
	limit?: number,
) => {
	return invoke<SyncDataItem[]>(COMMAND.QUERY_SYNC_DATA, {
		onlyFavorites: only_favorites,
		limit,
	});
};

/**
 * 更新同步状态
 */
export const backendUpdateSyncStatus = (id: string, status: string) => {
	return invoke<void>(COMMAND.UPDATE_SYNC_STATUS, {
		id,
		status,
	});
};

/**
 * 批量更新同步状态
 */
export const backendBatchUpdateSyncStatus = (ids: string[], status: string) => {
	return invoke<number>(COMMAND.BATCH_UPDATE_SYNC_STATUS, {
		ids,
		status,
	});
};

/**
 * 从云端插入或更新数据
 */
export const backendUpsertFromCloud = (item: SyncDataItem) => {
	return invoke<void>(COMMAND.UPSERT_FROM_CLOUD, {
		item,
	});
};

/**
 * 标记删除
 */
export const backendMarkDeleted = (id: string) => {
	return invoke<void>(COMMAND.MARK_DELETED, {
		id,
	});
};

/**
 * 获取统计信息
 */
export const backendGetStatistics = () => {
	return invoke<DatabaseStatistics>(COMMAND.GET_STATISTICS);
};
