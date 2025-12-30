import SyntaxHighlighter from "@/components/SyntaxHighlighter";
import type { HistoryTablePayload } from "@/types/database";
import { parseColorString } from "@/utils/color";
import { Flex } from "antd";
import clsx from "clsx";
import type { CSSProperties, FC } from "react";
import { memo } from "react";

const Text: FC<HistoryTablePayload> = (props) => {
	const { value, type, subtype } = props;

	const renderColor = () => {
		const className = "absolute rounded-full";

		// 解析颜色值，确保能够正确处理各种格式，包括纯向量值
		const parsedColor = parseColorString(value);
		let backgroundStyle = value; // 默认使用原始值

		// 如果是向量格式，转换为CSS可识别的rgb格式
		if (parsedColor) {
			if (parsedColor.format === "rgb") {
				const { r, g, b } = parsedColor.values;
				backgroundStyle = `rgb(${r}, ${g}, ${b})`;
			} else if (parsedColor.format === "cmyk") {
				// 如果是CMYK格式，转换为RGB
				const { rgb } = parsedColor.values;
				backgroundStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
			}
			// 如果是hex格式，直接使用原始值
		}

		const style: CSSProperties = {
			background: backgroundStyle,
		};

		return (
			<Flex align="center" gap="small">
				<div className="relative h-5.5 min-w-5.5">
					<span
						style={style}
						className={clsx(className, "inset-0 opacity-50")}
					/>

					<span style={style} className={clsx(className, "inset-0.5")} />
				</div>

				{value}
			</Flex>
		);
	};

	const renderContent = () => {
		// 检查是否为颜色类型（只检查type字段）
		if (type === "color") {
			return renderColor();
		}

		// 如果是代码类型，使用subtype作为语言
		if (type === "code" && subtype) {
			// 在剪贴板界面中显示语法高亮的纯文本
			return (
				<SyntaxHighlighter
					value={value}
					language={subtype}
					className="line-clamp-4"
				/>
			);
		}

		return value;
	};

	return renderContent();
};

export default memo(Text);
