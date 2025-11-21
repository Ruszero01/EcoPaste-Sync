import UnoIcon from "@/components/UnoIcon";
import { globalStore } from "@/stores/global";
import type { HistoryTablePayload } from "@/types/database";
import { Flex } from "antd";
import clsx from "clsx";
import type { FC } from "react";
import { useSnapshot } from "valtio";

interface SyncStatusProps {
	data: HistoryTablePayload;
}

const SyncStatus: FC<SyncStatusProps> = ({ data }) => {
	const { syncStatus, favorite } = data;
	const { appearance } = useSnapshot(globalStore);
	const isDark = appearance.isDark;

	// 获取同步状态的颜色和图标
	const getSyncStatusInfo = () => {
		// 只有真正的已同步状态才显示已同步
		// isCloudData 只是表示数据来源，不应作为同步状态判断
		if (syncStatus === "synced") {
			return {
				color: favorite ? "#fa8c16" : "#0958d9", // 收藏用橘黄色，普通用深蓝色
				icon: favorite ? "i-mdi:cloud-check" : "i-mdi:cloud-outline",
				title: favorite ? "已同步 (收藏)" : "已同步",
			};
		}

		// 同步中状态
		if (syncStatus === "syncing") {
			return {
				color: isDark ? "#d48806" : "#fa8c16", // 暗色模式用深黄色，亮色模式用橘黄色
				icon: "i-mdi:cloud-sync",
				title: "同步中",
			};
		}

		// 同步错误状态
		if (syncStatus === "error") {
			return {
				color: isDark ? "#cf1322" : "#f5222d", // 暗色模式用深红色，亮色模式用亮红色
				icon: "i-mdi:cloud-alert",
				title: "同步失败",
			};
		}

		// 默认未同步状态 - 根据主题模式使用不同的灰色
		return {
			color: isDark ? "#595959" : "#bfbfbf", // 暗色模式用更暗的灰色，亮色模式用中灰色
			icon: "i-mdi:cloud-off-outline",
			title: "未同步",
		};
	};

	const statusInfo = getSyncStatusInfo();

	return (
		<Flex
			align="center"
			justify="center"
			className={clsx(
				"absolute top-0 left-0 h-full w-1 rounded-l-md transition-all duration-300",
				"group-hover:w-1.5",
			)}
			style={{
				backgroundColor: statusInfo.color,
			}}
			title={statusInfo.title}
		>
			<div
				className={clsx(
					"-translate-y-1/2 absolute top-1/2 left-1 opacity-0 transition-opacity duration-200",
					"group-hover:opacity-100",
				)}
			>
				<UnoIcon
					name={statusInfo.icon}
					className="text-xs"
					style={{ color: statusInfo.color }}
				/>
			</div>
		</Flex>
	);
};

export default memo(SyncStatus);
