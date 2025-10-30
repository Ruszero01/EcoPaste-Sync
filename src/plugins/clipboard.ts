import { systemOCR } from "@/plugins/ocr";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import type { ClipboardPayload, ReadImage, WindowsOCR } from "@/types/plugin";
import { fileContentProcessor } from "@/utils/fileContentProcessor";
import { isColor, isEmail, isURL } from "@/utils/is";
import { resolveImagePath } from "@/utils/path";
import { getSaveImagePath } from "@/utils/path";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { exists } from "@tauri-apps/plugin-fs";
import { isEmpty, isEqual } from "lodash-es";
import { fullName, metadata } from "tauri-plugin-fs-pro-api";
import { getServerConfig } from "./webdav";

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
	PASTE: "plugin:eco-clipboard|paste",
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
 * 粘贴剪贴板内容
 */
export const paste = () => {
	return invoke(COMMAND.PASTE);
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
		console.log(`检测到单个图片文件: ${files[0]}, 归类为图片类型`);

		const { size, name } = await metadata(files[0]);

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

		// 返回图片类型的payload
		return {
			count: size,
			search,
			value: files[0],
			group: "image",
			subtype: "image",
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
	const { image, ...rest } = await invoke<ReadImage>(COMMAND.READ_IMAGE, {
		path: getSaveImagePath(),
	});

	const { size: count } = await metadata(image);

	let search = "";

	if (clipboardStore.content.ocr) {
		search = await systemOCR(image);

		if (isWin) {
			const { content, qr } = JSON.parse(search) as WindowsOCR;

			if (isEmpty(qr)) {
				search = content;
			} else {
				search = qr[0].content;
			}
		}
	}

	const value = await fullName(image);

	return {
		...rest,
		count,
		value,
		search,
		group: "image",
	};
};

/**
 * 读取 HTML 内容
 */
export const readHTML = async (): Promise<ClipboardPayload> => {
	const html = await invoke<string>(COMMAND.READ_HTML);

	const { value, count } = await readText();

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

	const { value, count } = await readText();

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
export const readText = async (): Promise<ClipboardPayload> => {
	const text = await invoke<string>(COMMAND.READ_TEXT);

	const data: ClipboardPayload = {
		value: text,
		search: text,
		count: text.length,
		group: "text",
	};

	data.subtype = await getClipboardSubtype(data);

	return data;
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
export const writeImage = (value: string) => {
	return invoke(COMMAND.WRITE_IMAGE, {
		value,
	});
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
export const readClipboard = async () => {
	let payload!: ClipboardPayload;

	const { copyPlain } = clipboardStore.content;

	const has = {
		files: await hasFiles(),
		image: await hasImage(),
		html: await hasHTML(),
		rtf: await hasRTF(),
		text: await hasText(),
	};

	if (has.files) {
		const filesPayload = await readFiles();

		// 智能检测文件类型已在readFiles中处理
		// 如果是单个图片文件，readFiles会返回image类型的payload
		// 如果是多个文件或非图片文件，会返回files类型的payload
		if (filesPayload.group === "image") {
			payload = { ...filesPayload, type: "image" };
		} else {
			payload = { ...filesPayload, type: "files" };
		}
	} else if (has.image && !has.text) {
		const imagePayload = await readImage();

		payload = { ...imagePayload, type: "image" };
	} else if (!copyPlain && has.html) {
		const htmlPayload = await readHTML();

		payload = { ...htmlPayload, type: "html" };
	} else if (!copyPlain && has.rtf) {
		const rtfPayload = await readRTF();

		payload = { ...rtfPayload, type: "rtf" };
	} else {
		const textPayload = await readText();

		payload = { ...textPayload, type: "text" };
	}

	return payload;
};

/**
 * 剪贴板更新
 */
export const onClipboardUpdate = (fn: (payload: ClipboardPayload) => void) => {
	let lastUpdated = 0;
	let previousPayload: ClipboardPayload;
	let processing = false;

	return listen(COMMAND.CLIPBOARD_UPDATE, async () => {
		// 防止并发处理
		if (processing) {
			return;
		}

		processing = true;

		try {
			const payload = await readClipboard();

			const { group, count } = payload;

			if (group === "text" && count === 0) {
				return;
			}

			const expired = Date.now() - lastUpdated > 300; // 增加防抖时间到300ms

			if (expired || !isEqual(payload, previousPayload)) {
				fn(payload);
			}

			lastUpdated = Date.now();
			previousPayload = payload;
		} finally {
			processing = false;
		}
	});
};

/**
 * 将数据写入剪贴板
 * @param data 数据
 */
export const writeClipboard = (data?: HistoryTablePayload) => {
	if (!data) return;

	const { type, value, search } = data;

	switch (type) {
		case "text":
			return writeText(value);
		case "rtf":
			return writeRTF(search, value);
		case "html":
			return writeHTML(search, value);
		case "image":
			return writeImage(resolveImagePath(value));
		case "files":
			return writeFiles(value);
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

	return paste();
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

		if (isColor(value)) {
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
 * 智能粘贴剪贴板数据（支持懒下载文件）
 */
export const smartPasteClipboard = async (
	data?: HistoryTablePayload,
	plain = false,
) => {
	if (!data) return;

	const { type, value, lazyDownload } = data;

	// 如果不是按需下载文件，直接使用原有逻辑
	if (!lazyDownload || (type !== "image" && type !== "files")) {
		return pasteClipboard(data, plain);
	}

	try {
		// 获取WebDAV配置
		const webdavConfig = await getServerConfig();
		if (!webdavConfig) {
			console.warn("WebDAV配置未设置，无法下载文件");
			return pasteClipboard(data, plain);
		}

		// 转换为SyncItem格式
		const syncItem = {
			id: data.id,
			type: type as any,
			group: data.group as any,
			value: value,
			search: data.search,
			count: data.count,
			width: data.width,
			height: data.height,
			favorite: data.favorite,
			createTime: data.createTime,
			note: data.note,
			subtype: data.subtype,
			lastModified: Date.now(),
			deviceId: "local",
			lazyDownload: lazyDownload,
			fileSize: data.fileSize,
			fileType: data.fileType,
		} as any;

		console.log(`开始按需下载${type}文件: ${data.id}`);

		// 根据类型处理按需下载
		let processedValue: string | null = null;

		if (type === "image") {
			processedValue = await fileContentProcessor.processImageContent(
				syncItem,
				webdavConfig,
				(progress) => {
					console.log(`图片下载进度: ${progress}%`);
				},
			);
		} else if (type === "files") {
			processedValue = await fileContentProcessor.processFilesContent(
				syncItem,
				webdavConfig,
				(progress) => {
					console.log(`文件下载进度: ${progress}%`);
				},
			);
		}

		if (processedValue) {
			// 下载成功，使用下载后的文件路径
			const updatedData = {
				...data,
				value: processedValue,
				lazyDownload: false,
			};
			console.log("文件下载成功，开始粘贴");

			// 更新数据库记录，移除lazyDownload标记并更新value
			try {
				const { updateSQL } = await import("@/database");
				await updateSQL("history", {
					id: data.id,
					value: processedValue,
					lazyDownload: false,
				});
				console.log("✅ 数据库记录已更新，移除按需下载标记");

				// 触发界面刷新事件
				const { emit } = await import("@tauri-apps/api/event");
				const { LISTEN_KEY } = await import("@/constants");
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				console.log("✅ 界面刷新事件已触发");
			} catch (updateError) {
				console.error("❌ 更新数据库记录失败:", updateError);
			}

			return pasteClipboard(updatedData, plain);
		} else {
			// 下载失败，回退到原有逻辑
			console.warn("文件下载失败，使用原有数据");
			return pasteClipboard(data, plain);
		}
	} catch (error) {
		console.error("智能粘贴过程中出错:", error);
		// 出错时回退到原有逻辑
		return pasteClipboard(data, plain);
	}
};
