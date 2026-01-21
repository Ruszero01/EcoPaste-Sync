import UnoIcon from "@/components/UnoIcon";
import { getForegroundWindowInfo } from "@/plugins/activeWindow";
import { addToBlacklist } from "@/plugins/hotkey";
import { emit } from "@tauri-apps/api/event";
import { App, Flex, Popconfirm } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface BottomStatusBarProps {
	className?: string;
}

interface WindowInfo {
	processName: string;
	windowTitle: string;
}

const BottomStatusBar: React.FC<BottomStatusBarProps> = ({ className }) => {
	const { message } = App.useApp();
	const { t } = useTranslation();
	const [windowInfo, setWindowInfo] = useState<WindowInfo | null>(null);
	const [loading, setLoading] = useState(false);

	// 获取前台窗口信息
	const fetchWindowInfo = useCallback(async () => {
		try {
			const info = await getForegroundWindowInfo();
			if (info?.process_name) {
				setWindowInfo({
					processName: info.process_name.replace(/\.exe$/i, ""),
					windowTitle: info.window_title || "",
				});
			} else {
				setWindowInfo(null);
			}
		} catch {
			setWindowInfo(null);
		}
	}, []);

	// 初始化 + 监听窗口聚焦事件
	useEffect(() => {
		fetchWindowInfo();

		// 监听窗口重新获得焦点
		const unlisten = import("@tauri-apps/api/window")
			.then(({ getCurrentWindow }) => {
				const appWindow = getCurrentWindow();
				return appWindow.onFocusChanged(({ payload: focused }) => {
					if (focused) {
						fetchWindowInfo();
					}
				});
			})
			.catch(() => null);

		return () => {
			unlisten.then((u) => u?.());
		};
	}, [fetchWindowInfo]);

	// 没有窗口信息，不显示
	if (!windowInfo) return null;

	// 添加到黑名单
	const handleAddToBlacklist = async () => {
		setLoading(true);
		try {
			await addToBlacklist(windowInfo.processName);
			message.success(
				t("clipboard.hints.added_to_blacklist", {
					replace: [windowInfo.processName],
				}),
			);
			// 发送事件通知设置页面刷新
			await emit("ecopaste:blacklist-changed");
		} catch {
			message.error(
				t("clipboard.hints.add_to_blacklist_failed", {
					replace: [windowInfo.processName],
				}),
			);
		}
		setLoading(false);
	};

	return (
		<Flex
			align="center"
			justify="space-between"
			gap={8}
			className={className}
			style={{
				padding: "6px 12px",
				borderTop: "1px solid var(--ant-colorBorderSecondary)",
			}}
		>
			{/* 左侧：应用图标和名称 */}
			<Flex
				align="center"
				gap={6}
				className="min-w-0 flex-1 overflow-hidden text-xs"
			>
				<UnoIcon
					name="i-lucide:app-window"
					className="shrink-0 text-color-3 text-sm"
				/>
				<span className="shrink-0 font-medium text-color-3">
					{windowInfo.processName}
				</span>
				{windowInfo.windowTitle && (
					<span className="truncate opacity-35" style={{ opacity: 0.35 }}>
						- {windowInfo.windowTitle}
					</span>
				)}
			</Flex>

			{/* 右侧：加入黑名单按钮 */}
			<Popconfirm
				title={t("clipboard.button.add_to_blacklist")}
				description={t("clipboard.hints.add_to_blacklist_confirm_short", {
					replace: [windowInfo.processName],
				})}
				okText={t("common.confirm")}
				cancelText={t("common.cancel")}
				okButtonProps={{ danger: true }}
				onConfirm={handleAddToBlacklist}
				overlayStyle={{ maxWidth: 240 }}
			>
				<UnoIcon
					name="i-lucide:ban"
					title={t("clipboard.button.add_to_blacklist")}
					className="shrink-0 cursor-pointer text-color-3 text-sm transition hover:text-red-500"
					style={{ opacity: loading ? 0.5 : 1 }}
				/>
			</Popconfirm>
		</Flex>
	);
};

export default BottomStatusBar;
