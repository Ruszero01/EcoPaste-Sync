import type { BookmarkGroup } from "@/types/sync";
import { invoke } from "@tauri-apps/api/core";

const COMMAND = {
	LOAD_BOOKMARK_DATA: "plugin:eco-sync|load_bookmark_data",
	SAVE_BOOKMARK_DATA: "plugin:eco-sync|save_bookmark_data",
	ADD_BOOKMARK_GROUP: "plugin:eco-sync|add_bookmark_group",
	UPDATE_BOOKMARK_GROUP: "plugin:eco-sync|update_bookmark_group",
	DELETE_BOOKMARK_GROUP: "plugin:eco-sync|delete_bookmark_group",
	REORDER_BOOKMARK_GROUPS: "plugin:eco-sync|reorder_bookmark_groups",
	CLEAR_BOOKMARK_DATA: "plugin:eco-sync|clear_bookmark_data",
};

export interface BookmarkData {
	last_modified: number;
	groups: BookmarkGroup[];
}

/**
 * 加载本地书签数据
 */
export const loadBookmarkData = async (): Promise<BookmarkData> => {
	return invoke(COMMAND.LOAD_BOOKMARK_DATA);
};

/**
 * 保存本地书签数据
 */
export const saveBookmarkData = (data: BookmarkData): Promise<boolean> => {
	return invoke(COMMAND.SAVE_BOOKMARK_DATA, { data });
};

/**
 * 添加书签分组
 */
export const addBookmarkGroup = async (
	name: string,
	color: string,
): Promise<BookmarkGroup> => {
	return invoke(COMMAND.ADD_BOOKMARK_GROUP, { name, color });
};

/**
 * 更新书签分组
 */
export const updateBookmarkGroup = async (
	id: string,
	name?: string,
	color?: string,
): Promise<BookmarkGroup> => {
	return invoke(COMMAND.UPDATE_BOOKMARK_GROUP, { id, name, color });
};

/**
 * 删除书签分组
 */
export const deleteBookmarkGroup = async (id: string): Promise<boolean> => {
	return invoke(COMMAND.DELETE_BOOKMARK_GROUP, { id });
};

/**
 * 重新排序书签分组
 */
export const reorderBookmarkGroups = async (
	groups: BookmarkGroup[],
): Promise<boolean> => {
	return invoke(COMMAND.REORDER_BOOKMARK_GROUPS, { groups });
};

/**
 * 清空书签数据（仅开发模式使用）
 */
export const clearBookmarkData = async (): Promise<boolean> => {
	return invoke(COMMAND.CLEAR_BOOKMARK_DATA);
};
