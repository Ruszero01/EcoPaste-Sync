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
export const isColor = (value: string) => {
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

	// 检查RGB格式：rgb(255, 0, 0) 或 255, 0, 0
	const rgbRegex =
		/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$|^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/;
	if (rgbRegex.test(value.trim())) {
		const match = value.trim().match(rgbRegex);
		if (match) {
			// 提取RGB值（两种格式都可能匹配）
			const r = match[1] || match[4];
			const g = match[2] || match[5];
			const b = match[3] || match[6];

			// 验证RGB值是否在有效范围内
			if (r && g && b) {
				const rNum = Number.parseInt(r, 10);
				const gNum = Number.parseInt(g, 10);
				const bNum = Number.parseInt(b, 10);

				if (
					rNum >= 0 &&
					rNum <= 255 &&
					gNum >= 0 &&
					gNum <= 255 &&
					bNum >= 0 &&
					bNum <= 255
				) {
					return true;
				}
			}
		}
	}

	// 检查RGBA格式：rgba(255, 0, 0, 0.5) 或 255, 0, 0, 0.5
	const rgbaRegex =
		/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([01]?\.?\d*)\s*\)$|^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([01]?\.?\d*)$/;
	if (rgbaRegex.test(value.trim())) {
		const match = value.trim().match(rgbaRegex);
		if (match) {
			// 提取RGBA值（两种格式都可能匹配）
			const r = match[1] || match[5];
			const g = match[2] || match[6];
			const b = match[3] || match[7];
			const a = match[4] || match[8];

			// 验证RGBA值是否在有效范围内
			if (r && g && b && a !== undefined) {
				const rNum = Number.parseInt(r, 10);
				const gNum = Number.parseInt(g, 10);
				const bNum = Number.parseInt(b, 10);
				const aNum = Number.parseFloat(a);

				if (
					rNum >= 0 &&
					rNum <= 255 &&
					gNum >= 0 &&
					gNum <= 255 &&
					bNum >= 0 &&
					bNum <= 255 &&
					aNum >= 0 &&
					aNum <= 1
				) {
					return true;
				}
			}
		}
	}

	// 检查是否为3维或4维向量（优先识别为颜色）
	const vectorRegex =
		/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(\s*,\s*([01]?\.?\d*))?$/;
	if (vectorRegex.test(value.trim())) {
		const match = value.trim().match(vectorRegex);
		if (match) {
			const r = Number.parseInt(match[1], 10);
			const g = Number.parseInt(match[2], 10);
			const b = Number.parseInt(match[3], 10);
			const hasAlpha = match[4] !== undefined;
			const a = hasAlpha ? Number.parseFloat(match[5]) : 1;

			// 验证向量值是否在有效范围内
			if (
				r >= 0 &&
				r <= 255 &&
				g >= 0 &&
				g <= 255 &&
				b >= 0 &&
				b <= 255 &&
				(!hasAlpha || (a >= 0 && a <= 1))
			) {
				return true;
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
