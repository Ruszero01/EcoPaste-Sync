import { useLazyDownload } from "@/hooks/useLazyDownload";
import type { SyncItem } from "@/types/sync";
import {
	CheckCircleOutlined,
	CloudDownloadOutlined,
	InfoCircleOutlined,
} from "@ant-design/icons";
import { Badge, Space, Tag, Tooltip } from "antd";
import type { FC } from "react";

interface FileStatusIndicatorProps {
	syncItem: SyncItem;
	showDetails?: boolean;
	size?: "small" | "default";
}

/**
 * 文件状态指示器组件
 */
export const FileStatusIndicator: FC<FileStatusIndicatorProps> = ({
	syncItem,
	showDetails = false,
	size = "default",
}) => {
	const { isFileAvailable, getFileSize, getFileType } = useLazyDownload();

	// 如果不是按需下载文件，不显示状态
	if (!syncItem.lazyDownload) {
		return null;
	}

	const isAvailable = isFileAvailable(syncItem);
	const fileSize = getFileSize(syncItem);
	const fileType = getFileType(syncItem);

	const getFileSizeDisplay = () => {
		if (!fileSize) return "";

		const size = fileSize;
		if (size < 1024) return `${size}B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
		return `${(size / (1024 * 1024)).toFixed(1)}MB`;
	};

	const getStatusIcon = () => {
		if (isAvailable) {
			return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
		}
		return <CloudDownloadOutlined style={{ color: "#1890ff" }} />;
	};

	const getStatusText = () => {
		if (isAvailable) {
			return "已缓存";
		}
		return "需下载";
	};

	const getStatusColor = () => {
		if (isAvailable) {
			return "success";
		}
		return "processing";
	};

	const getDetailsContent = () => {
		const details = [
			`类型: ${fileType}`,
			`大小: ${getFileSizeDisplay()}`,
			`状态: ${getStatusText()}`,
		];

		if (!isAvailable) {
			details.push("点击下载按钮获取文件内容");
		}

		return details.join("\n");
	};

	if (size === "small") {
		return (
			<Tooltip title={getDetailsContent()}>
				<Space size="small">
					{getStatusIcon()}
					{showDetails && (
						<span style={{ fontSize: 12 }}>{getFileSizeDisplay()}</span>
					)}
				</Space>
			</Tooltip>
		);
	}

	return (
		<Space direction="vertical" size="small" style={{ width: "100%" }}>
			<Space>
				<Badge status={getStatusColor()} />
				<span>
					{fileType.toUpperCase()} - {getFileSizeDisplay()}
				</span>
			</Space>

			<Space>
				{getStatusIcon()}
				<span style={{ fontSize: 12, color: "#666" }}>{getStatusText()}</span>

				{showDetails && (
					<Tooltip title={getDetailsContent()}>
						<InfoCircleOutlined style={{ color: "#999", cursor: "help" }} />
					</Tooltip>
				)}
			</Space>

			{!isAvailable && <Tag color="blue">按需下载</Tag>}
		</Space>
	);
};
