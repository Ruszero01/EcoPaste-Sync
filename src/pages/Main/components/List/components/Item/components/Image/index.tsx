import type { HistoryTablePayload } from "@/types/database";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Flex } from "antd";
import { type FC, memo } from "react";

interface ImageProps extends Partial<HistoryTablePayload> {
	className?: string;
}

const Image: FC<ImageProps> = (props) => {
	const { value, className = "max-h-full" } = props;

	// 如果没有值，返回null
	if (!value) {
		return null;
	}

	let imageSrc: string | null = null;

	// 智能图片路径解析（支持新旧格式）
	if (
		typeof value === "string" &&
		(value.startsWith("[") || value.startsWith("{"))
	) {
		try {
			const parsed = JSON.parse(value);
			let filePaths: string[] = [];

			if (Array.isArray(parsed)) {
				if (parsed.length > 0 && typeof parsed[0] === "object") {
					// 新格式：文件元数据数组，提取文件路径
					filePaths = parsed
						.map(
							(item: any) =>
								item.originalPath || item.path || item.fileName || "",
						)
						.filter((path: string) => path);
				} else if (parsed.length > 0 && typeof parsed[0] === "string") {
					// 旧格式：文件路径数组
					filePaths = parsed;
				}
			} else if (parsed.files && Array.isArray(parsed.files)) {
				// 新包模式：提取文件路径
				filePaths = parsed.files
					.map(
						(file: any) =>
							file.originalPath || file.path || file.fileName || "",
					)
					.filter((path: string) => path);
			}

			if (filePaths.length > 0) {
				// 使用第一个文件路径显示图片
				const imagePath = filePaths[0];

				// 验证路径格式
				if (
					typeof imagePath === "string" &&
					(imagePath.includes(":") ||
						imagePath.includes("/") ||
						imagePath.includes("\\"))
				) {
					imageSrc = convertFileSrc(imagePath);
				}
			}
		} catch (parseError) {
			console.error("❌ 解析图片路径数组失败:", parseError, { value });
		}
	} else if (typeof value === "string") {
		// 正常的图片显示（单个文件路径）
		imageSrc = convertFileSrc(value);
	}

	if (!imageSrc) {
		return (
			<div className="flex h-full w-full items-center justify-center text-gray-400 text-xs">
				图片数据格式错误
			</div>
		);
	}

	return (
		<Flex
			align="center"
			justify="center"
			className="pointer-events-none h-full w-full overflow-hidden rounded bg-gray-100"
		>
			<img
				src={imageSrc}
				className={`h-full w-full object-cover ${className}`}
				alt=""
				draggable={false}
			/>
		</Flex>
	);
};

export default memo(Image);
