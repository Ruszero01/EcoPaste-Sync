import { clipboardStore } from "@/stores/clipboard";
import type { WindowLabel } from "@/types/plugin";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const COMMAND = {
	SHOW_WINDOW: "plugin:eco-window|show_window",
	SHOW_WINDOW_WITH_POSITION: "plugin:eco-window|show_window_with_position",
	HIDE_WINDOW: "plugin:eco-window|hide_window",
	SHOW_TASKBAR_ICON: "plugin:eco-window|show_taskbar_icon",
};

/**
 * 显示窗口
 */
export const showWindow = (label?: WindowLabel) => {
	if (label) {
		// 直接调用 Rust 命令，不通过事件系统
		invoke(COMMAND.SHOW_WINDOW);

		// 触发回到顶部事件
		const LISTEN_KEY = {
			ACTIVATE_BACK_TOP: "activate-back-top",
		} as const;
		emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "window-activate");
	} else {
		invoke(COMMAND.SHOW_WINDOW);
	}
};

/**
 * 显示窗口并设置位置
 */
export const showWindowWithPosition = (
	position: string,
	label?: WindowLabel,
) => {
	if (label) {
		// 直接调用 Rust 命令，不通过事件系统
		invoke(COMMAND.SHOW_WINDOW_WITH_POSITION, { position });

		// 触发回到顶部事件
		const LISTEN_KEY = {
			ACTIVATE_BACK_TOP: "activate-back-top",
		} as const;
		emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "window-activate");
	} else {
		invoke(COMMAND.SHOW_WINDOW_WITH_POSITION, { position });
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
		// 获取窗口位置设置
		const windowPosition = clipboardStore.window.position;

		// 根据设置显示窗口
		if (windowPosition === "remember") {
			showWindow("main");
		} else {
			showWindowWithPosition(windowPosition, "main");
		}
	}
};

/**
 * 显示任务栏图标
 */
export const showTaskbarIcon = (visible = true) => {
	invoke(COMMAND.SHOW_TASKBAR_ICON, { visible });
};
