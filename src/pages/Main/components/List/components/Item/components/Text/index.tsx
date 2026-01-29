import SyntaxHighlighter from "@/components/SyntaxHighlighter";
import Url from "@/pages/Main/components/List/components/Item/components/Url";
import type { HistoryTablePayload } from "@/types/database";
import { parseColorString } from "@/utils/color";
import { Flex } from "antd";
import type { FC } from "react";
import { memo } from "react";

const Text: FC<HistoryTablePayload> = (props) => {
	const { value, type, subtype } = props;

	const renderColor = () => {
		// 解析颜色值
		const parsedColor = parseColorString(value);
		let backgroundStyle = value;

		if (parsedColor) {
			if (parsedColor.format === "rgb") {
				const { r, g, b } = parsedColor.values;
				backgroundStyle = `rgb(${r}, ${g}, ${b})`;
			} else if (parsedColor.format === "cmyk") {
				const { rgb } = parsedColor.values;
				backgroundStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
			}
		}

		return (
			<Flex
				align="center"
				gap={12}
				className="pointer-events-none h-full translate-y-[-2.5px] select-text px-2"
			>
				{/* 颜色圆圈 */}
				<div
					className="aspect-square h-full max-h-[28px] flex-shrink-0 rounded-full border border-gray-200"
					style={{ background: backgroundStyle }}
				/>

				{/* 颜色值 */}
				<span className="translate-y-[1px] truncate font-mono text-sm uppercase leading-tight">
					{value}
				</span>
			</Flex>
		);
	};

	const renderContent = () => {
		// 检查是否为颜色类型（通过 subtype 判断）
		if (subtype === "color") {
			return renderColor();
		}

		// URL 类型
		if (subtype === "url") {
			return <Url value={value} />;
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
