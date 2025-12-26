import ProList from "@/components/ProList";
import { backendCleanupHistory } from "@/plugins/database";
import type { Interval } from "@/types/shared";
import Cleanup from "./components/Delete";
import Duration from "./components/Duration";
import MaxCount from "./components/MaxCount";

const History = () => {
	const { t } = useTranslation();
	const timerRef = useRef<Interval>();

	useImmediate(clipboardStore.history, async () => {
		const { duration, maxCount } = clipboardStore.history;

		clearInterval(timerRef.current);

		if (duration === 0 && maxCount === 0) return;

		const delay = 1000 * 60 * 30; // 30分钟

		timerRef.current = setInterval(async () => {
			try {
				await backendCleanupHistory({
					retain_days: duration,
					retain_count: maxCount,
				});
			} catch (error) {
				console.error("自动清理失败:", error);
			}
		}, delay);
	});

	return (
		<ProList
			header={t("preference.history.history.title")}
			footer={<Cleanup />}
		>
			<Duration />

			<MaxCount />
		</ProList>
	);
};

export default History;
