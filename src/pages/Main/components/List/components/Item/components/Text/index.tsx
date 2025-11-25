import SyntaxHighlighter from "@/components/SyntaxHighlighter";
import type { HistoryTablePayload } from "@/types/database";
import { Flex } from "antd";
import clsx from "clsx";
import type { CSSProperties, FC } from "react";
import { memo } from "react";

const Text: FC<HistoryTablePayload> = (props) => {
	const { value, subtype, isCode, codeLanguage } = props;

	const renderColor = () => {
		const className = "absolute rounded-full";
		const style: CSSProperties = {
			background: value,
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
		if (subtype === "color") {
			return renderColor();
		}

		// 如果是代码，根据是否可编辑决定显示方式
		if (isCode && codeLanguage) {
			// 在剪贴板界面中显示语法高亮的纯文本
			return (
				<SyntaxHighlighter
					value={value}
					language={codeLanguage}
					className="line-clamp-4"
				/>
			);
		}

		return value;
	};

	return renderContent();
};

export default memo(Text);
