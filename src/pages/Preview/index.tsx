import { convertFileSrc } from "@tauri-apps/api/core";
import { Flex } from "antd";
import { type FC, useEffect, useState } from "react";

const Preview: FC = () => {
	const [debugInfo, setDebugInfo] = useState<string>("初始化中...");

	useEffect(() => {
		// 直接从 window.location 获取 URL 参数
		const hash = window.location.hash;
		setDebugInfo(`Hash: ${hash}`);

		// 解析 hash 中的参数 (/#/preview?path=xxx)
		const searchParams = new URLSearchParams(hash.split("?")[1] || "");
		const path = searchParams.get("path");

		setDebugInfo(`Path: ${path || "无"}`);

		if (path) {
			// URL 解码
			const decodedPath = decodeURIComponent(path);
			setDebugInfo(`Decoded: ${decodedPath.substring(0, 50)}...`);
			setImagePath(decodedPath);
		}
	}, []);

	const [imagePath, setImagePath] = useState<string | null>(null);

	if (!imagePath) {
		return (
			<Flex
				align="center"
				justify="center"
				className="h-full w-full bg-transparent"
			>
				<div className="text-gray-400 text-sm">加载中... ({debugInfo})</div>
			</Flex>
		);
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
