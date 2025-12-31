import { invoke } from "@tauri-apps/api/core";

const COMMAND = {
	REGISTER_SHORTCUT: "plugin:eco-hotkey|register_shortcut",
	UNREGISTER_SHORTCUT: "plugin:eco-hotkey|unregister_shortcut",
	UNREGISTER_ALL_SHORTCUTS: "plugin:eco-hotkey|unregister_all_shortcuts",
	REGISTER_DEFAULT_SHORTCUTS: "plugin:eco-hotkey|register_default_shortcuts",
	REGISTER_ALL_SHORTCUTS: "plugin:eco-hotkey|register_all_shortcuts",
	GET_SHORTCUT_STATE: "plugin:eco-hotkey|get_shortcut_state",
};

/**
 * 注册默认快捷键
 * @param clipboardShortcut 显示主窗口的快捷键
 * @param preferenceShortcut 显示偏好设置的快捷键
 */
export const registerDefaultShortcuts = async (
	clipboardShortcut: string,
	preferenceShortcut: string,
): Promise<void> => {
	await invoke(COMMAND.REGISTER_DEFAULT_SHORTCUTS, {
		clipboardShortcut,
		preferenceShortcut,
	});
};

/**
 * 注册所有应用快捷键
 * @param clipboardShortcut 显示主窗口的快捷键
 * @param preferenceShortcut 显示偏好设置的快捷键
 * @param quickPasteShortcuts 快速粘贴的快捷键列表
 */
export const registerAllShortcuts = async (
	clipboardShortcut: string,
	preferenceShortcut: string,
	quickPasteShortcuts: string[],
): Promise<void> => {
	await invoke(COMMAND.REGISTER_ALL_SHORTCUTS, {
		clipboardShortcut,
		preferenceShortcut,
		quickPasteShortcuts,
	});
};

/**
 * 注册单个快捷键
 * @param shortcut 快捷键字符串
 */
export const registerShortcut = async (shortcut: string): Promise<void> => {
	await invoke(COMMAND.REGISTER_SHORTCUT, { shortcut });
};

/**
 * 注销单个快捷键
 * @param shortcut 快捷键字符串
 */
export const unregisterShortcut = async (shortcut: string): Promise<void> => {
	await invoke(COMMAND.UNREGISTER_SHORTCUT, { shortcut });
};

/**
 * 注销所有快捷键
 */
export const unregisterAllShortcuts = async (): Promise<void> => {
	await invoke(COMMAND.UNREGISTER_ALL_SHORTCUTS);
};

/**
 * 获取快捷键状态
 */
export const getShortcutState = async (): Promise<{ shortcuts: string[] }> => {
	return invoke(COMMAND.GET_SHORTCUT_STATE);
};
