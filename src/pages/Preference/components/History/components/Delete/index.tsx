import { backendCleanupHistory } from "@/plugins/database";
import { clipboardStore } from "@/stores/clipboard";
import { DeleteOutlined } from "@ant-design/icons";
import { Button, message } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const Cleanup = () => {
	const [loading, setLoading] = useState(false);
	const { t } = useTranslation();

	const handleCleanup = async () => {
		setLoading(true);

		try {
			// 读取配置项
			const { duration, maxCount } = clipboardStore.history;

			// duration 是天数（根据前端配置，unit=1 表示天）
			const retainDays = duration;
			const retainCount = maxCount;

			await backendCleanupHistory({
				retain_days: retainDays,
				retain_count: retainCount,
			});

			message.success("历史记录清理完成");
		} catch (error) {
			message.error(
				`清理失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button
			block
			danger
			icon={<DeleteOutlined />}
			loading={loading}
			onClick={handleCleanup}
		>
			{t("preference.history.history.button.cleanup")}
		</Button>
	);
};

export default Cleanup;
