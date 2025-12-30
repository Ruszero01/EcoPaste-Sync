import { systemOCR } from "@/plugins/ocr";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import type { ClipboardPayload, ReadImage, WindowsOCR } from "@/types/plugin";
import { parseColorString } from "@/utils/color";
import { isColor, isEmail, isURL } from "@/utils/is";
import { resolveImagePath } from "@/utils/path";
import { getSaveImagePath } from "@/utils/path";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { exists } from "@tauri-apps/plugin-fs";
import { isEmpty, isEqual } from "lodash-es";
import { fullName, metadata } from "tauri-plugin-fs-pro-api";
import { paste } from "./paste";

const COMMAND = {
	START_LISTEN: "plugin:eco-clipboard|start_listen",
	STOP_LISTEN: "plugin:eco-clipboard|stop_listen",
	HAS_FILES: "plugin:eco-clipboard|has_files",
	HAS_IMAGE: "plugin:eco-clipboard|has_image",
	HAS_HTML: "plugin:eco-clipboard|has_html",
	HAS_RTF: "plugin:eco-clipboard|has_rtf",
	HAS_TEXT: "plugin:eco-clipboard|has_text",
	READ_FILES: "plugin:eco-clipboard|read_files",
	READ_IMAGE: "plugin:eco-clipboard|read_image",
	READ_HTML: "plugin:eco-clipboard|read_html",
	READ_RTF: "plugin:eco-clipboard|read_rtf",
	READ_TEXT: "plugin:eco-clipboard|read_text",
	WRITE_FILES: "plugin:eco-clipboard|write_files",
	WRITE_IMAGE: "plugin:eco-clipboard|write_image",
	WRITE_HTML: "plugin:eco-clipboard|write_html",
	WRITE_RTF: "plugin:eco-clipboard|write_rtf",
	WRITE_TEXT: "plugin:eco-clipboard|write_text",
	GET_CLIPBOARD_SOURCE_INFO: "plugin:eco-clipboard|get_clipboard_source_info",
	CLIPBOARD_UPDATE: "plugin:eco-clipboard://clipboard_update",
};

/**
 * 开启监听
 */
export const startListen = () => {
	return invoke(COMMAND.START_LISTEN);
};

/**
 * 停止监听
 */
export const stopListen = () => {
	return invoke(COMMAND.STOP_LISTEN);
};

// 切换监听
export const toggleListen = (value: boolean) => {
	if (value) {
		startListen();
	} else {
		stopListen();
	}
};

/**
 * 剪贴板是否有文件
 */
export const hasFiles = () => {
	return invoke<boolean>(COMMAND.HAS_FILES);
};

/**
 * 剪贴板是否有图像
 */
export const hasImage = () => {
	return invoke<boolean>(COMMAND.HAS_IMAGE);
};

/**
 * 剪贴板是否有 HTML 内容
 */
export const hasHTML = () => {
	return invoke<boolean>(COMMAND.HAS_HTML);
};

/**
 * 剪贴板是否有富文本
 */
export const hasRTF = () => {
	return invoke<boolean>(COMMAND.HAS_RTF);
};

/**
 * 剪贴板是否有纯文本
 */
export const hasText = () => {
	return invoke<boolean>(COMMAND.HAS_TEXT);
};

/**
 * 检测文件是否为图片
 */
const isImageFile = async (filePath: string): Promise<boolean> => {
	try {
		const ext = filePath.toLowerCase().split(".").pop() || "";

		// 常见图片文件扩展名
		const imageExtensions = [
			"png",
			"jpg",
			"jpeg",
			"gif",
			"bmp",
			"webp",
			"svg",
			"ico",
			"tiff",
			"tif",
			"psd",
			"ai",
			"eps",
			"raw",
			"heic",
			"heif",
		];

		return imageExtensions.includes(ext);
	} catch {
		return false;
	}
};

/**
 * 读取剪贴板文件（智能版本）
 */
export const readFiles = async (): Promise<ClipboardPayload> => {
	let files = await invoke<string[]>(COMMAND.READ_FILES);

	// 安全地解码文件路径，避免对Windows路径造成错误处理
	files = files.map((filePath) => {
		try {
			// 只有当路径确实包含URI编码时才进行解码
			if (filePath.includes("%")) {
				return decodeURI(filePath);
			}
			return filePath;
		} catch (error) {
			console.warn("文件路径解码失败，使用原始路径:", filePath, error);
			return filePath;
		}
	});

	// 智能检测：如果只有一个文件且是图片，归类为图片类型
	if (files.length === 1 && (await isImageFile(files[0]))) {
		const { size, name } = await metadata(files[0]);

		// 获取图片尺寸信息
		let width = 0;
		let height = 0;
		try {
			// 使用 Tauri 命令获取图片尺寸
			const dimensions = await invoke<{ width: number; height: number }>(
				"plugin:eco-clipboard|get_image_dimensions",
				{
					path: files[0],
				},
			);

			width = dimensions.width;
			height = dimensions.height;
		} catch (error) {
			console.warn("Failed to get image dimensions for file:", files[0], error);
			// 如果无法获取尺寸，保持为 0
		}

		// 为截图文件生成更友好的标题
		let search = name;
		if (files[0].includes("\\Temp\\") || files[0].includes("\\temp\\")) {
			// 检测是否为截图软件生成的临时文件
			const isScreenshot =
				files[0].toLowerCase().includes("screenshot") ||
				files[0].toLowerCase().includes("snip") ||
				files[0].toLowerCase().includes("capture") ||
				files[0].toLowerCase().includes("pixpin") ||
				files[0].toLowerCase().includes("snipaste");

			if (isScreenshot) {
				// 为截图文件生成友好的标题
				const now = new Date();
				const timeStr = now
					.toLocaleString("zh-CN", {
						month: "2-digit",
						day: "2-digit",
						hour: "2-digit",
						minute: "2-digit",
					})
					.replace(/\//g, "-")
					.replace(/:/g, ":");
				search = `截图 ${timeStr}`;
			}
		}

		// 返回图片类型的payload，包含尺寸信息
		return {
			count: size,
			search,
			value: files[0],
			group: "image",
			subtype: "image",
			width,
			height,
		};
	}

	// 多个文件或非图片文件，保持原有files类型
	let count = 0;
	const names = [];

	for await (const path of files) {
		const { size, name } = await metadata(path);

		count += size;

		names.push(name);
	}

	return {
		count,
		search: names.join(" "),
		value: JSON.stringify(files),
		group: "files",
	};
};

/**
 * 读取剪贴板图片
 */
export const readImage = async (): Promise<ClipboardPayload> => {
	const imageData = await invoke<ReadImage>(COMMAND.READ_IMAGE, {
		path: getSaveImagePath(),
	});

	const { image, width, height, ...rest } = imageData;

	const { size: count } = await metadata(image);

	let search = "";

	if (clipboardStore.content.ocr) {
		try {
			search = await systemOCR(image);

			if (isWin) {
				const { content, qr } = JSON.parse(search) as WindowsOCR;

				if (isEmpty(qr)) {
					search = content;
				} else {
					search = qr[0].content;
				}
			}
		} catch (error) {
			// OCR失败时静默处理，不影响正常的图片读取功能
			console.warn("OCR识别失败，将保存为无搜索文本的图片:", error);
		}
	}

	const value = await fullName(image);

	return {
		...rest,
		count,
		value,
		search,
		group: "image",
		width,
		height,
	};
};

/**
 * 读取 HTML 内容
 */
export const readHTML = async (): Promise<ClipboardPayload> => {
	const html = await invoke<string>(COMMAND.READ_HTML);

	const { value, count } = await readText(true); // 跳过类型检测，保持原有类型

	return {
		count,
		value: html,
		search: value,
		group: "text",
	};
};

/**
 * 读取富文本
 */
export const readRTF = async (): Promise<ClipboardPayload> => {
	const rtf = await invoke<string>(COMMAND.READ_RTF);

	const { value, count } = await readText(true); // 跳过类型检测，保持原有类型

	return {
		count,
		value: rtf,
		search: value,
		group: "text",
	};
};

/**
 * 读取纯文本
 */
export const readText = async (
	skipTypeDetection = false,
): Promise<ClipboardPayload> => {
	const text = await invoke<string>(COMMAND.READ_TEXT);

	const data: ClipboardPayload = {
		value: text,
		search: text,
		count: text.length,
		group: "text",
	};

	// 只有在不跳过类型检测时才进行自动类型检测
	// 这样可以避免覆盖用户手动设置的类型
	if (!skipTypeDetection) {
		const subtype = await getClipboardSubtype(data);

		// 如果是颜色，设置type为text，subtype为color
		if (subtype === "color") {
			data.type = "text";
			data.subtype = "color";
		} else {
			data.subtype = subtype;
		}
	}

	return data;
};

/**
 * 读取 Markdown 内容
 */
export const readMarkdown = async (): Promise<ClipboardPayload> => {
	const { value, count, subtype } = await readText(true); // 跳过类型检测，保持原有类型

	return {
		value,
		count,
		search: value,
		group: "text",
		subtype,
	};
};

/**
 * 文件写入剪贴板
 */
export const writeFiles = (value: string) => {
	return invoke(COMMAND.WRITE_FILES, {
		value: JSON.parse(value),
	});
};

/**
 * 图片写入剪贴板
 */
export const writeImage = async (value: string) => {
	try {
		// 确保路径是有效的
		if (!value || value.trim() === "") {
			throw new Error("图片路径为空");
		}

		// 检查文件是否存在
		const { exists } = await import("@tauri-apps/plugin-fs");
		const fileExists = await exists(value);

		if (!fileExists) {
			throw new Error(`图片文件不存在: ${value}`);
		}

		return await invoke(COMMAND.WRITE_IMAGE, {
			value,
		});
	} catch (error) {
		console.error("写入图片到剪贴板失败:", error);
		throw error;
	}
};

/**
 * HTML 内容写入剪贴板
 */
export const writeHTML = (text: string, html: string) => {
	const { pastePlain } = clipboardStore.content;

	if (pastePlain) {
		return writeText(text);
	}

	return invoke(COMMAND.WRITE_HTML, {
		text,
		html,
	});
};

/**
 * 富文写入剪贴板
 */
export const writeRTF = (text: string, rtf: string) => {
	const { pastePlain } = clipboardStore.content;

	if (pastePlain) {
		return writeText(text);
	}

	return invoke(COMMAND.WRITE_RTF, {
		text,
		rtf,
	});
};

/**
 * 纯文本写入剪贴板
 */
export const writeText = (value: string) => {
	return invoke(COMMAND.WRITE_TEXT, {
		value,
	});
};

/**
 * 读取剪贴板内容
 */
export const readClipboard = async (skipTypeDetection = false) => {
	let payload!: ClipboardPayload;

	const { copyPlain } = clipboardStore.content;

	try {
		const has = {
			files: await hasFiles(),
			image: await hasImage(),
			html: await hasHTML(),
			rtf: await hasRTF(),
			text: await hasText(),
		};

		// 优先处理图片内容（无论是否有文本，解决截图软件复制问题）
		if (has.image) {
			const imagePayload = await readImage();
			payload = { ...imagePayload, type: "image" };
		}
		// 处理文件内容
		else if (has.files) {
			const filesPayload = await readFiles();

			// 如果是单个图片文件，由于上面已经优先处理了image格式，
			// 这里到达说明图片文件是通过文件方式复制的（非截图软件）
			if (filesPayload.group === "image") {
				payload = { ...filesPayload, type: "image" };
			} else {
				payload = { ...filesPayload, type: "files" };
			}
		}
		// 处理富文本内容
		else if (!copyPlain && has.html) {
			const htmlPayload = await readHTML();
			payload = { ...htmlPayload, type: "formatted", subtype: "html" };
		} else if (!copyPlain && has.rtf) {
			const rtfPayload = await readRTF();
			payload = { ...rtfPayload, type: "formatted", subtype: "rtf" };
		}
		// 处理Markdown内容
		else if (has.text) {
			const text = await invoke<string>(COMMAND.READ_TEXT);

			// 只有在不跳过类型检测时才进行自动类型检测
			// 注意：后端已接管类型检测，这里不再进行前端检测
			// 后端会将检测结果直接存储到数据库
			if (!skipTypeDetection) {
				// 获取子类型（URL、邮箱、路径等）
				const subtype = await getClipboardSubtype({
					value: text,
					search: text,
					count: text.length,
					group: "text",
				});

				// 构建基础payload
				const basePayload: ClipboardPayload = {
					value: text,
					search: text,
					count: text.length,
					group: "text",
				};

				// 根据子类型设置type
				if (subtype === "color") {
					payload = {
						...basePayload,
						type: "text",
						subtype: "color",
						group: "text",
					};
				} else {
					payload = {
						...basePayload,
						type: "text",
						subtype,
					};
				}
			} else {
				// 跳过类型检测时，使用默认的文本类型
				payload = {
					value: text,
					search: text,
					count: text.length,
					group: "text",
					type: "text",
				};
			}
		}
		// 如果没有文本内容，返回空的文本payload
		else {
			payload = {
				value: "",
				search: "",
				count: 0,
				group: "text" as const,
				type: "text" as const,
			};
		}

		// 来源应用信息由后端在插入新记录时统一获取
		return payload;
	} catch (error) {
		// 如果是批量粘贴过程中的错误，返回一个空的文本payload
		if (clipboardStore.internalCopy.isCopying) {
			console.warn("批量粘贴过程中读取剪贴板失败，返回空内容:", error);
			return {
				value: "",
				search: "",
				count: 0,
				group: "text" as const,
				type: "text" as const,
			};
		}

		// 其他情况下重新抛出错误
		throw error;
	}
};

/**
 * 剪贴板更新
 */
export const onClipboardUpdate = (fn: (payload: ClipboardPayload) => void) => {
	let lastUpdated = 0;
	let previousPayload: ClipboardPayload;
	let processing = false;
	let retryCount = 0;
	const MAX_RETRY = 3;

	// 用于防重复处理的缓存
	const contentHashCache = new Map<string, number>();

	const processClipboardUpdate = async () => {
		if (processing) {
			retryCount++;
			if (retryCount <= MAX_RETRY) {
				// 根据重试次数调整延迟时间，递增延迟避免过度重试
				const delay = Math.min(50 * retryCount, 150);
				setTimeout(() => {
					const retryEvent = new CustomEvent("clipboard-retry");
					window.dispatchEvent(retryEvent);
				}, delay);
			}
			return;
		}

		processing = true;
		retryCount = 0;

		try {
			// 如果是内部复制操作，直接跳过处理，避免获取来源应用信息
			if (clipboardStore.internalCopy.isCopying) {
				return;
			}

			const payload = await readClipboard();

			const { group, count, type, value } = payload;

			if (group === "text" && count === 0) {
				return;
			}

			// 创建内容哈希用于去重
			const contentKey = `${type}:${group}:${value?.substring(0, 100)}`;
			const now = Date.now();

			// 更新缓存
			contentHashCache.set(contentKey, now);

			// 减少防抖时间到100ms，提高响应速度
			const expired = now - lastUpdated > 100;

			if (expired || !isEqual(payload, previousPayload)) {
				fn(payload);
			}

			lastUpdated = now;
			previousPayload = payload;
		} catch (error) {
			// 捕获剪贴板读取错误，特别是批量粘贴过程中的"No image data in clipboard"错误
			console.warn(
				"剪贴板更新处理失败，可能是批量粘贴过程中的临时错误:",
				error,
			);

			// 如果是批量粘贴过程中的错误，直接忽略，不影响正常功能
			if (clipboardStore.internalCopy.isCopying) {
				return;
			}

			// 其他错误也静默处理，避免影响用户体验
			return;
		} finally {
			processing = false;
		}
	};

	// 监听原始剪贴板更新事件
	const unlisten = listen(COMMAND.CLIPBOARD_UPDATE, processClipboardUpdate);

	// 监听重试事件
	const retryUnlisten = listen("clipboard-retry", processClipboardUpdate);

	// 返回清理函数
	return () => {
		unlisten.then((fn) => fn());
		retryUnlisten.then((fn) => fn());
	};
};

/**
 * 将数据写入剪贴板
 * @param data 数据
 */
export const writeClipboard = async (data?: HistoryTablePayload) => {
	if (!data) return;

	const { type, subtype, value, search } = data;

	switch (type) {
		case "text":
			// 处理markdown subtype
			if (subtype === "markdown") {
				return writeText(value);
			}
			// 处理color subtype
			if (subtype === "color") {
				return writeText(value);
			}
			return writeText(value);
		case "formatted":
			// 根据subtype选择写入方式
			if (subtype === "rtf") {
				return writeRTF(search, value);
			}
			if (subtype === "html") {
				return writeHTML(search, value);
			}
			// 默认按HTML格式写入
			return writeHTML(search, value);
		case "image":
			return await writeImage(resolveImagePath(value));
		case "files":
			// 对于文件类型，确保value是有效的JSON字符串
			if (typeof value === "string") {
				return writeFiles(value);
			}
			// 如果value不是字符串，尝试转换为JSON字符串
			try {
				const jsonValue = JSON.stringify(value);
				return writeFiles(jsonValue);
			} catch (error) {
				console.error("文件路径JSON序列化失败:", error);
				throw new Error("无效的文件路径数据");
			}
	}
};

/**
 * 粘贴剪贴板数据
 * @param data 数据
 * @param plain 是否纯文本粘贴
 */
export const pasteClipboard = async (
	data?: HistoryTablePayload,
	plain = false,
) => {
	if (!data) return;

	const { type, value } = data;

	// 设置内部复制标志，防止粘贴操作后触发重复处理
	clipboardStore.internalCopy = {
		isCopying: true,
		itemId: data.id,
	};

	try {
		if (plain) {
			if (type === "files") {
				const pasteValue = JSON.parse(value).join("\n");

				await writeText(pasteValue);
			} else {
				await writeText(data.search);
			}
		} else {
			await writeClipboard(data);
		}

		// 减少延迟确保剪贴板内容完全写入
		await new Promise((resolve) => setTimeout(resolve, 30));

		// 执行粘贴操作
		await paste();

		// 再减少一个短暂延迟，确保粘贴操作完成
		await new Promise((resolve) => setTimeout(resolve, 20));
	} finally {
		// 清除内部复制标志
		clipboardStore.internalCopy = {
			isCopying: false,
			itemId: null,
		};
	}
};

/**
 * 获取剪贴板数据的子类型
 * @param data 剪贴板数据
 */
export const getClipboardSubtype = async (data: ClipboardPayload) => {
	try {
		const { value } = data;

		if (isURL(value)) {
			return "url";
		}

		if (isEmail(value)) {
			return "email";
		}

		// 颜色检测，只支持RGB格式
		// 根据颜色识别开关决定是否检测向量值
		if (isColor(value, clipboardStore.content.colorDetection)) {
			// 进一步解析颜色格式，以便前端可以正确显示
			const colorInfo = parseColorString(value);
			if (colorInfo) {
				// 返回"color"，但在调用方会将其设置为type而不是subtype
				return "color";
			}
			return "color";
		}

		if (await exists(value)) {
			return "path";
		}
	} catch {
		return;
	}
};

/**
 * 智能粘贴剪贴板数据
 */
export const smartPasteClipboard = async (
	data?: HistoryTablePayload,
	plain = false,
) => {
	if (!data) return;

	// 设置内部复制标志，防止粘贴操作后触发重复处理
	clipboardStore.internalCopy = {
		isCopying: true,
		itemId: data.id,
	};

	try {
		// 直接使用原有逻辑，同步阶段已确保所有文件都是本地可用的
		return await pasteClipboard(data, plain);
	} finally {
		// 清除内部复制标志
		clipboardStore.internalCopy = {
			isCopying: false,
			itemId: null,
		};
	}
};

/**
 * 批量粘贴剪贴板数据
 * @param dataList 数据列表
 * @param plain 是否纯文本粘贴
 */
export const batchPasteClipboard = async (
	dataList?: HistoryTablePayload[],
	plain = false,
) => {
	if (!dataList || dataList.length === 0) return;

	// 设置批量粘贴标志，避免批量粘贴过程中的换行符被误认为是新的剪贴板内容
	clipboardStore.internalCopy = {
		isCopying: true,
		itemId: "batch-paste",
	};

	try {
		// 依次粘贴每个条目，使用与拖拽粘贴相同的延迟逻辑
		for (let i = 0; i < dataList.length; i++) {
			const data = dataList[i];
			if (!data) continue;

			// 使用与单个粘贴完全相同的逻辑
			await pasteClipboard(data, plain);

			// 减少延迟，确保粘贴操作完成
			await new Promise((resolve) => setTimeout(resolve, 20));

			// 如果不是最后一个项目，执行换行粘贴
			if (i < dataList.length - 1) {
				// 设置内部复制标志，避免换行操作触发剪贴板更新
				clipboardStore.internalCopy = {
					isCopying: true,
					itemId: "batch-newline",
				};

				try {
					await writeText("\n");
					await new Promise((resolve) => setTimeout(resolve, 20));
					await paste();
					// 减少延迟，确保换行操作完成
					await new Promise((resolve) => setTimeout(resolve, 20));
				} finally {
					// 恢复批量粘贴标志
					clipboardStore.internalCopy = {
						isCopying: true,
						itemId: "batch-paste",
					};
				}
			}
		}
	} finally {
		// 清除批量粘贴标志
		clipboardStore.internalCopy = {
			isCopying: false,
			itemId: null,
		};
	}
};

/// 颜色转换类型
export type ColorConvertType = "rgbVector" | "hex" | "cmyk" | "rgb";

/// 颜色转换结果
export interface ColorConvertResult {
	value: string;
	success: boolean;
	error?: string;
}

/// 转换颜色格式（调用后端命令）
export const convertColor = async (
	color: string,
	convertType: ColorConvertType,
): Promise<ColorConvertResult> => {
	return (await invoke("plugin:eco-detector|convert_color", {
		color,
		convertType,
	})) as ColorConvertResult;
};
