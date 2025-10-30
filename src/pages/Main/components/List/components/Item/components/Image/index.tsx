import { FileStatusIndicator } from "@/components/FileStatusIndicator";
import type { HistoryTablePayload } from "@/types/database";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FC } from "react";
import { memo } from "react";

interface ImageProps extends Partial<HistoryTablePayload> {
	className?: string;
}

const Image: FC<ImageProps> = (props) => {
	const { value, className = "max-h-full", fileSize, fileType, id } = props;

	// 检查是否为包模式的图片（JSON格式的包信息）
	const isPackageMode = typeof value === "string" && value.startsWith("{");

	let packageInfo = null;
	if (isPackageMode) {
		try {
			const parsed = JSON.parse(value);
			if (parsed.packageId && parsed.originalPaths) {
				packageInfo = parsed;
			}
		} catch (parseError) {
			console.error("解析包信息失败:", parseError);
		}
	}

	// 如果是包模式且有有效的包信息，尝试显示实际图片
	if (isPackageMode && packageInfo && packageInfo.originalPaths) {
		// 尝试从包信息中获取可用的图片路径
		let imagePath = null;

		// 处理可能的数组格式路径
		if (Array.isArray(packageInfo.originalPaths)) {
			for (const path of packageInfo.originalPaths) {
				if (
					typeof path === "string" &&
					(path.includes(":") || path.includes("/") || path.includes("\\"))
				) {
					imagePath = path;
					break;
				}
			}
		}

		// 如果找到了有效的图片路径，尝试显示图片
		if (imagePath) {
			try {
				return <img src={convertFileSrc(imagePath)} className={className} />;
			} catch (error) {
				console.error("显示包模式图片失败:", error);
			}
		}

		// 如果无法显示实际图片，显示包模式占位符
		const syncItem = {
			id,
			type: "image" as const,
			group: "image" as const,
			value,
			fileSize,
			fileType,
		};

		return (
			<div className="flex w-full flex-col items-center gap-2 p-2">
				{/* 包模式图片占位符 */}
				<div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border-2 border-gray-300 border-dashed bg-gray-100">
					<div className="text-center">
						<div className="mb-1 text-gray-400 text-xs">已打包</div>
						<div className="text-gray-500 text-xs">点击复制自动解压</div>
					</div>
				</div>

				{/* 文件状态指示器 */}
				<FileStatusIndicator
					syncItem={syncItem}
					showDetails={true}
					size="small"
				/>
			</div>
		);
	}

	// 常规图片显示逻辑
	if (!value) {
		return null;
	}

	// 检查value是否是JSON数组（新的存储格式）
	if (typeof value === "string" && value.startsWith("[")) {
		try {
			const filePaths = JSON.parse(value);
			if (Array.isArray(filePaths) && filePaths.length > 0) {
				// 使用第一个文件路径显示图片
				const imagePath = filePaths[0];
				return <img src={convertFileSrc(imagePath)} className={className} />;
			}
		} catch (parseError) {
			console.error("❌ 解析图片路径数组失败:", parseError, { value });
		}
	}

	// 检查value是否是JSON对象（包模式或其他异常情况）
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
