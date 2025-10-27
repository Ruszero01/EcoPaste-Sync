import Scrollbar from "@/components/Scrollbar";
import { useTauriFocus } from "@/hooks/useTauriFocus";
import type { HistoryTablePayload } from "@/types/database";
import { useKeyPress } from "ahooks";
import { Flex, Tag } from "antd";
import clsx from "clsx";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { MainContext } from "../..";

interface GroupItem extends Partial<HistoryTablePayload> {
	key: string;
	label: string;
}

const Group = () => {
	const { state, getListCache, getListDebounced } = useContext(MainContext);
	const { t } = useTranslation();
	const [checked, setChecked] = useState("all");

	const groupList: GroupItem[] = [
		{
			key: "all",
			label: t("clipboard.label.tab.all"),
		},
		{
			key: "text",
			label: t("clipboard.label.tab.text"),
			group: "text",
		},
		{
			key: "image",
			label: t("clipboard.label.tab.image"),
			group: "image",
		},
		{
			key: "file",
			label: t("clipboard.label.tab.files"),
			group: "files",
		},
		{
			key: "favorite",
			label: t("clipboard.label.tab.favorite"),
			favorite: true,
		},
	];

	useTauriFocus({
		onFocus() {
			if (!clipboardStore.window.showAll) return;

			handleChange(groupList[0]);
		},
	});

	useKeyPress("tab", (event) => {
		const index = groupList.findIndex((item) => item.key === checked);
		const length = groupList.length;

		let nextIndex = index;

		if (event.shiftKey) {
			nextIndex = index === 0 ? length - 1 : index - 1;
		} else {
			nextIndex = index === length - 1 ? 0 : index + 1;
		}

		handleChange(groupList[nextIndex]);
	});

	const handleChange = (item: GroupItem) => {
		const { key, group, favorite } = item;

		setChecked(key);

		// 确保正确更新响应式状态
		state.group = group;
		state.favorite = favorite;

		// 强制触发列表刷新 - 清除缓存并重新加载
		if (getListCache?.current) {
			getListCache.current.clear();
		}
		if (getListDebounced) {
			getListDebounced(50);
		}
	};

	return (
		<Scrollbar thumbSize={0}>
			<Flex data-tauri-drag-region>
				{groupList.map((item) => {
					const { key, label } = item;

					const isChecked = checked === key;

					return (
						<Tag.CheckableTag
							key={key}
							checked={isChecked}
							className={clsx({ "bg-primary!": isChecked })}
							onChange={() => handleChange(item)}
						>
							{label}
						</Tag.CheckableTag>
					);
				})}
			</Flex>
		</Scrollbar>
	);
};

export default Group;
