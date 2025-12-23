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
	QUERY_HISTORY_WITH_FILTER: "plugin:eco-database|query_history_with_filter",
	QUERY_SYNC_DATA: "plugin:eco-database|query_sync_data",
	UPDATE_SYNC_STATUS: "plugin:eco-database|update_sync_status",
	BATCH_UPDATE_SYNC_STATUS: "plugin:eco-database|batch_update_sync_status",
	UPSERT_FROM_CLOUD: "plugin:eco-database|upsert_from_cloud",
	INSERT_WITH_DEDUPLICATION: "plugin:eco-database|insert_with_deduplication",
	MARK_DELETED: "plugin:eco-database|mark_deleted",
	BATCH_MARK_DELETED: "plugin:eco-database|batch_mark_deleted",
	HARD_DELETE: "plugin:eco-database|hard_delete",
	BATCH_HARD_DELETE: "plugin:eco-database|batch_hard_delete",
	GET_STATISTICS: "plugin:eco-database|get_statistics",
	UPDATE_FAVORITE: "plugin:eco-database|update_favorite",
	BATCH_UPDATE_FAVORITE: "plugin:eco-database|batch_update_favorite",
	UPDATE_NOTE: "plugin:eco-database|update_note",
	UPDATE_CONTENT: "plugin:eco-database|update_content",
	UPDATE_TYPE: "plugin:eco-database|update_type",
	MARK_CHANGED: "plugin:eco-database|mark_changed",
	BATCH_MARK_CHANGED: "plugin:eco-database|batch_mark_changed",
	UPDATE_TIME: "plugin:eco-database|update_time",
	GET_CHANGED_ITEMS_COUNT: "plugin:eco-database|get_changed_items_count",
	GET_CHANGED_ITEMS_LIST: "plugin:eco-database|get_changed_items_list",
	QUERY_WITH_FILTER: "plugin:eco-database|query_with_filter",
	QUERY_FOR_SYNC: "plugin:eco-database|query_for_sync",
	SEARCH_DATA: "plugin:eco-database|search_data",
	QUERY_BY_GROUP: "plugin:eco-database|query_by_group",
	GET_ALL_GROUPS: "plugin:eco-database|get_all_groups",
	GET_FILTERED_STATISTICS: "plugin:eco-database|get_filtered_statistics",
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
 * 查询历史记录（带自定义筛选条件）
 */
export const backendQueryHistoryWithFilter = (options: {
	where_clause?: string;
	order_by?: string;
	limit?: number;
	offset?: number;
}) => {
	return invoke<HistoryItem[]>(COMMAND.QUERY_HISTORY_WITH_FILTER, options);
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
 * 插入数据（带去重功能）
 */
export const backendInsertWithDeduplication = (item: any) => {
	return invoke<{ is_update: boolean; insert_id: string | null }>(
		COMMAND.INSERT_WITH_DEDUPLICATION,
		{
			item,
		},
	);
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
