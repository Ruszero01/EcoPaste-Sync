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
	TOGGLE_WINDOW: "plugin:eco-window|toggle_window",
	SHOW_TASKBAR_ICON: "plugin:eco-window|show_taskbar_icon",
	APPLY_MICA_EFFECT: "plugin:eco-window|apply_mica_effect",
	CLEAR_MICA_EFFECT: "plugin:eco-window|clear_mica_effect",
	IS_MICA_SUPPORTED: "plugin:eco-window|is_mica_supported",
	SET_ALWAYS_ON_TOP: "plugin:eco-window|set_window_always_on_top",
};

export { COMMAND };

/**
 * 隐藏窗口（使用窗口行为模式配置）
 * @param label 窗口标签，默认主窗口
 */
export const hideWindow = async (label?: WindowLabel) => {
	const targetLabel = label ?? "main";
	await invoke(COMMAND.TOGGLE_WINDOW, {
		label: targetLabel,
		position_mode: undefined, // 隐藏时不需要位置模式
	});
};

/**
 * 统一窗口切换命令
 * 根据窗口当前状态自动显示或隐藏
 * 显示时遵循位置模式配置，隐藏时遵循行为模式配置
 */
export const toggleWindow = async (
	label?: WindowLabel,
	positionMode?: string,
) => {
	const targetLabel = label ?? "main";
	await invoke(COMMAND.TOGGLE_WINDOW, {
		label: targetLabel,
		position_mode: positionMode ?? clipboardStore.window.position,
	});

	// 触发回到顶部事件
	const LISTEN_KEY = {
		ACTIVATE_BACK_TOP: "activate-back-top",
	} as const;
	emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "window-activate");
};

/**
 * 切换窗口的显示和隐藏（自动检测当前窗口状态）
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
		// 窗口聚焦，隐藏它
		await invoke(COMMAND.TOGGLE_WINDOW, {
			label: "main",
			position_mode: undefined,
		});
	} else {
		// 窗口未聚焦，显示它
		await invoke(COMMAND.TOGGLE_WINDOW, {
			label: "main",
			position_mode: clipboardStore.window.position,
		});
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
 * 设置窗口是否置顶
 */
export const setWindowAlwaysOnTop = async (alwaysOnTop: boolean) => {
	await invoke(COMMAND.SET_ALWAYS_ON_TOP, {
		alwaysOnTop,
		always_on_top: alwaysOnTop,
	});
};
