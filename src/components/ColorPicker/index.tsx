import {
	type CmykValue,
	cmykToRgb,
	hexToRgb,
	parseColorString,
	rgbToCmyk,
	rgbToHex,
} from "@/utils/color";
import { type FC, useEffect, useState } from "react";
import { HexColorPicker, RgbColorPicker } from "react-colorful";

interface ColorPickerProps {
	value?: string;
	onChange?: (color: string) => void;
	format?: "hex" | "rgb" | "cmyk";
}

const ColorPicker: FC<ColorPickerProps> = ({
	value = "#000000",
	onChange,
	format = "hex",
}) => {
	const [colorFormat, setColorFormat] = useState<"hex" | "rgb" | "cmyk">(
		format,
	);
	const [hexColor, setHexColor] = useState(value);
	const [rgbColor, setRgbColor] = useState({ r: 0, g: 0, b: 0 });
	const [cmykColor, setCmykColor] = useState<CmykValue>({
		c: 0,
		m: 0,
		y: 0,
		k: 100,
	});
	const [inputValue, setInputValue] = useState(value);

	// 初始化颜色值
	useEffect(() => {
		if (value) {
			const parsedColor = parseColorString(value);
			if (parsedColor) {
				if (parsedColor.format === "hex") {
					setHexColor(parsedColor.values.hex);
					setRgbColor({
						r: parsedColor.values.r,
						g: parsedColor.values.g,
						b: parsedColor.values.b,
					});
					setCmykColor(
						rgbToCmyk(
							parsedColor.values.r,
							parsedColor.values.g,
							parsedColor.values.b,
						),
					);
					setColorFormat("hex");
				} else if (parsedColor.format === "rgb") {
					setHexColor(parsedColor.values.hex);
					setRgbColor({
						r: parsedColor.values.r,
						g: parsedColor.values.g,
						b: parsedColor.values.b,
					});
					setCmykColor(
						rgbToCmyk(
							parsedColor.values.r,
							parsedColor.values.g,
							parsedColor.values.b,
						),
					);
					setColorFormat("rgb");
				} else if (parsedColor.format === "cmyk") {
					const rgb = parsedColor.values.rgb;
					setHexColor(parsedColor.values.hex);
					setRgbColor(rgb);
					setCmykColor({
						c: parsedColor.values.c,
						m: parsedColor.values.m,
						y: parsedColor.values.y,
						k: parsedColor.values.k,
					});
					setColorFormat("cmyk");
				}
			} else {
				// 如果无法解析，尝试作为十六进制处理
				const rgb = hexToRgb(value);
				if (rgb) {
					setHexColor(value);
					setRgbColor(rgb);
					setCmykColor(rgbToCmyk(rgb.r, rgb.g, rgb.b));
					setColorFormat("hex");
				}
			}
			setInputValue(value);
		}
	}, [value]);

	// 处理颜色变化
	const handleHexChange = (newHex: string) => {
		setHexColor(newHex);
		const rgb = hexToRgb(newHex);
		if (rgb) {
			setRgbColor(rgb);
			setCmykColor(rgbToCmyk(rgb.r, rgb.g, rgb.b));
			setInputValue(newHex);
			onChange?.(newHex);
		}
	};

	const handleRgbChange = (newRgb: { r: number; g: number; b: number }) => {
		setRgbColor(newRgb);
		const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
		const cmyk = rgbToCmyk(newRgb.r, newRgb.g, newRgb.b);
		setHexColor(hex);
		setCmykColor(cmyk);
		// 使用向量格式而不是rgb()格式
		const rgbString = `${newRgb.r}, ${newRgb.g}, ${newRgb.b}`;
		setInputValue(rgbString);
		onChange?.(rgbString);
	};

	const handleCmykChange = (newCmyk: CmykValue) => {
		setCmykColor(newCmyk);
		const rgb = cmykToRgb(newCmyk.c, newCmyk.m, newCmyk.y, newCmyk.k);
		const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
		setRgbColor(rgb);
		setHexColor(hex);
		// 使用向量格式而不是cmyk()格式
		const cmykString = `${newCmyk.c}, ${newCmyk.m}, ${newCmyk.y}, ${newCmyk.k}`;
		setInputValue(cmykString);
		onChange?.(cmykString);
	};

	// 处理输入框变化
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value;
		setInputValue(newValue);

		const parsedColor = parseColorString(newValue);
		if (parsedColor) {
			if (parsedColor.format === "hex") {
				handleHexChange(parsedColor.values.hex);
			} else if (parsedColor.format === "rgb") {
				handleRgbChange({
					r: parsedColor.values.r,
					g: parsedColor.values.g,
					b: parsedColor.values.b,
				});
			} else if (parsedColor.format === "cmyk") {
				handleCmykChange({
					c: parsedColor.values.c,
					m: parsedColor.values.m,
					y: parsedColor.values.y,
					k: parsedColor.values.k,
				});
			}
		}
	};

	// 处理格式切换
	const handleFormatChange = (newFormat: "hex" | "rgb" | "cmyk") => {
		setColorFormat(newFormat);

		if (newFormat === "hex") {
			setInputValue(hexColor);
			onChange?.(hexColor);
		} else if (newFormat === "rgb") {
			// 使用向量格式而不是rgb()格式
			const rgbString = `${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b}`;
			setInputValue(rgbString);
			onChange?.(rgbString);
		} else if (newFormat === "cmyk") {
			// 使用向量格式而不是cmyk()格式
			const cmykString = `${cmykColor.c}, ${cmykColor.m}, ${cmykColor.y}, ${cmykColor.k}`;
			setInputValue(cmykString);
			onChange?.(cmykString);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			{/* 格式选择器 */}
			<div className="flex gap-2">
				<button
					type="button"
					className={`rounded px-3 py-1 text-sm ${
						colorFormat === "hex"
							? "bg-blue-500 text-white"
							: "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
					}`}
					onClick={() => handleFormatChange("hex")}
				>
					HEX
				</button>
				<button
					type="button"
					className={`rounded px-3 py-1 text-sm ${
						colorFormat === "rgb"
							? "bg-blue-500 text-white"
							: "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
					}`}
					onClick={() => handleFormatChange("rgb")}
				>
					RGB
				</button>
				<button
					type="button"
					className={`rounded px-3 py-1 text-sm ${
						colorFormat === "cmyk"
							? "bg-blue-500 text-white"
							: "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
					}`}
					onClick={() => handleFormatChange("cmyk")}
				>
					CMYK
				</button>
			</div>

			{/* 颜色选择器 */}
			<div className="flex justify-center">
				{colorFormat === "hex" && (
					<HexColorPicker color={hexColor} onChange={handleHexChange} />
				)}
				{colorFormat === "rgb" && (
					<RgbColorPicker color={rgbColor} onChange={handleRgbChange} />
				)}
				{colorFormat === "cmyk" && (
					<div className="flex w-full flex-col gap-2">
						{/* C滑块 */}
						<div className="flex flex-col gap-1">
							<div className="flex items-center justify-between">
								<label
									htmlFor="c-slider"
									className="font-medium text-gray-700 text-sm dark:text-gray-300"
								>
									青色 (C)
								</label>
								<span className="rounded bg-gray-100 px-2 py-1 font-mono text-gray-800 text-sm dark:bg-gray-700 dark:text-gray-200">
									{cmykColor.c}%
								</span>
							</div>
							<div className="relative">
								<input
									id="c-slider"
									type="range"
									min="0"
									max="100"
									value={cmykColor.c}
									onChange={(e) =>
										handleCmykChange({
											...cmykColor,
											c: Number(e.target.value),
										})
									}
									className="h-3 w-full cursor-pointer appearance-none rounded-lg bg-gradient-to-r from-gray-100 to-cyan-500 dark:from-gray-700 dark:to-cyan-600"
									style={{
										background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(0, ${255 - cmykColor.c * 2.55}, ${255 - cmykColor.c * 2.55}) 100%)`,
									}}
								/>
							</div>
						</div>

						{/* M滑块 */}
						<div className="flex flex-col gap-1">
							<div className="flex items-center justify-between">
								<label
									htmlFor="m-slider"
									className="font-medium text-gray-700 text-sm dark:text-gray-300"
								>
									洋红 (M)
								</label>
								<span className="rounded bg-gray-100 px-2 py-1 font-mono text-gray-800 text-sm dark:bg-gray-700 dark:text-gray-200">
									{cmykColor.m}%
								</span>
							</div>
							<div className="relative">
								<input
									id="m-slider"
									type="range"
									min="0"
									max="100"
									value={cmykColor.m}
									onChange={(e) =>
										handleCmykChange({
											...cmykColor,
											m: Number(e.target.value),
										})
									}
									className="h-3 w-full cursor-pointer appearance-none rounded-lg bg-gradient-to-r from-gray-100 to-pink-500 dark:from-gray-700 dark:to-pink-600"
									style={{
										background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(${255 - cmykColor.m * 2.55}, 0, ${255 - cmykColor.m * 2.55}) 100%)`,
									}}
								/>
							</div>
						</div>

						{/* Y滑块 */}
						<div className="flex flex-col gap-1">
							<div className="flex items-center justify-between">
								<label
									htmlFor="y-slider"
									className="font-medium text-gray-700 text-sm dark:text-gray-300"
								>
									黄色 (Y)
								</label>
								<span className="rounded bg-gray-100 px-2 py-1 font-mono text-gray-800 text-sm dark:bg-gray-700 dark:text-gray-200">
									{cmykColor.y}%
								</span>
							</div>
							<div className="relative">
								<input
									id="y-slider"
									type="range"
									min="0"
									max="100"
									value={cmykColor.y}
									onChange={(e) =>
										handleCmykChange({
											...cmykColor,
											y: Number(e.target.value),
										})
									}
									className="h-3 w-full cursor-pointer appearance-none rounded-lg bg-gradient-to-r from-gray-100 to-yellow-500 dark:from-gray-700 dark:to-yellow-600"
									style={{
										background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(${255 - cmykColor.y * 2.55}, ${255 - cmykColor.y * 2.55}, 0) 100%)`,
									}}
								/>
							</div>
						</div>

						{/* K滑块 */}
						<div className="flex flex-col gap-1">
							<div className="flex items-center justify-between">
								<label
									htmlFor="k-slider"
									className="font-medium text-gray-700 text-sm dark:text-gray-300"
								>
									黑色 (K)
								</label>
								<span className="rounded bg-gray-100 px-2 py-1 font-mono text-gray-800 text-sm dark:bg-gray-700 dark:text-gray-200">
									{cmykColor.k}%
								</span>
							</div>
							<div className="relative">
								<input
									id="k-slider"
									type="range"
									min="0"
									max="100"
									value={cmykColor.k}
									onChange={(e) =>
										handleCmykChange({
											...cmykColor,
											k: Number(e.target.value),
										})
									}
									className="h-3 w-full cursor-pointer appearance-none rounded-lg bg-gradient-to-r from-gray-100 to-gray-800 dark:from-gray-700 dark:to-gray-900"
									style={{
										background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(${255 - cmykColor.k * 2.55}, ${255 - cmykColor.k * 2.55}, ${255 - cmykColor.k * 2.55}) 100%)`,
									}}
								/>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* 颜色预览和输入框 */}
			<div className="flex items-center gap-2">
				<div
					className="h-10 w-10 rounded border border-gray-300 dark:border-gray-600"
					style={{ backgroundColor: hexColor }}
				/>
				<input
					type="text"
					value={inputValue}
					onChange={handleInputChange}
					className="flex-1 rounded border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
					placeholder="输入颜色值 (HEX/RGB向量/CMYK向量)"
				/>
			</div>
		</div>
	);
};

export default ColorPicker;
