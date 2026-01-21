import ProList from "@/components/ProList";
import {
	type BlacklistItem,
	getBlacklist,
	removeFromBlacklist,
} from "@/plugins/hotkey";
import { listen } from "@tauri-apps/api/event";
import { App, Flex, List, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const { Text } = Typography;

const Blacklist = () => {
	const { t } = useTranslation();
	const { modal, message } = App.useApp();

	const [blacklist, setBlacklist] = useState<BlacklistItem[]>([]);
	const [loading, setLoading] = useState(false);

	const fetchBlacklist = useCallback(async () => {
		setLoading(true);
		try {
			const data = await getBlacklist();
			setBlacklist(data);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		const unlisten = listen("ecopaste:blacklist-changed", () => {
			fetchBlacklist();
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [fetchBlacklist]);

	useEffect(() => {
		fetchBlacklist();
	}, [fetchBlacklist]);

	const handleRemove = (processName: string) => {
		modal.confirm({
			title: t("preference.shortcut.blacklist.remove_title"),
			content: t("preference.shortcut.blacklist.remove_content", {
				replace: [processName],
			}),
			okText: t("common.confirm"),
			cancelText: t("common.cancel"),
			okButtonProps: { danger: true },
			onOk: async () => {
				try {
					await removeFromBlacklist(processName);
					message.success(t("preference.shortcut.blacklist.remove_success"));
					await fetchBlacklist();
				} catch {
					message.error(t("preference.shortcut.blacklist.remove_failed"));
				}
			},
		});
	};

	const formatTime = (timestamp: number) => {
		const timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
		const date = new Date(timestampMs);
		return date.toLocaleString();
	};

	return (
		<ProList
			header={t("preference.shortcut.blacklist.title")}
			loading={loading}
		>
			{blacklist.length === 0 ? (
				<List.Item>
					<Text type="secondary" className="w-full text-center">
						{t("preference.shortcut.blacklist.empty")}
					</Text>
				</List.Item>
			) : (
				<List
					dataSource={blacklist}
					rowKey="processName"
					renderItem={(item) => (
						<List.Item
							actions={[
								<Text
									key="delete"
									className="cursor-pointer text-[var(--ant-colorError)]"
									onClick={() => handleRemove(item.processName)}
								>
									{t("common.delete")}
								</Text>,
							]}
						>
							<Flex vertical gap={4} className="flex-1">
								<Flex align="center" gap={8}>
									<Text strong>{item.processName}</Text>
									{!item.enabled && (
										<Tag color="default">
											{t("preference.shortcut.blacklist.disabled")}
										</Tag>
									)}
								</Flex>
								<Text type="secondary" className="text-xs">
									{t("preference.shortcut.blacklist.added_time", {
										replace: [formatTime(item.addedTime)],
									})}
								</Text>
							</Flex>
						</List.Item>
					)}
				/>
			)}
		</ProList>
	);
};

export default Blacklist;
