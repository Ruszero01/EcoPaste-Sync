import UnoIcon from "@/components/UnoIcon";
import { LISTEN_KEY } from "@/constants";
import { PRESET_SHORTCUT } from "@/constants";
import { useTauriFocus } from "@/hooks/useTauriFocus";
import { clipboardStore } from "@/stores/clipboard";
import { emit } from "@tauri-apps/api/event";
import { useBoolean } from "ahooks";
import { useKeyPress } from "ahooks";
import type { InputRef } from "antd";
import { Button, Input } from "antd";
import type { FC, HTMLAttributes } from "react";
import { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MainContext } from "../..";

const Search: FC<HTMLAttributes<HTMLDivElement>> = (props) => {
	const { state } = useContext(MainContext);
	const inputRef = useRef<InputRef>(null);
	const [value, setValue] = useState<string>();
	const [isComposition, { setTrue, setFalse }] = useBoolean();
	const { t } = useTranslation();

	useEffect(() => {
		if (isComposition) return;

		state.search = value || void 0;
	}, [value, isComposition]);

	useTauriFocus({
		onFocus() {
			const { search } = clipboardStore;

			// 搜索框默认聚焦
			if (search.defaultFocus) {
				inputRef.current?.focus();
			} else {
				inputRef.current?.blur();
			}
		},
		onBlur() {
			const { search } = clipboardStore;

			// 搜索框自动清空
			if (search.autoClear) {
				setValue(void 0);
			}
		},
	});

	useKeyPress(PRESET_SHORTCUT.SEARCH, () => {
		inputRef.current?.focus();
	});

	useKeyPress(
		["enter", "uparrow", "downarrow"],
		() => {
			inputRef.current?.blur();
		},
		{
			target: inputRef.current?.input,
		},
	);

	const handleCreateGroup = () => {
		if (value?.trim()) {
			// 直接使用当前搜索框的值作为分组名
			const groupName = value.trim();

			// 触发创建分组事件，由侧边栏组件处理
			emit(LISTEN_KEY.CREATE_CUSTOM_GROUP, groupName);

			// 清空搜索框，避免重复创建
			setValue("");
		}
	};

	const showCreateButton = value && value.trim().length > 0;

	return (
		<div {...props} className="relative px-3">
			<Input
				ref={inputRef}
				allowClear
				value={value}
				prefix={<UnoIcon name="i-lucide:search" />}
				suffix={
					showCreateButton ? (
						<Button
							icon={<UnoIcon name="i-lucide:bookmark" />}
							size="small"
							type="text"
							className="text-primary hover:bg-primary/10"
							onClick={handleCreateGroup}
							title="添加书签"
						/>
					) : null
				}
				size="small"
				placeholder={t("clipboard.hints.search_placeholder")}
				onCompositionStart={setTrue}
				onCompositionEnd={setFalse}
				onChange={(event) => {
					setValue(event.target.value);
				}}
			/>
		</div>
	);
};

export default Search;
