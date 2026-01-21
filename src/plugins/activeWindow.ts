import { invoke } from "@tauri-apps/api/core";

const COMMAND = {
	GET_CURRENT_WINDOW: "plugin:eco-common|get_current_window_info",
	GET_LAST_WINDOW: "plugin:eco-common|get_last_window_info",
	GET_FOREGROUND_WINDOW: "plugin:eco-common|get_foreground_window_info",
};

/**
 * 前台窗口信息（与后端字段名一致）
 */
export interface ForegroundWindowInfo {
	hwnd: number;
	process_name: string;
	window_title: string;
}

/**
 * 获取当前前台窗口信息
 */
export const getCurrentWindowInfo =
	async (): Promise<ForegroundWindowInfo | null> => {
		try {
			return await invoke(COMMAND.GET_CURRENT_WINDOW);
		} catch {
			return null;
		}
	};

/**
 * 获取上一个有效窗口信息（过滤掉 EcoPaste 自身）
 */
export const getLastWindowInfo =
	async (): Promise<ForegroundWindowInfo | null> => {
		try {
			return await invoke(COMMAND.GET_LAST_WINDOW);
		} catch {
			return null;
		}
	};

/**
 * 获取当前显示的窗口（如果当前是 EcoPaste 则返回上一个，否则返回当前）
 */
export const getForegroundWindowInfo =
	async (): Promise<ForegroundWindowInfo | null> => {
		try {
			return await invoke(COMMAND.GET_FOREGROUND_WINDOW);
		} catch {
			return null;
		}
	};
