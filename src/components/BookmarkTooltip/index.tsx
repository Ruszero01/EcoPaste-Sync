import { useAppTheme } from "@/hooks/useTheme";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

interface BookmarkTooltipProps {
	children: React.ReactNode;
	title: string;
	visible?: boolean;
}

const BookmarkTooltip: React.FC<BookmarkTooltipProps> = ({
	children,
	title,
	visible: controlledVisible,
}) => {
	const { theme } = useAppTheme();
	const [internalVisible, setInternalVisible] = useState(false);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	const [showOnLeft, setShowOnLeft] = useState(false);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// 使用外部控制的状态或内部状态
	const visible = controlledVisible ?? internalVisible;

	const showTooltip = useCallback(() => {
		if (containerRef.current) {
			const containerRect = containerRef.current.getBoundingClientRect();

			// 默认显示在右侧，与书签垂直居中对齐
			let left = containerRect.right + 8; // 8px 间距
			let top = containerRect.top + (containerRect.height - 24) / 2; // 24px 是 tooltip 的估计高度
			let tooltipShowOnLeft = false;

			// 预估 tooltip 尺寸进行位置计算
			const estimatedTooltipWidth = 160; // 最大宽度 40 * 4 (估算)
			const estimatedTooltipHeight = 24; // 估算高度

			// 检查是否会超出视窗右边界
			if (left + estimatedTooltipWidth > window.innerWidth) {
				// 如果超出，则显示在左侧
				left = containerRect.left - estimatedTooltipWidth - 8;
				tooltipShowOnLeft = true;
			}

			// 检查是否会超出视窗上边界
			if (top < 8) {
				top = 8; // 最小边距
			}

			// 检查是否会超出视窗下边界
			if (top + estimatedTooltipHeight > window.innerHeight - 8) {
				top = window.innerHeight - estimatedTooltipHeight - 8;
			}

			setPosition({ top, left });
			setShowOnLeft(tooltipShowOnLeft);
			setInternalVisible(true);
		}
	}, []);

	const hideTooltip = () => {
		setInternalVisible(false);
	};

	// 当显示时计算位置
	useEffect(() => {
		if (visible) {
			showTooltip();
		}
	}, [visible, showTooltip]);

	return (
		<div
			ref={containerRef}
			className="relative"
			onMouseEnter={showTooltip}
			onMouseLeave={hideTooltip}
		>
			{children}

			{/* 悬浮预览 */}
			{visible && (
				<div
					ref={tooltipRef}
					className={clsx(
						"pointer-events-none fixed z-50 select-none rounded-md border px-2.5 py-1.5 font-medium text-xs shadow-lg backdrop-blur-xl transition-all duration-200",
						{
							// 浅色模式
							"border-neutral-300/50 bg-neutral-200/90 text-neutral-700":
								theme === "light",
							// 深色模式
							"border-neutral-700/50 bg-neutral-800/90 text-neutral-300":
								theme === "dark",
						},
					)}
					style={{
						top: `${position.top}px`,
						left: `${position.left}px`,
					}}
				>
					{/* 箭头 */}
					<div
						className={clsx("-translate-y-1/2 absolute top-1/2 h-0 w-0", {
							// 箭头指向左侧（显示在右侧时）
							"border-transparent border-t-8 border-r-8 border-r-neutral-200/90 border-b-8":
								!showOnLeft && theme === "light",
							"border-transparent border-t-8 border-r-8 border-r-neutral-800/90 border-b-8":
								!showOnLeft && theme === "dark",
							// 箭头指向右侧（显示在左侧时）
							"border-transparent border-t-8 border-b-8 border-l-8 border-l-neutral-200/90":
								showOnLeft && theme === "light",
							"border-transparent border-t-8 border-b-8 border-l-8 border-l-neutral-800/90":
								showOnLeft && theme === "dark",
						})}
						style={{
							[showOnLeft ? "right" : "left"]: "-8px",
						}}
					/>

					{/* 文本内容 */}
					<span className="relative z-10 max-w-40 truncate">{title}</span>
				</div>
			)}
		</div>
	);
};

export default BookmarkTooltip;
