import UnoIcon from "@/components/UnoIcon";
import { updateSQL } from "@/database";
import { MainContext } from "@/pages/Main";
import type { HistoryTablePayload } from "@/types/database";
import { formatDate } from "@/utils/dayjs";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Menu, MenuItem, type MenuItemOptions } from "@tauri-apps/api/menu";
import { downloadDir, resolveResource } from "@tauri-apps/api/path";
import { copyFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Flex, type FlexProps, message } from "antd";
import type { HookAPI } from "antd/es/modal/useModal";
import clsx from "clsx";
import { find, findIndex, isNil, remove } from "lodash-es";
import type { DragEvent, FC, MouseEvent } from "react";
import { useSnapshot } from "valtio";
import Files from "./components/Files";
import HTML from "./components/HTML";
import Header from "./components/Header";
import Image from "./components/Image";
import RTF from "./components/RTF";
import Text from "./components/Text";

interface ItemProps extends Partial<FlexProps> {
	index: number;
	data: HistoryTablePayload;
	deleteModal: HookAPI;
	openNoteModel: () => void;
}

interface ContextMenuItem extends MenuItemOptions {
	hide?: boolean;
}

const Item: FC<ItemProps> = (props) => {
	const { index, data, className, deleteModal, openNoteModel, ...rest } = props;
	const { id, type, value, search, group, favorite, note, subtype } = data;
	const { state } = useContext(MainContext);
	const { t } = useTranslation();
	const { env } = useSnapshot(globalStore);
	const { content } = useSnapshot(clipboardStore);

	state.$eventBus?.useSubscription((key) => {
		if (id !== state.eventBusId) return;

		switch (key) {
			case LISTEN_KEY.CLIPBOARD_ITEM_PREVIEW:
				return preview();
			case LISTEN_KEY.CLIPBOARD_ITEM_PASTE:
				return pasteValue();
			case LISTEN_KEY.CLIPBOARD_ITEM_DELETE:
				return deleteItem();
			case LISTEN_KEY.CLIPBOARD_ITEM_SELECT_PREV:
				return selectNextOrPrev(false);
			case LISTEN_KEY.CLIPBOARD_ITEM_SELECT_NEXT:
				return selectNextOrPrev();
			case LISTEN_KEY.CLIPBOARD_ITEM_FAVORITE:
				return toggleFavorite();
		}
	});

	// 复制
	const copy = async () => {
		await writeClipboard(data);

		const index = findIndex(state.list, { id });

		if (index !== -1) {
			const createTime = formatDate();

			// 获取当前的自动排序设置
			const currentAutoSort = clipboardStore.content.autoSort;

			// console.log("🔄 复制已有条目", {
			// 	currentIndex: index,
			// 	itemId: id,
			// 	currentTime: createTime,
			// 	autoSort: currentAutoSort,
			// });

			if (currentAutoSort) {
				// 自动排序开启：移动到顶部
				const [targetItem] = state.list.splice(index, 1);
				state.list.unshift({ ...targetItem, createTime });

				// 聚焦到移动后的条目
				state.activeId = id;

				// console.log("✅ 自动排序开启：条目已移动到顶部", {
				// 	newIndex: 0,
				// 	topItemId: state.list[0]?.id,
				// });
			} else {
				// 自动排序关闭：保持原位置，只更新时间
				state.list[index] = { ...state.list[index], createTime };

				// 聚焦到当前条目
				state.activeId = id;

				// console.log("✅ 自动排序关闭：条目保持原位置，仅更新时间", {
				// 	unchangedIndex: index,
				// 	itemId: id,
				// });
			}

			// 更新数据库
			await updateSQL("history", { id, createTime });
		} else {
		}
	};

	// 粘贴纯文本
	const pastePlain = () => {
		pasteClipboard(data, true);
	};

	// 切换收藏状态
	const toggleFavorite = () => {
		const nextFavorite = !favorite;

		find(state.list, { id })!.favorite = nextFavorite;

		updateSQL("history", { id, favorite: nextFavorite });
	};

	// 打开链接至浏览器
	const openBrowser = () => {
		const url = value.startsWith("http") ? value : `http://${value}`;

		openUrl(url);
	};

	// 发送邮件
	const sendEmail = () => {
		openUrl(`mailto:${value}`);
	};

	// 导出文件
	const exportFile = async () => {
		const extname = type === "text" ? "txt" : type;
		const fileName = `${env.appName}_${id}.${extname}`;
		const path = joinPath(await downloadDir(), fileName);

		await writeTextFile(path, value);

		revealItemInDir(path);
	};

	// 预览
	const preview = () => {
		if (type !== "image") return;

		openPath(value);
	};

	// 下载图片
	const downloadImage = async () => {
		const fileName = `${env.appName}_${id}.png`;
		const path = joinPath(await downloadDir(), fileName);

		await copyFile(value, path);

		revealItemInDir(path);
	};

	// 打开文件至访达
	const openFinder = () => {
		if (subtype === "path") {
			revealItemInDir(value);
		} else {
			const [file] = JSON.parse(value);

			revealItemInDir(file);
		}
	};

	// 删除条目
	const deleteItem = async () => {
		let confirmed = true;

		if (clipboardStore.content.deleteConfirm) {
			confirmed = await deleteModal.confirm({
				centered: true,
				content: t("clipboard.hints.delete_modal_content"),
				afterClose() {
					// 关闭确认框后焦点还在，需要手动取消焦点
					(document.activeElement as HTMLElement)?.blur();
				},
			});
		}

		if (!confirmed) return;

		if (state.activeId === id) {
			const nextIndex = selectNextOrPrev();

			if (isNil(nextIndex)) {
				selectNextOrPrev(false);
			}
		}

		deleteSQL("history", data);

		remove(state.list, { id });
	};

	// 粘贴
	const pasteValue = async () => {
		await pasteClipboard(data);

		// 粘贴已有条目后，也触发移动到顶部并更新时间
		const index = findIndex(state.list, { id });

		if (index !== -1) {
			const createTime = formatDate();

			// console.log("🔄 粘贴已有条目，准备移动到顶部", {
			// 	currentIndex: index,
			// 	itemId: id,
			// 	currentTime: createTime,
			// });

			// 从原位置移除
			const [targetItem] = state.list.splice(index, 1);

			// 移动到顶部并更新时间
			state.list.unshift({ ...targetItem, createTime });

			// 更新数据库
			await updateSQL("history", { id, createTime });

			// console.log("✅ 粘贴已有条目已移动到顶部并更新时间", {
			// 	newIndex: 0,
			// 	listLength: state.list.length,
			// 	topItemId: state.list[0]?.id,
			// });
		}
	};

	// 选中下一个或者上一个
	const selectNextOrPrev = (isNext = true) => {
		let nextIndex = index;

		if (isNext) {
			if (index === state.list.length - 1) return;

			nextIndex = index + 1;
		} else {
			if (index === 0) return;

			nextIndex = index - 1;
		}

		state.activeId = state.list[nextIndex]?.id;

		return nextIndex;
	};

	// 右键菜单
	const handleContextMenu = async (event: MouseEvent) => {
		event.preventDefault();

		state.activeId = id;

		const items: ContextMenuItem[] = [
			{
				text: t("clipboard.button.context_menu.copy"),
				action: copy,
			},
			{
				text: t("clipboard.button.context_menu.note"),
				action: openNoteModel,
			},
			{
				text: t("clipboard.button.context_menu.paste_as_plain_text"),
				hide: type !== "html" && type !== "rtf",
				action: pastePlain,
			},
			{
				text: t("clipboard.button.context_menu.paste_ocr_text"),
				hide: type !== "image" || /^[\s]*$/.test(search),
				action: pastePlain,
			},
			{
				text: t("clipboard.button.context_menu.paste_as_path"),
				hide: type !== "files",
				action: pastePlain,
			},
			{
				text: favorite
					? t("clipboard.button.context_menu.unfavorite")
					: t("clipboard.button.context_menu.favorite"),
				action: toggleFavorite,
			},
			{
				text: t("clipboard.button.context_menu.open_in_browser"),
				hide: subtype !== "url",
				action: openBrowser,
			},
			{
				text: t("clipboard.button.context_menu.send_email"),
				hide: subtype !== "email",
				action: sendEmail,
			},
			{
				text: t("clipboard.button.context_menu.export_as_file"),
				hide: group !== "text",
				action: exportFile,
			},
			{
				text: t("clipboard.button.context_menu.preview_image"),
				hide: type !== "image",
				action: preview,
			},
			{
				text: t("clipboard.button.context_menu.download_image"),
				hide: type !== "image",
				action: downloadImage,
			},
			{
				text: isMac
					? t("clipboard.button.context_menu.show_in_finder")
					: t("clipboard.button.context_menu.show_in_file_explorer"),
				hide: type !== "files" && subtype !== "path",
				action: openFinder,
			},
			{
				text: t("clipboard.button.context_menu.delete"),
				action: deleteItem,
			},
		];

		const menu = await Menu.new();

		for await (const item of items.filter(({ hide }) => !hide)) {
			const menuItem = await MenuItem.new(item);

			await menu.append(menuItem);
		}

		menu.popup();
	};

	// 点击事件
	const handleClick = (type: typeof content.autoPaste) => {
		state.activeId = id;

		if (content.autoPaste !== type) return;

		pasteValue();
	};

	// 拖拽事件
	const handleDragStart = async (event: DragEvent) => {
		event.preventDefault();

		const icon = await resolveResource("assets/drag-icon.png");

		if (group === "text") {
			return message.warning("暂不支持拖拽文本");
		}

		if (group === "image") {
			return startDrag({ item: [value], icon: value });
		}

		startDrag({ icon, item: JSON.parse(value) });
	};

	// 渲染内容
	const renderContent = () => {
		switch (type) {
			case "rtf":
				return <RTF {...data} />;
			case "html":
				return <HTML {...data} />;
			case "image":
				return <Image {...data} />;
			case "files":
				return <Files {...data} />;
			default:
				return <Text {...data} />;
		}
	};

	return (
		<Flex
			{...rest}
			vertical
			draggable
			gap={4}
			className={clsx(
				className,
				"group antd-input! b-color-2 absolute inset-0 mx-3 h-full rounded-md p-1.5",
				{
					"antd-input-focus!": state.activeId === id,
				},
			)}
			onContextMenu={handleContextMenu}
			onClick={() => handleClick("single")}
			onDoubleClick={() => handleClick("double")}
			onDragStart={handleDragStart}
		>
			<Header
				data={data}
				copy={copy}
				pastePlain={pastePlain}
				openNoteModel={openNoteModel}
				toggleFavorite={toggleFavorite}
				deleteItem={deleteItem}
			/>

			<div className="relative flex-1 select-auto overflow-hidden break-words children:transition">
				<div
					className={clsx(
						"pointer-events-none absolute inset-0 line-clamp-4 opacity-0",
						{
							"opacity-100": note,
							"group-hover:opacity-0": content.showOriginalContent,
						},
					)}
				>
					<UnoIcon
						name="i-hugeicons:task-edit-01"
						className="mr-0.5 translate-y-0.5"
					/>

					{note}
				</div>

				<div
					className={clsx("h-full", {
						"opacity-0": note,
						"group-hover:opacity-100": content.showOriginalContent,
					})}
				>
					{renderContent()}
				</div>
			</div>
		</Flex>
	);
};

export default Item;
