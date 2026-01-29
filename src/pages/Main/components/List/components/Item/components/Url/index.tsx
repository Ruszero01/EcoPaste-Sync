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
			align="flex-start"
			gap={6}
			className="pointer-events-none h-full select-text px-2 pt-2.5"
		>
			{/* 网站图标 */}
			<img
				src={`https://www.google.com/s2/favicons?domain=${domain}&sz=48`}
				alt=""
				className="h-full max-h-[32px] w-auto flex-shrink-0 rounded-sm"
				loading="lazy"
				onError={(e) => {
					e.currentTarget.style.display = "none";
				}}
			/>

			<span className="translate-y-[-1px] truncate text-sm leading-tight">
				<span className="font-medium text-primary">{domain}</span>
				<span className="text-gray-400 opacity-80">{path}</span>
			</span>
		</Flex>
	);
};

export default memo(Url);
