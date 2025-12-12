import { platform } from "@tauri-apps/plugin-os";
import isUrl from "is-url";

/**
 * 是否为开发环境
 */
export const isDev = () => {
	return import.meta.env.DEV;
};

/**
 * 是否为 macos 系统
 */
export const isMac = platform() === "macos";

/**
 * 是否为 windows 系统
 */
export const isWin = platform() === "windows";

/**
 * 是否为 linux 系统
 */
export const isLinux = platform() === "linux";

/**
 * 是否为链接
 */
export const isURL = (value: string) => {
	return isUrl(value);
};

/**
 * 是否为邮箱
 */
export const isEmail = (value: string) => {
	const regex = /^[A-Za-z0-9\u4e00-\u9fa5]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;

	return regex.test(value);
};

/**
 * 是否为颜色
 */
export const isColor = (value: string, checkVectorValues = true) => {
	const excludes = [
		"none",
		"currentColor",
		"-moz-initial",
		"inherit",
		"initial",
		"revert",
		"revert-layer",
		"unset",
		"ActiveBorder",
		"ActiveCaption",
		"AppWorkspace",
		"Background",
		"ButtonFace",
		"ButtonHighlight",
		"ButtonShadow",
		"ButtonText",
		"CaptionText",
		"GrayText",
		"Highlight",
		"HighlightText",
		"InactiveBorder",
		"InactiveCaption",
		"InactiveCaptionText",
		"InfoBackground",
		"InfoText",
		"Menu",
		"MenuText",
		"Scrollbar",
		"ThreeDDarkShadow",
		"ThreeDFace",
		"ThreeDHighlight",
		"ThreeDLightShadow",
		"ThreeDShadow",
		"Window",
		"WindowFrame",
		"WindowText",
	];

	if (excludes.includes(value) || value.includes("url")) return false;

	// 检查RGB格式：rgb(255, 0, 0)
	const rgbRegex = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
	if (rgbRegex.test(value.trim())) {
		const match = value.trim().match(rgbRegex);
		if (match) {
			const r = Number.parseInt(match[1], 10);
			const g = Number.parseInt(match[2], 10);
			const b = Number.parseInt(match[3], 10);

			if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
				return true;
			}
		}
	}

	// 检查CMYK格式：cmyk(100, 0, 0, 0)
	const cmykRegex =
		/^cmyk\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
	if (cmykRegex.test(value.trim())) {
		const match = value.trim().match(cmykRegex);
		if (match) {
			const c = Number.parseInt(match[1], 10);
			const m = Number.parseInt(match[2], 10);
			const y = Number.parseInt(match[3], 10);
			const k = Number.parseInt(match[4], 10);

			if (
				c >= 0 &&
				c <= 100 &&
				m >= 0 &&
				m <= 100 &&
				y >= 0 &&
				y <= 100 &&
				k >= 0 &&
				k <= 100
			) {
				return true;
			}
		}
	}

	// 检查是否为3维或4维向量（优先识别为CMYK）
	// 只有在启用颜色识别时才检查向量值
	if (checkVectorValues) {
		// 优先检查4维向量（CMYK格式）
		const cmykVectorRegex =
			/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/;
		if (cmykVectorRegex.test(value.trim())) {
			const match = value.trim().match(cmykVectorRegex);
			if (match) {
				const c = Number.parseInt(match[1], 10);
				const m = Number.parseInt(match[2], 10);
				const y = Number.parseInt(match[3], 10);
				const k = Number.parseInt(match[4], 10);

				// 如果所有值都在0-100范围内，优先识别为CMYK
				if (
					c >= 0 &&
					c <= 100 &&
					m >= 0 &&
					m <= 100 &&
					y >= 0 &&
					y <= 100 &&
					k >= 0 &&
					k <= 100
				) {
					return true;
				}
			}
		}

		// 检查3维向量（RGB格式）
		const rgbVectorRegex = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/;
		if (rgbVectorRegex.test(value.trim())) {
			const match = value.trim().match(rgbVectorRegex);
			if (match) {
				const r = Number.parseInt(match[1], 10);
				const g = Number.parseInt(match[2], 10);
				const b = Number.parseInt(match[3], 10);

				if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
					return true;
				}
			}
		}
	}

	const style = new Option().style;

	style.backgroundColor = value;
	style.backgroundImage = value;

	const { backgroundColor, backgroundImage } = style;

	return backgroundColor !== "" || backgroundImage !== "";
};

/**
 * 是否为图片
 */
export const isImage = (value: string) => {
	const regex = /\.(jpe?g|png|webp|avif|gif|svg|bmp|ico|tiff?|heic|apng)$/i;

	return regex.test(value);
};
