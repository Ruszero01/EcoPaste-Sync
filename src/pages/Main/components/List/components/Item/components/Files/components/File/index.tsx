import { convertFileSrc } from "@tauri-apps/api/core";
import { sep } from "@tauri-apps/api/path";
import { Flex } from "antd";
import type { FC } from "react";
import { type Metadata, icon, metadata } from "tauri-plugin-fs-pro-api";
import Image from "../../../Image";

interface FileProps {
	path: string;
	count: number;
}

interface State extends Partial<Metadata> {
	iconPath?: string;
}

const File: FC<FileProps> = (props) => {
	const { path, count } = props;

	const state = useReactive<State>({});

	useAsyncEffect(async () => {
		try {
			const data = await metadata(path, { omitSize: true });

			Object.assign(state, data);

			if (isLinux) return;

			state.iconPath = await icon(path, { size: 256 });
		} catch {
			Object.assign(state, {
				fullName: path.split(sep()).pop(),
			});
		}
	}, [path]);

	const renderFileIcon = () => {
		const iconSrc = state.iconPath ? convertFileSrc(state.iconPath) : null;

		return (
			<div className="aspect-square h-full flex-shrink-0">
				{state.isExist && iconSrc ? (
					<img src={iconSrc} className="h-full w-full object-contain" alt="" />
				) : (
					<div className="flex h-full w-full items-center justify-center">
						<span className="text-gray-400 text-xs">?</span>
					</div>
				)}
			</div>
		);
	};

	const renderContent = () => {
		const height = 100 / Math.min(count, 3);

		// 单个图片文件显示缩略图
		if (state.isExist && count === 1 && isImage(path)) {
			return <Image value={path} />;
		}

		// 文件/文件夹显示图标+名称
		return (
			<Flex
				align="center"
				gap={6}
				className="pointer-events-none h-full select-text px-2"
				style={{ height: `${height}%` }}
			>
				{renderFileIcon()}

				<span className="truncate text-gray-700 text-sm leading-tight dark:text-gray-300">
					{state.fullName}
				</span>
			</Flex>
		);
	};

	return renderContent();
};

export default File;
