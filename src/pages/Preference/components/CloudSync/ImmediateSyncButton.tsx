import { LISTEN_KEY } from "@/constants";
import { useTauriListen } from "@/hooks/useTauriListen";
import { syncEngine } from "@/utils/syncEngine";
import { CloudSyncOutlined, ScheduleOutlined } from "@ant-design/icons";
import { Button, Flex, List, Typography, message } from "antd";
import { useState } from "react";

const { Text } = Typography;

interface ImmediateSyncButtonProps {
	isSyncing?: boolean;
	connectionStatus?: "idle" | "testing" | "success" | "failed";
	lastSyncTime?: number;
	onSyncStart?: () => void;
	onSyncComplete?: (timestamp: number) => void;
	onLog?: (
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) => void;
}

// 格式化同步时间显示
const formatSyncTime = (timestamp: number): string => {
	if (!timestamp || timestamp === 0) return "";

	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffMins < 1) {
		return "刚刚";
	}
	if (diffMins < 60) {
		return `${diffMins}分钟前`;
	}
	if (diffHours < 24) {
		return `${diffHours}小时前`;
	}
	if (diffDays < 7) {
		return `${diffDays}天前`;
	}
	return date.toLocaleDateString(); // 显示具体日期
};

const ImmediateSyncButton = ({
	isSyncing = false,
	connectionStatus = "idle",
	lastSyncTime = 0,
	onSyncStart,
	onSyncComplete,
	onLog,
}: ImmediateSyncButtonProps) => {
	const [localIsSyncing, setLocalIsSyncing] = useState(false);

	// 保存上次同步时间到本地存储
	const saveLastSyncTime = (timestamp: number) => {
		try {
			localStorage.setItem("ecopaste-last-sync-time", timestamp.toString());
		} catch (error) {
			console.warn("保存上次同步时间失败:", error);
		}
	};

	// 添加日志
	const addLog = (
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) => {
		onLog?.(level, message, data);
	};

	// 监听自动同步触发事件
	useTauriListen(
		LISTEN_KEY.TRIGGER_MANUAL_SYNC,
		(event: { payload?: { type?: string } }) => {
			console.info("🎯 收到自动同步触发事件:", event.payload);

			// 只有在自动同步触发时才执行
			if (event.payload?.type === "auto_trigger") {
				addLog("info", "⏰ 自动同步触发");
				// 调用同步处理函数
				handleImmediateSync();
			}
		},
	);

	// 立即同步处理函数
	const handleImmediateSync = async () => {
		if (localIsSyncing || isSyncing) {
			return;
		}

		if (connectionStatus !== "success") {
			message.error("请先检查网络连接");
			return;
		}

		setLocalIsSyncing(true);
		onSyncStart?.();
		addLog("info", "🚀 开始同步...");

		try {
			// 使用统一的同步引擎方法
			addLog("info", "🔄 执行双向同步...");
			const syncResult = await syncEngine.performBidirectionalSync();

			if (syncResult.success) {
				const timestamp = syncResult.timestamp;

				// 更新同步时间
				saveLastSyncTime(timestamp);
				onSyncComplete?.(timestamp);

				// 显示成功消息
				const totalCount =
					syncResult.downloaded + syncResult.uploaded + syncResult.deleted;
				let successMessage: string;
				if (totalCount === 0) {
					successMessage = "无需同步";
				} else {
					const parts = [];
					if (syncResult.uploaded > 0)
						parts.push(`上传 ${syncResult.uploaded} 条`);
					if (syncResult.downloaded > 0)
						parts.push(`下载 ${syncResult.downloaded} 条`);
					if (syncResult.deleted > 0)
						parts.push(`删除 ${syncResult.deleted} 条`);
					successMessage = `已同步：${parts.join("，")}`;
				}

				message.success(successMessage);
				addLog("success", "✅ 同步完成", {
					uploaded: syncResult.uploaded,
					downloaded: syncResult.downloaded,
					deleted: syncResult.deleted,
					duration: `${syncResult.duration}ms`,
				});
			} else {
				throw new Error(syncResult.errors?.join(", ") || "同步失败");
			}
		} catch (error) {
			addLog("error", "❌ 同步失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			message.error("同步失败，请查看日志");
		} finally {
			setLocalIsSyncing(false);
		}
	};

	const isCurrentlySyncing = localIsSyncing || isSyncing;

	return (
		<List.Item>
			<div style={{ position: "relative", width: "100%" }}>
				<Flex justify="center" align="center" style={{ padding: "2px 0" }}>
					<Button
						type="primary"
						size="middle"
						icon={<CloudSyncOutlined />}
						loading={isCurrentlySyncing}
						onClick={handleImmediateSync}
						disabled={connectionStatus !== "success"}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: "0px",
							minWidth: "120px",
						}}
					>
						立即同步
					</Button>
				</Flex>

				{/* 同步时间显示 */}
				{lastSyncTime > 0 && (
					<div
						style={{
							position: "absolute",
							right: "2px",
							top: "50%",
							transform: "translateY(-50%)",
							display: "flex",
							alignItems: "center",
							gap: "8px",
							padding: "2px 8px",
							backgroundColor: "rgba(82, 196, 26, 0.05)",
							borderRadius: "4px",
							border: "1px solid rgba(82, 196, 26, 0.15)",
						}}
					>
						<ScheduleOutlined style={{ fontSize: "14px", color: "#52c41a" }} />
						<Text type="secondary" style={{ fontSize: "12px" }}>
							{formatSyncTime(lastSyncTime)}
						</Text>
					</div>
				)}
			</div>
		</List.Item>
	);
};

export default ImmediateSyncButton;
