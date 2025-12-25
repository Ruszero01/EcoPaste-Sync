import ProList from "@/components/ProList";
import type { Interval } from "@/types/shared";
import Delete from "./components/Delete";
import Duration from "./components/Duration";
import MaxCount from "./components/MaxCount";

const History = () => {
	const { t } = useTranslation();
	const timerRef = useRef<Interval>();

	useImmediate(clipboardStore.history, async () => {
		const { duration, maxCount } = clipboardStore.history;

		clearInterval(timerRef.current);

		if (duration === 0 && maxCount === 0) return;

		const delay = 1000 * 60 * 30;

		// TODO [数据库重构]: 临时禁用自动清理功能
		// 原有逻辑: 查询历史记录 -> 按时间和数量限制删除过期记录
		// 重构计划: 使用后端批量查询和删除命令替换前端SQL调用
		// timerRef.current = setInterval(async () => {
		//     const list = await selectSQL<HistoryTablePayload[]>("history", {
		//         favorite: false,
		//     });
		//     for (const [index, item] of list.entries()) {
		//         const { createTime } = item;
		//         const diffDays = dayjs().diff(createTime, "days");
		//         const isExpired = duration > 0 && diffDays >= duration;
		//         const isOverMaxCount = maxCount > 0 && index >= maxCount;
		//         if (!isExpired && !isOverMaxCount) continue;
		//         deleteSQL("history", item);
		//     }
		// }, delay);
		timerRef.current = setInterval(async () => {
			// 临时禁用，等待重构完成后实现
			// 功能正在重构中，将使用后端数据库命令
		}, delay);
	});

	return (
		<ProList header={t("preference.history.history.title")} footer={<Delete />}>
			<Duration />

			<MaxCount />
		</ProList>
	);
};

export default History;
