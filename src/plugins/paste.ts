import { invoke } from "@tauri-apps/api/core";

export const COMMAND = {
	PASTE: "plugin:eco-paste|paste",
	BATCH_PASTE: "plugin:eco-paste|batch_paste",
};

/**
 * 粘贴剪贴板内容
 */
export const paste = () => {
	return invoke(COMMAND.PASTE);
};

/**
 * 批量粘贴剪贴板内容
 * @param contents 要粘贴的内容数组
 * @param delay 每次粘贴之间的延迟（毫秒）
 */
export const batchPaste = async (contents: string[], delay = 100) => {
	if (!contents || contents.length === 0) return;

	// 在前端实现批量粘贴逻辑，因为后端插件只支持单次粘贴
	for (let i = 0; i < contents.length; i++) {
		// 写入剪贴板
		const { writeText } = await import("./clipboard");
		await writeText(contents[i]);

		// 执行粘贴
		await paste();

		// 如果不是最后一个内容，添加延迟
		if (i < contents.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
};
