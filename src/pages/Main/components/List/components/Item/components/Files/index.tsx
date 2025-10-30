import { FileStatusIndicator } from "@/components/FileStatusIndicator";
import { LazyDownloadButton } from "@/components/LazyDownloadButton";
import { LISTEN_KEY } from "@/constants";
import { updateSQL } from "@/database";
import { useLazyDownload } from "@/hooks/useLazyDownload";
import type { HistoryTablePayload } from "@/types/database";
import { emit } from "@tauri-apps/api/event";
import { message } from "antd";
import type { FC } from "react";
import { memo } from "react";
import File from "./components/File";

const Files: FC<HistoryTablePayload> = (props) => {
	const { value, lazyDownload, fileSize, fileType, id } = props;
	useLazyDownload();

	// 检查是否为按需下载的文件
	if (lazyDownload) {
		// 构造SyncItem对象用于懒加载组件
		const syncItem = {
			id,
			type: "files" as const,
			group: "files" as const,
			value,
			lazyDownload: true,
			fileSize,
			fileType,
		};

		const handleDownloadComplete = async (fileData: Uint8Array | null) => {
			if (fileData) {
				try {
					// 动态导入fileContentProcessor处理文件数据
					const { fileContentProcessor } = await import(
						"@/utils/fileContentProcessor"
					);
					const { getServerConfig } = await import("@/plugins/webdav");

					const webdavConfig = await getServerConfig();
					if (!webdavConfig) {
						message.error("WebDAV配置未设置");
						return;
					}

					// 处理文件数组内容恢复
					const processedValue = await fileContentProcessor.processFilesContent(
						syncItem,
						webdavConfig,
					);

					if (processedValue) {
						// 更新数据库记录，更新value字段并移除lazyDownload标记
						await updateSQL("history", {
							id,
							value: processedValue,
							lazyDownload: false,
						});

						message.success("文件下载并恢复成功");

						// 触发界面刷新以显示恢复的文件
						emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					} else {
						message.error("文件恢复失败");
					}
				} catch (error) {
					message.error("文件处理失败");
					console.error("文件处理失败:", error);
				}
			} else {
				message.error("文件下载失败");
			}
		};

		return (
			<div style={{ padding: "8px", width: "100%" }}>
				{/* 文件状态指示器 */}
				<div style={{ marginBottom: "8px" }}>
					<FileStatusIndicator
						syncItem={syncItem}
						showDetails={true}
						size="small"
					/>
				</div>

				{/* 下载按钮 */}
				<LazyDownloadButton
					syncItem={syncItem}
					onDownloadComplete={handleDownloadComplete}
					size="small"
					type="primary"
					showProgress={true}
					showFileSize={true}
				/>
			</div>
		);
	}

	// 常规文件显示逻辑
	let paths: string[] = [];
	try {
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed)) {
			// 常规文件路径数组
			paths = parsed;
		} else if (parsed.packageId && parsed.originalPaths) {
			// 包模式，使用originalPaths
			paths = parsed.originalPaths;
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
