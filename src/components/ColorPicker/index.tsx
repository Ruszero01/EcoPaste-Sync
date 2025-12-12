import { hexToRgb, parseColorString, rgbToHex } from "@/utils/color";
import { type FC, useEffect, useState } from "react";
import { HexColorPicker, RgbColorPicker } from "react-colorful";

interface ColorPickerProps {
	value?: string;
	onChange?: (color: string) => void;
	format?: "hex" | "rgb";
}

const ColorPicker: FC<ColorPickerProps> = ({
	value = "#000000",
	onChange,
	format = "hex",
}) => {
	const [colorFormat, setColorFormat] = useState<"hex" | "rgb">(format);
	const [hexColor, setHexColor] = useState(value);
	const [rgbColor, setRgbColor] = useState({ r: 0, g: 0, b: 0 });
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
					setColorFormat("hex");
				} else if (parsedColor.format === "rgb") {
					setHexColor(parsedColor.values.hex);
					setRgbColor({
						r: parsedColor.values.r,
						g: parsedColor.values.g,
						b: parsedColor.values.b,
					});
					setColorFormat("rgb");
				}
			} else {
				// 如果无法解析，尝试作为十六进制处理
				const rgb = hexToRgb(value);
				if (rgb) {
					setHexColor(value);
					setRgbColor(rgb);
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
			setInputValue(newHex);
			onChange?.(newHex);
		}
	};

	const handleRgbChange = (newRgb: { r: number; g: number; b: number }) => {
		setRgbColor(newRgb);
		const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
		setHexColor(hex);
		const rgbString = `rgb(${newRgb.r}, ${newRgb.g}, ${newRgb.b})`;
		setInputValue(rgbString);
		onChange?.(rgbString);
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
			}
		}
	};

	// 处理格式切换
	const handleFormatChange = (newFormat: "hex" | "rgb") => {
		setColorFormat(newFormat);

		if (newFormat === "hex") {
			setInputValue(hexColor);
			onChange?.(hexColor);
		} else if (newFormat === "rgb") {
			const rgbString = `rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`;
			setInputValue(rgbString);
			onChange?.(rgbString);
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
							: "bg-gray-200 text-gray-700 hover:bg-gray-300"
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
							: "bg-gray-200 text-gray-700 hover:bg-gray-300"
					}`}
					onClick={() => handleFormatChange("rgb")}
				>
					RGB
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
			</div>

			{/* 颜色预览和输入框 */}
			<div className="flex items-center gap-2">
				<div
					className="h-10 w-10 rounded border border-gray-300"
					style={{ backgroundColor: inputValue }}
				/>
				<input
					type="text"
					value={inputValue}
					onChange={handleInputChange}
					className="flex-1 rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="输入颜色值 (HEX/RGB)"
				/>
			</div>
		</div>
	);
};

export default ColorPicker;
