import Scrollbar from "@/components/Scrollbar";
import UnoIcon from "@/components/UnoIcon";
import { useTauriFocus } from "@/hooks/useTauriFocus";
import type { HistoryTablePayload } from "@/types/database";
import { useKeyPress } from "ahooks";
import { Flex } from "antd";
import clsx from "clsx";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";
import { MainContext } from "../..";

interface GroupItem extends Partial<HistoryTablePayload> {
	key: string;
	label: string;
	icon: string;
	type?: "text" | "image" | "files" | "formatted" | "code";
	subtype?: string;
}

const Group = () => {
	const { state, getListCache, getListDebounced } = useContext(MainContext);
	const { t } = useTranslation();
	const [checked, setChecked] = useState("all");
	const { content } = useSnapshot(clipboardStore);

	const groupList: GroupItem[] = [
		{
			key: "all",
			label: t("clipboard.label.tab.all"),
			icon: "i-lucide:layout-grid",
		},
		{
			key: "text",
			label: t("clipboard.label.tab.text"),
			group: "text",
			icon: "i-lucide:type",
		},
		{
			key: "image",
			label: t("clipboard.label.tab.image"),
			group: "image",
			icon: "i-lucide:image",
		},
		{
			key: "file",
			label: t("clipboard.label.tab.files"),
			group: "files",
			icon: "i-lucide:file-text",
		},
		{
			key: "link",
			label: t("clipboard.label.link"),
			icon: "i-lucide:link",
		},
		{
			key: "color",
			label: t("clipboard.label.tab.color"),
			subtype: "color",
			icon: "i-lucide:palette",
		},
		{
			key: "code",
			label: t("clipboard.label.code"),
			group: "text",
			type: "code",
			icon: "i-lucide:code-2",
		},
		{
			key: "favorite",
			label: t("clipboard.label.tab.favorite"),
			favorite: true,
			icon: "i-lucide:star",
		},
	];

	// 获取过滤后的可见分组列表（与渲染逻辑保持一致）
	const visibleGroupList = groupList.filter((item) => {
		if (item.key === "code") {
			return content.codeDetection;
		}
		if (item.key === "color") {
			return content.colorDetection;
		}
		return true;
	});

	useTauriFocus({
		onFocus() {
			if (!clipboardStore.window.showAll) return;

			handleChange(groupList[0]);
		},
	});

	useKeyPress("tab", (event) => {
		// 使用过滤后的可见列表计算索引
		const index = visibleGroupList.findIndex((item) => item.key === checked);
		const length = visibleGroupList.length;

		let nextIndex = index;

		if (event.shiftKey) {
			nextIndex = index === 0 ? length - 1 : index - 1;
		} else {
			nextIndex = index === length - 1 ? 0 : index + 1;
		}

		handleChange(visibleGroupList[nextIndex]);
	});

	const handleChange = (item: GroupItem) => {
		const { key, group, favorite, type, subtype } = item;

		setChecked(key);

		// 确保正确更新响应式状态
		state.group = group;
		state.favorite = favorite;
		state.type = type;
		// 代码分组通过 type = 'code' 识别
		state.isCode = type === "code";
		// 颜色分组通过 subtype = 'color' 识别
		state.colorTab = subtype === "color";

		// 针对链接分组，特殊处理（包含 url, path, email）
		if (key === "link") {
			state.linkTab = true;
			// 不清除搜索，保留书签分组筛选
		} else {
			state.linkTab = false;
		}

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
			<Flex data-tauri-drag-region gap="middle">
				{groupList
					.filter((item) => {
						// 代码分组只在代码检测启用时显示
						if (item.key === "code") {
							return content.codeDetection;
						}
						// 颜色分组只在颜色识别启用时显示
						if (item.key === "color") {
							return content.colorDetection;
						}
						return true;
					})
					.map((item) => {
						const { key, label, icon } = item;

						const isChecked = checked === key;

						return (
							<UnoIcon
								key={key}
								name={icon}
								title={label}
								className={clsx(
									"h-5 w-5 cursor-pointer rounded transition-all duration-200",
									{
										"bg-primary text-white shadow": isChecked,
										"text-color-2 hover:scale-105 hover:bg-color-2": !isChecked,
									},
								)}
								onClick={() => handleChange(item)}
							/>
						);
					})}
			</Flex>
		</Scrollbar>
	);
};

export default Group;
