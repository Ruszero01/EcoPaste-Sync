import { GlobalOutlined } from "@ant-design/icons";
import { Flex } from "antd";
import type { FC } from "react";
import { memo, useState } from "react";

interface UrlProps {
	value: string;
}

const Url: FC<UrlProps> = ({ value }) => {
	// 提取域名和路径
	const extractDomain = (url: string): { domain: string; path: string } => {
		try {
			const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
			return {
				domain: urlObj.hostname,
				path: urlObj.pathname + urlObj.search,
			};
		} catch {
			const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)(.*)$/);
			if (match) {
				return { domain: match[1], path: match[2] || "" };
			}
			return { domain: url, path: "" };
		}
	};

	const { domain, path } = extractDomain(value);
	const [loadedDomains, setLoadedDomains] = useState<Set<string>>(
		() => new Set(),
	);

	// 标记域名已加载
	const markLoaded = (d: string) => {
		setLoadedDomains((prev) => new Set(prev).add(d));
	};

	// 检查是否已加载
	const showFallback = !loadedDomains.has(domain);

	// 图片加载成功回调
	const handleLoad = () => {
		markLoaded(domain);
	};

	return (
		<Flex
			align="center"
			gap={12}
			className="pointer-events-none h-full select-text px-2"
		>
			{/* 网站图标容器 */}
			<div className="relative h-full max-h-[32px] w-[32px] flex-shrink-0">
				{/* Google favicon */}
				<img
					src={`https://www.google.com/s2/favicons?domain=${domain}&sz=48`}
					alt=""
					className="absolute top-0 left-0 h-full max-h-[32px] w-auto rounded-sm"
					loading="lazy"
					onLoad={handleLoad}
				/>
				{/* 备用地球图标 */}
				<GlobalOutlined
					className={`absolute top-0 left-0 h-full w-full flex-shrink-0 items-center justify-center text-gray-400 ${
						showFallback ? "flex" : "hidden"
					}`}
					style={{ fontSize: "24px" }}
				/>
			</div>

			<span className="truncate text-sm leading-tight">
				<span className="font-medium text-primary">{domain}</span>
				<span className="text-gray-400 opacity-80">{path}</span>
			</span>
		</Flex>
	);
};

export default memo(Url);
