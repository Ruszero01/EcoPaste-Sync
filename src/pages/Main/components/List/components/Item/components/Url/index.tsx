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
	const [iconError, setIconError] = useState(false);

	return (
		<Flex
			align="center"
			gap={12}
			className="pointer-events-none h-full select-text px-2"
		>
			{/* 网站图标 */}
			{iconError ? (
				<GlobalOutlined
					className="h-full max-h-[24px] w-auto flex-shrink-0 text-gray-400"
					style={{ fontSize: "24px" }}
				/>
			) : (
				<img
					src={`https://www.google.com/s2/favicons?domain=${domain}&sz=48`}
					alt=""
					className="h-full max-h-[32px] w-auto flex-shrink-0 rounded-sm"
					loading="lazy"
					onError={(e) => {
						e.currentTarget.style.display = "none";
						setIconError(true);
					}}
				/>
			)}

			<span className="truncate text-sm leading-tight">
				<span className="font-medium text-primary">{domain}</span>
				<span className="text-gray-400 opacity-80">{path}</span>
			</span>
		</Flex>
	);
};

export default memo(Url);
