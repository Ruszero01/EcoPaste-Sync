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
	QUERY_HISTORY_WITH_FILTER: "plugin:eco-database|query_history_with_filter",
	DELETE_ITEMS: "plugin:eco-database|delete_items",
	UPDATE_FIELD: "plugin:eco-database|update_field",
	CLEANUP_HISTORY: "plugin:eco-database|cleanup_history",
	RESET_DATABASE: "plugin:eco-database|reset_database",
	QUERY_HISTORY: "plugin:eco-database|query_history",
	INSERT_WITH_DEDUPLICATION: "plugin:eco-database|insert_with_deduplication",
	GET_STATISTICS: "plugin:eco-database|get_statistics",
} as const;

/**
 * 查询历史记录（带自定义筛选条件）
 */
export const backendQueryHistoryWithFilter = (options: {
	where_clause?: string;
	params?: string[];
}) => {
	return invoke<HistoryItem[]>(COMMAND.QUERY_HISTORY_WITH_FILTER, {
		args: options,
	});
};

/**
 * 批量删除项目（支持单个或批量）
 * 根据同步状态决定删除方式：
 * - 已同步 (sync_status == "synced")：软删除，标记 deleted=1
 * - 未同步 (sync_status != "synced")：硬删除，直接从数据库删除
 */
export const backendDeleteItems = (ids: string[]) => {
	return invoke<DeleteResult>(COMMAND.DELETE_ITEMS, { ids });
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

/**
 * 重置数据库（调试用）
 */
export const backendResetDatabase = () => {
	return invoke<boolean>(COMMAND.RESET_DATABASE, {});
};
