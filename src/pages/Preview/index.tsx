import { convertFileSrc } from "@tauri-apps/api/core";
import { Flex } from "antd";
import { type FC, useMemo } from "react";

// 立即从 URL 读取参数，不使用 useEffect 延迟
function getImagePathFromUrl(): string | null {
	const hash = window.location.hash;
	const searchParams = new URLSearchParams(hash.split("?")[1] || "");
	const path = searchParams.get("path");
	return path ? decodeURIComponent(path) : null;
}

const Preview: FC = () => {
	// 使用 useMemo 缓存，避免重复计算
	const imagePath = useMemo(() => getImagePathFromUrl(), []);

	if (!imagePath) {
		return null; // 没有路径时不显示任何内容
	}

	const imageSrc = convertFileSrc(imagePath);

	return (
		<Flex
			align="center"
			justify="center"
			className="h-full w-full overflow-hidden bg-transparent p-2"
		>
			<img
				src={imageSrc}
				alt="Preview"
				className="max-h-full max-w-full rounded object-contain shadow-lg"
			/>
		</Flex>
	);
};

export default Preview;
