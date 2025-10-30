import { useLazyDownload } from "@/hooks/useLazyDownload";
import type { SyncItem } from "@/types/sync";
import {
	CheckCircleOutlined,
	DownloadOutlined,
	ExclamationCircleOutlined,
} from "@ant-design/icons";
import { Button, Progress, Space, Tooltip } from "antd";
import type { FC } from "react";

interface LazyDownloadButtonProps {
	syncItem: SyncItem;
	onDownloadComplete?: (fileData: Uint8Array | null) => void;
	size?: "small" | "middle" | "large";
	type?: "primary" | "default" | "dashed" | "link" | "text";
	showProgress?: boolean;
	showFileSize?: boolean;
}

/**
 * 按需下载按钮组件
 */
export const LazyDownloadButton: FC<LazyDownloadButtonProps> = ({
	syncItem,
	onDownloadComplete,
	size = "small",
	type = "default",
	showProgress = true,
	showFileSize = false,
}) => {
	const {
		isDownloading,
		getDownloadProgress,
		getDownloadError,
		downloadFile,
		clearError,
	} = useLazyDownload();

	const isDownloadingItem = isDownloading(syncItem.id);
	const downloadProgress = getDownloadProgress(syncItem.id);
	const downloadError = getDownloadError(syncItem.id);

	const handleDownload = async () => {
		if (downloadError) {
			clearError(syncItem.id);
		}

		const fileData = await downloadFile(syncItem, (_progress) => {
			// 进度回调会自动更新状态
		});

		onDownloadComplete?.(fileData);
	};

	const getFileSizeDisplay = () => {
		if (!syncItem.fileSize) return "";

		const size = syncItem.fileSize;
		if (size < 1024) return `${size}B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
		return `${(size / (1024 * 1024)).toFixed(1)}MB`;
	};

	const renderButton = () => {
		if (isDownloadingItem) {
			return (
				<Button size={size} type={type} loading disabled>
					下载中...
				</Button>
			);
		}

		if (downloadError) {
			return (
				<Tooltip title={`下载失败: ${downloadError}`}>
					<Button
						size={size}
						type={type}
						danger
						icon={<ExclamationCircleOutlined />}
						onClick={handleDownload}
					>
						重试
					</Button>
				</Tooltip>
			);
		}

		return (
			<Tooltip
				title={`下载 ${syncItem.fileType || "文件"}${showFileSize ? ` (${getFileSizeDisplay()})` : ""}`}
			>
				<Button
					size={size}
					type={type}
					icon={<DownloadOutlined />}
					onClick={handleDownload}
				>
					下载
				</Button>
			</Tooltip>
		);
	};

	return (
		<div className="lazy-download-button">
			<Space direction="vertical" size="small" style={{ width: "100%" }}>
				{renderButton()}

				{showProgress && isDownloadingItem && (
					<Progress
						percent={downloadProgress}
						size="small"
						strokeWidth={4}
						showInfo={false}
					/>
				)}

				{showProgress && downloadProgress > 0 && !isDownloadingItem && (
					<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
						<CheckCircleOutlined style={{ color: "#52c41a", fontSize: 12 }} />
						<span style={{ fontSize: 12, color: "#666" }}>
							已下载 {getFileSizeDisplay()}
						</span>
					</div>
				)}

				{downloadError && (
					<div style={{ fontSize: 12, color: "#ff4d4f", maxWidth: 200 }}>
						{downloadError}
					</div>
				)}
			</Space>
		</div>
	);
};
