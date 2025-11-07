import type { HistoryTablePayload } from "@/types/database";
import { convertFileSrc } from "@tauri-apps/api/core";
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

	// 检查value是否是JSON数组（多图片格式）
	if (typeof value === "string" && value.startsWith("[")) {
		try {
			const filePaths = JSON.parse(value);
			if (Array.isArray(filePaths) && filePaths.length > 0) {
				// 使用第一个文件路径显示图片
				const imagePath = filePaths[0];

				// 验证路径格式
				if (
					typeof imagePath === "string" &&
					(imagePath.includes(":") ||
						imagePath.includes("/") ||
						imagePath.includes("\\"))
				) {
					return <img src={convertFileSrc(imagePath)} className={className} />;
				}

				console.error("❌ 数组中的图片路径格式无效:", { imagePath, filePaths });
			}
		} catch (parseError) {
			console.error("❌ 解析图片路径数组失败:", parseError, { value });
		}
	}

	// 如果是JSON对象格式（异常情况），返回错误提示
	if (typeof value === "string" && value.startsWith("{")) {
		console.error("❌ 图片组件收到JSON对象而不是文件路径:", value);
		return (
			<div className="flex items-center justify-center p-4 text-red-500 text-xs">
				图片数据格式错误
			</div>
		);
	}

	// 正常的图片显示（单个文件路径）
	try {
		return <img src={convertFileSrc(value)} className={className} />;
	} catch (error) {
		console.error("❌ 图片显示失败:", error, { value });
		return (
			<div className="flex items-center justify-center p-4 text-gray-400 text-xs">
				图片加载失败
			</div>
		);
	}
};

export default memo(Image);
