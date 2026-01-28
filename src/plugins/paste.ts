import { invoke } from "@tauri-apps/api/core";

export const COMMAND = {
	PASTE: "plugin:eco-paste|paste",
	PASTE_WITH_FOCUS: "plugin:eco-paste|paste_with_focus",
	BATCH_PASTE: "plugin:eco-paste|batch_paste",
	SINGLE_PASTE: "plugin:eco-paste|single_paste",
	PASTE_COLOR: "plugin:eco-paste|paste_color",
};

/**
 * 粘贴剪贴板内容（快速粘贴专用，不切换焦点）
 * 用于快捷键触发的快速粘贴
 */
export const paste = () => {
	return invoke(COMMAND.PASTE);
};

/**
 * 粘贴剪贴板内容（带焦点切换，用于前端粘贴）
 * 前端窗口会抢占焦点，需要切换回目标窗口
 */
export const pasteWithFocus = () => {
	return invoke(COMMAND.PASTE_WITH_FOCUS);
};

/**
 * 单个粘贴剪贴板内容（后端实现，轻量模式兼容）
 * @param id 历史记录 ID
 * @param plain 是否纯文本粘贴
 */
export const singlePasteById = async (id: string, plain = false) => {
	await invoke(COMMAND.SINGLE_PASTE, { id, plain });
};

/**
 * 批量粘贴剪贴板内容（后端实现，轻量模式兼容）
 * @param ids 历史记录 ID 列表
 * @param plain 是否纯文本粘贴
 * @param skipFirst 拖拽场景跳过第一项
 * @param prependNewline 拖拽场景在开头添加换行
 */
export const batchPasteByIds = async (
	ids: string[],
	plain = false,
	skipFirst = false,
	prependNewline = false,
) => {
	await invoke(COMMAND.BATCH_PASTE, { ids, plain, skipFirst, prependNewline });
};

/**
 * 粘贴颜色值（后端实现）
 * @param colorValue 转换后的颜色值
 */
export const pasteColor = async (colorValue: string) => {
	await invoke(COMMAND.PASTE_COLOR, { colorValue });
};
