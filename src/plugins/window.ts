import { clipboardStore } from "@/stores/clipboard";
import type { WindowLabel } from "@/types/plugin";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

// 检查是否在Tauri环境中运行
const isTauriEnvironment = () => {
	try {
		// 检查能否访问Tauri API
		return (
			(typeof window !== "undefined" &&
				(window as any).__TAURI__ !== undefined) ||
			window.location.protocol === "tauri:" ||
			// 尝试检查Tauri核心API是否可用
			typeof invoke === "function"
		);
	} catch {
		return false;
	}
};

const COMMAND = {
	SHOW_WINDOW: "plugin:eco-window|show_window",
	SHOW_WINDOW_WITH_POSITION: "plugin:eco-window|show_window_with_position",
	DESTROY_WINDOW: "plugin:eco-window|destroy_window",
	SHOW_TASKBAR_ICON: "plugin:eco-window|show_taskbar_icon",
	SHOW_MAIN_WINDOW: "plugin:eco-window|show_main_window",
	SHOW_PREFERENCE_WINDOW: "plugin:eco-window|show_preference_window",
	APPLY_MICA_EFFECT: "plugin:eco-window|apply_mica_effect",
	CLEAR_MICA_EFFECT: "plugin:eco-window|clear_mica_effect",
	IS_MICA_SUPPORTED: "plugin:eco-window|is_mica_supported",
	CREATE_WINDOW: "plugin:eco-window|create_window",
	HIDE_WINDOW_WITH_BEHAVIOR: "plugin:eco-window|hide_window_with_behavior",
};

/**
 * 显示窗口
 */
export const showWindow = (label?: WindowLabel) => {
	// 获取窗口位置设置
	const windowPosition = clipboardStore.window.position;

	if (label) {
		// 根据标签调用相应的命令
		if (label === "main") {
			invoke(COMMAND.SHOW_MAIN_WINDOW, { position_mode: windowPosition });
		} else if (label === "preference") {
			invoke(COMMAND.SHOW_PREFERENCE_WINDOW, { position_mode: windowPosition });
		} else {
			// 如果没有匹配的标签，默认显示主窗口
			invoke(COMMAND.SHOW_MAIN_WINDOW, { position_mode: windowPosition });
		}

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
		invoke(COMMAND.SHOW_WINDOW_WITH_POSITION, { position, label });

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
 * 销毁当前窗口
 */
export const destroyWindow = async () => {
	invoke(COMMAND.DESTROY_WINDOW);
};

/**
 * 隐藏窗口（已废弃，请使用 destroyWindow）
 * TODO: 后续迁移到后端统一处理
 */
export const hideWindow = async () => {
	destroyWindow();
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

/**
 * 检查是否支持 Mica 效果
 */
export const isMicaSupported = async (): Promise<boolean> => {
	try {
		return await invoke<boolean>(COMMAND.IS_MICA_SUPPORTED);
	} catch {
		return false;
	}
};

/**
 * 应用 Mica 材质效果
 */
export const applyMicaEffect = async (darkMode?: boolean) => {
	try {
		await invoke(COMMAND.APPLY_MICA_EFFECT, { darkMode: darkMode ?? true });
	} catch (_error) {
		// Silently fail for non-Windows platforms or unsupported cases
	}
};

/**
 * 清除 Mica 材质效果
 */
export const clearMicaEffect = async () => {
	try {
		await invoke(COMMAND.CLEAR_MICA_EFFECT);
	} catch (error) {
		console.error("Failed to clear Mica effect:", error);
		throw error;
	}
};

/**
 * 初始化 Mica 效果（仅在支持的平台上）
 */
export const initializeMicaEffect = async () => {
	const supported = await isMicaSupported();

	if (supported && isTauriEnvironment()) {
		await applyMicaEffect(globalStore.appearance.isDark);
	}
};

/**
 * 更新 Mica 主题（亮色/暗色模式）
 */
export const updateMicaTheme = async (isDark: boolean) => {
	const supported = await isMicaSupported();

	if (supported && isTauriEnvironment()) {
		await applyMicaEffect(isDark);
	}
};

/**
 * 根据窗口行为模式隐藏或销毁窗口
 * 窗口行为设置从配置文件中读取
 * @param label 窗口标签
 */
export const hideWindowWithBehavior = async (label: string) => {
	invoke(COMMAND.HIDE_WINDOW_WITH_BEHAVIOR, { label });
};
