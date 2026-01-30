import { destroyImagePreview, showImagePreview } from "@/plugins/window";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Flex } from "antd";
import { type FC, memo, useCallback, useRef } from "react";
import { useSnapshot } from "valtio";

interface ImageProps extends Partial<HistoryTablePayload> {
	className?: string;
}

// 防抖时间（毫秒）
const PREVIEW_DEBOUNCE_MS = 100;

const Image: FC<ImageProps> = (props) => {
	const { id, value, width, height, className = "max-h-full" } = props;
	const { imagePreview } = useSnapshot(clipboardStore);
	const lastPreviewTime = useRef(0);
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

	// 显示预览（带防抖）
	const handleMouseEnter = useCallback(() => {
		if (!imagePreview.enabled || !previewImagePath || !id) return;

		const now = Date.now();
		if (now - lastPreviewTime.current < PREVIEW_DEBOUNCE_MS) {
			return; // 防抖：短时间内忽略重复请求
		}
		lastPreviewTime.current = now;

		showImagePreview(
			previewImagePath!,
			width ?? undefined,
			height ?? undefined,
		);
	}, [imagePreview.enabled, previewImagePath, id, width, height]);

	// 隐藏预览
	const handleMouseLeave = useCallback(() => {
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
