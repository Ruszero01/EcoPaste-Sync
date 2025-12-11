import type { DragEvent } from "react";

interface DragPreviewProps {
	/**
	 * 预览框显示的文本内容
	 */
	content: string;
	/**
	 * 是否为批量拖拽
	 */
	isBatch?: boolean;
	/**
	 * 批量拖拽时的项目数量
	 */
	batchCount?: number;
}

/**
 * 创建拖拽预览元素并应用到拖拽事件
 * @param event - 拖拽事件对象
 * @param props - 预览框属性
 */
export const createDragPreview = (
	event: DragEvent,
	props: DragPreviewProps,
) => {
	const { content, isBatch = false, batchCount = 0 } = props;
	const dataTransfer = event.dataTransfer;

	if (!dataTransfer) return null;

	// 创建预览元素
	const dragPreview = document.createElement("div");
	const isDarkMode = document.documentElement.classList.contains("dark");

	// 应用样式
	dragPreview.className = `pointer-events-none fixed z-50 select-none rounded-md border px-2.5 py-1.5 font-medium text-xs shadow-lg backdrop-blur-xl transition-all duration-200 ${
		isDarkMode
			? "border-neutral-700/50 bg-neutral-800/90 text-neutral-300"
			: "border-neutral-300/50 bg-neutral-200/90 text-neutral-700"
	}`;

	// 创建箭头元素
	const arrow = document.createElement("div");
	arrow.className = `-translate-y-1/2 absolute top-1/2 h-0 w-0 border-transparent ${
		isDarkMode
			? "border-transparent border-t-8 border-r-8 border-r-neutral-800/90 border-b-8"
			: "border-transparent border-t-8 border-r-8 border-r-neutral-200/90 border-b-8"
	}`;
	arrow.style.left = "-8px";

	// 创建内容元素
	const contentSpan = document.createElement("span");
	contentSpan.className = "relative z-10 max-w-40 truncate";
	contentSpan.style.cssText = `
		max-width: 200px;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: pre-wrap;
	`;

	// 设置内容文本
	if (isBatch && batchCount > 0) {
		contentSpan.textContent = `拖拽 ${batchCount} 个项目`;
	} else {
		contentSpan.textContent = content;
	}

	// 组装元素
	dragPreview.appendChild(arrow);
	dragPreview.appendChild(contentSpan);

	// 设置拖拽图像
	dataTransfer.setDragImage(dragPreview, 0, 20);

	// 将预览元素添加到DOM中（短暂显示后移除）
	document.body.appendChild(dragPreview);
	setTimeout(() => {
		if (document.body.contains(dragPreview)) {
			document.body.removeChild(dragPreview);
		}
	}, 100);

	return dragPreview;
};

export default createDragPreview;
