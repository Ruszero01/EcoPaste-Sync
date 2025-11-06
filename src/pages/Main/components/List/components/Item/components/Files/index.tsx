import type { HistoryTablePayload } from "@/types/database";
import type { FC } from "react";
import { memo } from "react";
import File from "./components/File";

const Files: FC<HistoryTablePayload> = (props) => {
	const { value } = props;

	// 常规文件显示逻辑
	let paths: string[] = [];

	try {
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed)) {
			// 常规文件路径数组
			paths = parsed;
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
