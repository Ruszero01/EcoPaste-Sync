import { theme } from "antd";
import { kebabCase, map } from "lodash-es";

const { getDesignToken, darkAlgorithm } = theme;

/**
 * 生成 antd 的颜色变量
 */
export const generateColorVars = () => {
	const colors = [
		getDesignToken(),
		getDesignToken({ algorithm: darkAlgorithm }),
	];

	for (const [index, item] of colors.entries()) {
		const isDark = index !== 0;

		const vars: Record<string, any> = {};

		for (const [key, value] of Object.entries(item)) {
			vars[`--ant-${kebabCase(key)}`] = value;
		}

		const style = document.createElement("style");

		style.dataset.theme = isDark ? "dark" : "light";

		const selector = isDark ? "html.dark" : ":root";

		const values = map(vars, (value, key) => `${key}: ${value};`);

		style.innerHTML = `${selector}{\n${values.join("\n")}\n}`;

		document.head.appendChild(style);
	}
};

/**
 * 将十六进制颜色转换为RGB对象
 * @param hex 十六进制颜色值，如 #ff0000 或 #f00
 * @returns RGB对象或null
 */
export const hexToRgb = (
	hex: string,
): { r: number; g: number; b: number } | null => {
	// 移除可能的#前缀
	const cleanHex = hex.trim().replace(/^#/, "");

	// 验证十六进制格式
	if (!/^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
		return null;
	}

	// 处理简写格式 #f00 -> #ff0000
	let expandedHex = cleanHex;
	if (cleanHex.length === 3) {
		expandedHex = cleanHex
			.split("")
			.map((char) => char + char)
			.join("");
	}

	// 解析RGB值
	const r = Number.parseInt(expandedHex.substring(0, 2), 16);
	const g = Number.parseInt(expandedHex.substring(2, 4), 16);
	const b = Number.parseInt(expandedHex.substring(4, 6), 16);

	return { r, g, b };
};

/**
 * 将RGB值转换为十六进制颜色
 * @param r 红色分量 (0-255)
 * @param g 绿色分量 (0-255)
 * @param b 蓝色分量 (0-255)
 * @returns 十六进制颜色字符串
 */
export const rgbToHex = (r: number, g: number, b: number): string => {
	// 验证输入范围
	if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
		throw new Error("RGB值必须在0-255范围内");
	}

	// 转换为十六进制并补零
	const toHex = (value: number) => {
		const hex = Math.round(value).toString(16);
		return hex.length === 1 ? `0${hex}` : hex;
	};

	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * 解析各种颜色格式
 * @param color 颜色字符串
 * @returns 包含格式和值的对象或null
 */
export const parseColorString = (
	color: string,
): { format: string; values: any } | null => {
	const trimmedColor = color.trim();

	// 检查十六进制格式
	if (trimmedColor.startsWith("#")) {
		const rgb = hexToRgb(trimmedColor);
		if (rgb) {
			return {
				format: "hex",
				values: { ...rgb, hex: trimmedColor },
			};
		}
	}

	// 优先检查向量格式
	// 优先检查4维向量（CMYK格式）
	const cmykVectorRegex =
		/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/;
	const cmykVectorMatch = trimmedColor.match(cmykVectorRegex);
	if (cmykVectorMatch) {
		const c = Number.parseInt(cmykVectorMatch[1], 10);
		const m = Number.parseInt(cmykVectorMatch[2], 10);
		const y = Number.parseInt(cmykVectorMatch[3], 10);
		const k = Number.parseInt(cmykVectorMatch[4], 10);

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
			const rgb = cmykToRgb(c, m, y, k);
			return {
				format: "cmyk",
				values: { c, m, y, k, rgb, hex: rgbToHex(rgb.r, rgb.g, rgb.b) },
			};
		}
	}

	// 检查3维向量（RGB格式）
	const rgbVectorRegex = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/;
	const rgbVectorMatch = trimmedColor.match(rgbVectorRegex);
	if (rgbVectorMatch) {
		const r = Number.parseInt(rgbVectorMatch[1], 10);
		const g = Number.parseInt(rgbVectorMatch[2], 10);
		const b = Number.parseInt(rgbVectorMatch[3], 10);

		if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
			const hex = rgbToHex(r, g, b);

			return {
				format: "rgb",
				values: { r, g, b, hex },
			};
		}
	}

	// 检查RGB格式：rgb(255, 0, 0)
	const rgbRegex = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
	const rgbMatch = trimmedColor.match(rgbRegex);
	if (rgbMatch) {
		const r = Number.parseInt(rgbMatch[1], 10);
		const g = Number.parseInt(rgbMatch[2], 10);
		const b = Number.parseInt(rgbMatch[3], 10);

		if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
			return {
				format: "rgb",
				values: { r, g, b, hex: rgbToHex(r, g, b) },
			};
		}
	}

	// 检查CMYK格式：cmyk(100, 0, 0, 0)
	const cmykRegex =
		/^cmyk\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
	const cmykMatch = trimmedColor.match(cmykRegex);
	if (cmykMatch) {
		const c = Number.parseInt(cmykMatch[1], 10);
		const m = Number.parseInt(cmykMatch[2], 10);
		const y = Number.parseInt(cmykMatch[3], 10);
		const k = Number.parseInt(cmykMatch[4], 10);

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
			const rgb = cmykToRgb(c, m, y, k);
			return {
				format: "cmyk",
				values: { c, m, y, k, rgb, hex: rgbToHex(rgb.r, rgb.g, rgb.b) },
			};
		}
	}

	return null;
};

/**
 * CMYK值接口定义
 */
export interface CmykValue {
	c: number; // 青色 (0-100)
	m: number; // 洋红色 (0-100)
	y: number; // 黄色 (0-100)
	k: number; // 黑色 (0-100)
}

/**
 * 将CMYK值转换为RGB对象
 * @param c 青色分量 (0-100)
 * @param m 洋红色分量 (0-100)
 * @param y 黄色分量 (0-100)
 * @param k 黑色分量 (0-100)
 * @returns RGB对象
 */
export const cmykToRgb = (
	c: number,
	m: number,
	y: number,
	k: number,
): { r: number; g: number; b: number } => {
	// 验证输入范围
	if (
		c < 0 ||
		c > 100 ||
		m < 0 ||
		m > 100 ||
		y < 0 ||
		y > 100 ||
		k < 0 ||
		k > 100
	) {
		throw new Error("CMYK值必须在0-100范围内");
	}

	// 将百分比转换为小数
	const cDecimal = c / 100;
	const mDecimal = m / 100;
	const yDecimal = y / 100;
	const kDecimal = k / 100;

	// 转换公式
	const r = Math.round(255 * (1 - cDecimal) * (1 - kDecimal));
	const g = Math.round(255 * (1 - mDecimal) * (1 - kDecimal));
	const b = Math.round(255 * (1 - yDecimal) * (1 - kDecimal));

	return { r, g, b };
};

/**
 * 将RGB值转换为CMYK对象
 * @param r 红色分量 (0-255)
 * @param g 绿色分量 (0-255)
 * @param b 蓝色分量 (0-255)
 * @returns CMYK对象
 */
export const rgbToCmyk = (r: number, g: number, b: number): CmykValue => {
	// 验证输入范围
	if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
		throw new Error("RGB值必须在0-255范围内");
	}

	// 将RGB值转换为0-1范围
	const rDecimal = r / 255;
	const gDecimal = g / 255;
	const bDecimal = b / 255;

	// 计算黑色分量K
	const k = 1 - Math.max(rDecimal, gDecimal, bDecimal);

	// 如果K为1，则所有颜色都是黑色
	if (k === 1) {
		return { c: 0, m: 0, y: 0, k: 100 };
	}

	// 计算CMY分量
	const c = Math.round(((1 - rDecimal - k) / (1 - k)) * 100);
	const m = Math.round(((1 - gDecimal - k) / (1 - k)) * 100);
	const y = Math.round(((1 - bDecimal - k) / (1 - k)) * 100);
	const kPercent = Math.round(k * 100);

	return { c, m, y, k: kPercent };
};
