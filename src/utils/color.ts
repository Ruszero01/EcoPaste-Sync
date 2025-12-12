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
 * 将RGBA值转换为十六进制颜色
 * @param r 红色分量 (0-255)
 * @param g 绿色分量 (0-255)
 * @param b 蓝色分量 (0-255)
 * @param a 透明度 (0-1)
 * @returns 十六进制颜色字符串（包含透明度）
 */
export const rgbaToHex = (
	r: number,
	g: number,
	b: number,
	a: number,
): string => {
	// 验证输入范围
	if (
		r < 0 ||
		r > 255 ||
		g < 0 ||
		g > 255 ||
		b < 0 ||
		b > 255 ||
		a < 0 ||
		a > 1
	) {
		throw new Error("RGB值必须在0-255范围内，透明度必须在0-1范围内");
	}

	// 转换为十六进制并补零
	const toHex = (value: number) => {
		const hex = Math.round(value).toString(16);
		return hex.length === 1 ? `0${hex}` : hex;
	};

	// 转换透明度为十六进制
	const alphaHex = Math.round(a * 255).toString(16);
	const alphaPadded = alphaHex.length === 1 ? `0${alphaHex}` : alphaHex;

	return `#${toHex(r)}${toHex(g)}${toHex(b)}${alphaPadded}`;
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

	// 检查RGBA格式：rgba(255, 0, 0, 0.5)
	const rgbaRegex =
		/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([01]?\.?\d*)\s*\)$/;
	const rgbaMatch = trimmedColor.match(rgbaRegex);
	if (rgbaMatch) {
		const r = Number.parseInt(rgbaMatch[1], 10);
		const g = Number.parseInt(rgbaMatch[2], 10);
		const b = Number.parseInt(rgbaMatch[3], 10);
		const a = Number.parseFloat(rgbaMatch[4]);

		if (
			r >= 0 &&
			r <= 255 &&
			g >= 0 &&
			g <= 255 &&
			b >= 0 &&
			b <= 255 &&
			a >= 0 &&
			a <= 1
		) {
			return {
				format: "rgba",
				values: { r, g, b, a, hex: rgbaToHex(r, g, b, a) },
			};
		}
	}

	// 检查向量格式：255, 0, 0 或 255, 0, 0, 0.5
	const vectorRegex =
		/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(\s*,\s*([01]?\.?\d*))?$/;
	const vectorMatch = trimmedColor.match(vectorRegex);
	if (vectorMatch) {
		const r = Number.parseInt(vectorMatch[1], 10);
		const g = Number.parseInt(vectorMatch[2], 10);
		const b = Number.parseInt(vectorMatch[3], 10);
		const hasAlpha = vectorMatch[4] !== undefined;
		const a = hasAlpha ? Number.parseFloat(vectorMatch[5]) : 1;

		if (
			r >= 0 &&
			r <= 255 &&
			g >= 0 &&
			g <= 255 &&
			b >= 0 &&
			b <= 255 &&
			(!hasAlpha || (a >= 0 && a <= 1))
		) {
			const format = hasAlpha ? "rgba" : "rgb";
			const hex = hasAlpha ? rgbaToHex(r, g, b, a) : rgbToHex(r, g, b);

			return {
				format,
				values: hasAlpha ? { r, g, b, a, hex } : { r, g, b, hex },
			};
		}
	}

	return null;
};

/**
 * 将RGB值转换为向量格式字符串
 * @param r 红色分量 (0-255)
 * @param g 绿色分量 (0-255)
 * @param b 蓝色分量 (0-255)
 * @returns 向量格式字符串 "r, g, b"
 */
export const rgbToVector = (r: number, g: number, b: number): string => {
	// 验证输入范围
	if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
		throw new Error("RGB值必须在0-255范围内");
	}

	return `${r}, ${g}, ${b}`;
};

/**
 * 将RGBA值转换为向量格式字符串
 * @param r 红色分量 (0-255)
 * @param g 绿色分量 (0-255)
 * @param b 蓝色分量 (0-255)
 * @param a 透明度 (0-1)
 * @returns 向量格式字符串 "r, g, b, a"
 */
export const rgbaToVector = (
	r: number,
	g: number,
	b: number,
	a: number,
): string => {
	// 验证输入范围
	if (
		r < 0 ||
		r > 255 ||
		g < 0 ||
		g > 255 ||
		b < 0 ||
		b > 255 ||
		a < 0 ||
		a > 1
	) {
		throw new Error("RGB值必须在0-255范围内，透明度必须在0-1范围内");
	}

	return `${r}, ${g}, ${b}, ${a}`;
};
