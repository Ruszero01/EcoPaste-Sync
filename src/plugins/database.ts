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
	time: number;
	note?: string;
	subtype?: string;
	fileSize?: number;
	deleted?: boolean;
	syncStatus?: string;
	sourceAppName?: string;
	sourceAppIcon?: string;
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
	time: number;
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

// 清理规则
export interface CleanupRule {
	// 保留天数，0 表示不限制
	retain_days: number;
	// 保留条数，0 表示不限制
	retain_count: number;
}

const COMMAND = {
	SET_DATABASE_PATH: "plugin:eco-database|set_database_path",
	QUERY_HISTORY: "plugin:eco-database|query_history",
	QUERY_HISTORY_WITH_FILTER: "plugin:eco-database|query_history_with_filter",
	INSERT_WITH_DEDUPLICATION: "plugin:eco-database|insert_with_deduplication",
	MARK_DELETED: "plugin:eco-database|mark_deleted",
	BATCH_MARK_DELETED: "plugin:eco-database|batch_mark_deleted",
	HARD_DELETE: "plugin:eco-database|hard_delete",
	BATCH_HARD_DELETE: "plugin:eco-database|batch_hard_delete",
	GET_STATISTICS: "plugin:eco-database|get_statistics",
	UPDATE_FIELD: "plugin:eco-database|update_field",
	MARK_CHANGED: "plugin:eco-database|mark_changed",
	BATCH_MARK_CHANGED: "plugin:eco-database|batch_mark_changed",
	GET_CHANGED_ITEMS_COUNT: "plugin:eco-database|get_changed_items_count",
	GET_CHANGED_ITEMS_LIST: "plugin:eco-database|get_changed_items_list",
	QUERY_WITH_FILTER: "plugin:eco-database|query_with_filter",
	SEARCH_DATA: "plugin:eco-database|search_data",
	QUERY_BY_GROUP: "plugin:eco-database|query_by_group",
	GET_ALL_GROUPS: "plugin:eco-database|get_all_groups",
	GET_FILTERED_STATISTICS: "plugin:eco-database|get_filtered_statistics",
	CLEANUP_HISTORY: "plugin:eco-database|cleanup_history",
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

/**
 * 统一字段更新
 * 通过 field 和 value 参数决定更新哪个字段
 */
export const backendUpdateField = (
	id: string,
	field: string,
	value: string,
) => {
	return invoke<void>(COMMAND.UPDATE_FIELD, {
		id,
		field,
		value,
	});
};

/**
 * 执行历史记录清理（后台自动清理）
 */
export const backendCleanupHistory = (rule: CleanupRule) => {
	return invoke<void>(COMMAND.CLEANUP_HISTORY, {
		rule,
	});
};
