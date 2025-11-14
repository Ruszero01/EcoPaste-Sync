import type { HistoryTablePayload } from "@/types/database";
import type { FC } from "react";
import { memo } from "react";
import File from "./components/File";

const Files: FC<HistoryTablePayload> = (props) => {
	const { value } = props;

	// 智能文件路径解析逻辑
	let paths: string[] = [];

	try {
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed)) {
			if (parsed.length > 0 && typeof parsed[0] === "object") {
				// 新格式：文件元数据数组，提取文件路径
				paths = parsed
					.map(
						(item: any) =>
							item.originalPath || item.path || item.fileName || "",
					)
					.filter((path: string) => path);
			} else if (parsed.length > 0 && typeof parsed[0] === "string") {
				// 旧格式：文件路径数组
				paths = parsed;
			}
		} else if (parsed.files && Array.isArray(parsed.files)) {
			// 新包模式：提取文件路径
			paths = parsed.files
				.map(
					(file: any) => file.originalPath || file.path || file.fileName || "",
				)
				.filter((path: string) => path);
		}
	} catch (error) {
		console.warn("解析文件路径失败:", error);
		// 如果解析失败，可能是单个文件路径
		paths = [value];
	}

	return paths.map((path) => {
		return <File key={path} path={path} count={paths.length} />;
	});
};

export default memo(Files);
