import ProList from "@/components/ProList";
import { backendCleanupHistory } from "@/plugins/database";
import type { Interval } from "@/types/shared";
import Cleanup from "./components/Delete";
import Duration from "./components/Duration";
import MaxCount from "./components/MaxCount";

const STORAGE_KEY = "ecopaste-next-cleanup-time";
const INTERVAL = 1000 * 60 * 60 * 24; // 24小时

const getNextCleanupTime = () => {
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored ? Number.parseInt(stored, 10) : 0;
};

const setNextCleanupTime = (timestamp: number) => {
	localStorage.setItem(STORAGE_KEY, timestamp.toString());
};

const History = () => {
	const { t } = useTranslation();
	const timerRef = useRef<Interval>();

	const runCleanup = async () => {
		try {
			await backendCleanupHistory({
				retain_days: clipboardStore.history.duration,
				retain_count: clipboardStore.history.maxCount,
			});
		} catch (error) {
			console.error("自动清理失败:", error);
		}
	};

	const scheduleNextCleanup = () => {
		const now = Date.now();
		const nextTime = now + INTERVAL;
		setNextCleanupTime(nextTime);

		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(async () => {
			await runCleanup();
			scheduleNextCleanup();
		}, INTERVAL);
	};

	useImmediate(clipboardStore.history, async () => {
		const { duration, maxCount } = clipboardStore.history;

		clearTimeout(timerRef.current);

		if (duration === 0 && maxCount === 0) return;

		const nextTime = getNextCleanupTime();
		const now = Date.now();
		const remaining = nextTime - now;

		if (remaining <= 0) {
			// 已过期，立即执行并重新计时
			await runCleanup();
			scheduleNextCleanup();
		} else {
			// 继续剩余时间
			timerRef.current = setTimeout(async () => {
				await runCleanup();
				scheduleNextCleanup();
			}, remaining);
		}
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
