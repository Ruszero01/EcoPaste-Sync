import { destroyImagePreview, showImagePreview } from "@/plugins/window";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Flex } from "antd";
import { type FC, memo, useCallback, useEffect, useRef } from "react";
import { useSnapshot } from "valtio";

interface ImageProps extends Partial<HistoryTablePayload> {
	className?: string;
}

// 鼠标悬浮后延迟显示的时间（毫秒）
// 500ms 延迟可以过滤快速划过，只在用户真正想预览时显示
const PREVIEW_DELAY_MS = 500;

const Image: FC<ImageProps> = (props) => {
	const { id, value, width, height, className = "max-h-full" } = props;
	const { imagePreview } = useSnapshot(clipboardStore);
	const previewTimeoutRef = useRef<NodeJS.Timeout>();
	let previewImagePath: string | null = null;

	// 组件卸载时清除定时器（主窗口关闭时可能鼠标还在图片上）
	useEffect(() => {
		return () => {
			clearTimeout(previewTimeoutRef.current);
		};
	}, []);

	// 如果没有值，返回null
	if (!value) {
		return null;
	}

	// 智能图片路径解析
	if (
		typeof value === "string" &&
		(value.startsWith("[") || value.startsWith("{"))
	) {
		try {
			const parsed = JSON.parse(value);
			let filePaths: string[] = [];

			if (Array.isArray(parsed)) {
				if (parsed.length > 0 && typeof parsed[0] === "object") {
					filePaths = parsed
						.map(
							(item: any) =>
								item.originalPath || item.path || item.fileName || "",
						)
						.filter((path: string) => path);
				} else if (parsed.length > 0 && typeof parsed[0] === "string") {
					filePaths = parsed;
				}
			} else if (parsed.files && Array.isArray(parsed.files)) {
				filePaths = parsed.files
					.map(
						(file: any) =>
							file.originalPath || file.path || file.fileName || "",
					)
					.filter((path: string) => path);
			}

			if (filePaths.length > 0) {
				previewImagePath = filePaths[0];
			}
		} catch {}
	} else if (typeof value === "string") {
		previewImagePath = value;
	}

	const imageSrc = previewImagePath ? convertFileSrc(previewImagePath) : null;

	if (!imageSrc) {
		return (
			<div className="flex h-full w-full items-center justify-center text-gray-400 text-xs">
				图片数据格式错误
			</div>
		);
	}

	// 显示预览（延迟触发）
	const handleMouseEnter = useCallback(() => {
		if (!imagePreview.enabled || !previewImagePath || !id) return;

		// 清除之前的预览超时
		clearTimeout(previewTimeoutRef.current);

		// 延迟触发预览
		previewTimeoutRef.current = setTimeout(() => {
			showImagePreview(
				previewImagePath!,
				width ?? undefined,
				height ?? undefined,
			);
		}, PREVIEW_DELAY_MS);
	}, [imagePreview.enabled, previewImagePath, id, width, height]);

	// 隐藏预览
	const handleMouseLeave = useCallback(() => {
		// 清除挂起的预览
		clearTimeout(previewTimeoutRef.current);
		// 销毁预览
		destroyImagePreview();
	}, []);

	return (
		<Flex
			align="center"
			justify="center"
			className="relative h-full w-full overflow-hidden rounded bg-gray-100"
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<img
				src={imageSrc}
				className={`pointer-events-none h-full w-full object-cover ${className}`}
				alt=""
				draggable={false}
			/>
		</Flex>
	);
};

export default memo(Image);
