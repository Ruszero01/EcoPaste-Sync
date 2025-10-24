import type { WindowLabel } from "@/types/plugin";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const COMMAND = {
	SHOW_WINDOW: "plugin:eco-window|show_window",
	HIDE_WINDOW: "plugin:eco-window|hide_window",
	SHOW_TASKBAR_ICON: "plugin:eco-window|show_taskbar_icon",
};

/**
 * 显示窗口
 */
export const showWindow = (label?: WindowLabel) => {
	if (label) {
		// 使用正确的LISTEN_KEY常量
		const LISTEN_KEY = {
			SHOW_WINDOW: "show-window",
			ACTIVATE_BACK_TOP: "activate-back-top",
		} as const;

		emit(LISTEN_KEY.SHOW_WINDOW, label);
		// 同时触发回到顶部事件
		emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "window-activate");
	} else {
		invoke(COMMAND.SHOW_WINDOW);
	}
};

/**
 * 隐藏窗口
 */
export const hideWindow = () => {
	invoke(COMMAND.HIDE_WINDOW);
};

/**
 * 切换窗口的显示和隐藏
 */
export const toggleWindowVisible = async () => {
	const appWindow = getCurrentWebviewWindow();

	let focused = await appWindow.isFocused();

	if (typeof window !== "undefined" && (window as any).__TAURI__) {
		// Running in Tauri environment
		if ((globalThis as any).isLinux) {
			focused = await appWindow.isVisible();
		}
	}

	if (focused) {
		hideWindow();
	} else {
		// 直接调用 showWindow("main")，和托盘图标保持一致的方式
		showWindow("main");
	}
};

/**
 * 显示任务栏图标
 */
export const showTaskbarIcon = (visible = true) => {
	invoke(COMMAND.SHOW_TASKBAR_ICON, { visible });
};
