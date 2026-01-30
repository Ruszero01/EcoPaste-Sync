import { GlobalOutlined } from "@ant-design/icons";
import { Flex } from "antd";
import type { FC } from "react";
import { memo } from "react";

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

	return (
		<Flex
			align="center"
			gap={12}
			className="pointer-events-none h-full select-text px-2"
		>
			{/* 网站图标容器 */}
			<div className="relative h-full max-h-[32px] w-auto flex-shrink-0">
				{/* Google favicon - 始终渲染 */}
				<img
					src={`https://www.google.com/s2/favicons?domain=${domain}&sz=48`}
					alt=""
					className="h-full max-h-[32px] w-auto rounded-sm"
					loading="lazy"
					onError={(e) => {
						// 图片加载失败时隐藏，显示备用图标
						e.currentTarget.style.display = "none";
						const fallback = e.currentTarget.nextElementSibling as HTMLElement;
						if (fallback) {
							fallback.style.display = "flex";
						}
					}}
				/>
				{/* 备用地球图标 - 默认隐藏 */}
				<GlobalOutlined
					className="absolute top-0 left-0 hidden h-full max-h-[24px] w-auto flex-shrink-0 items-center justify-center text-gray-400"
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
