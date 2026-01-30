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

const Image: FC<ImageProps> = (props) => {
	const { id, value, width, height, className = "max-h-full" } = props;
	const { imagePreview } = useSnapshot(clipboardStore);
	const previewTimerRef = useRef<NodeJS.Timeout | null>(null);
	let previewImagePath: string | null = null;

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

	// 清理定时器
	const clearPreviewTimer = useCallback(() => {
		if (previewTimerRef.current) {
			clearTimeout(previewTimerRef.current);
			previewTimerRef.current = null;
		}
	}, []);

	// 显示预览
	const handleMouseEnter = useCallback(() => {
		if (!imagePreview.enabled || !previewImagePath || !id) return;

		// 清除之前的定时器
		clearPreviewTimer();

		// 使用配置的延迟时间
		const delay = imagePreview.delay || 0;

		if (delay > 0) {
			// 延迟预览
			previewTimerRef.current = setTimeout(() => {
				showImagePreview(
					previewImagePath!,
					width ?? undefined,
					height ?? undefined,
				);
			}, delay);
		} else {
			// 立即预览
			showImagePreview(
				previewImagePath!,
				width ?? undefined,
				height ?? undefined,
			);
		}
	}, [
		imagePreview.enabled,
		imagePreview.delay,
		previewImagePath,
		id,
		width,
		height,
		clearPreviewTimer,
	]);

	// 隐藏预览
	const handleMouseLeave = useCallback(() => {
		clearPreviewTimer();
		destroyImagePreview();
	}, [clearPreviewTimer]);

	// 组件卸载时清理
	useEffect(() => {
		return () => {
			clearPreviewTimer();
		};
	}, [clearPreviewTimer]);

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
