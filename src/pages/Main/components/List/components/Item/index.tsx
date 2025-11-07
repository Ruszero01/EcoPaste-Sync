import UnoIcon from "@/components/UnoIcon";
import { updateSQL } from "@/database";
import { MainContext } from "@/pages/Main";
import { smartPasteClipboard } from "@/plugins/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import { formatDate } from "@/utils/dayjs";
import { joinPath } from "@/utils/path";
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
import { useContext } from "react";
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
	const { state, forceRefreshList } = useContext(MainContext);
	const { t } = useTranslation();
	const { env } = useSnapshot(globalStore);
	const { content } = useSnapshot(clipboardStore);

	// 辅助函数：从JSON数组格式中提取实际值
	const getActualValue = (val: string) => {
		if (typeof val === "string" && val.startsWith("[")) {
			try {
				const parsed = JSON.parse(val);
				if (Array.isArray(parsed) && parsed.length > 0) {
					return parsed[0]; // 返回第一个值
				}
			} catch (error) {
				console.error("解析值失败:", error);
			}
		}
		return val; // 返回原始值
	};

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
		try {
			// 直接复制，同步阶段已确保所有文件都是本地可用的
			await writeClipboard(data);
		} catch (error) {
			console.error("❌ 复制操作失败:", error);

			// 如果是图片复制失败且文件不存在，提示用户
			if (data.type === "image" && error instanceof Error) {
				if (
					error.message.includes("图片文件不存在") ||
					error.message.includes("No such file or directory")
				) {
					message.error("图片文件已被删除或移动，无法复制");
					return;
				}
			}

			// 其他类型的错误也显示提示
			message.error(
				`复制失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
			return;
		}

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
		smartPasteClipboard(data, true);
	};

	// 切换收藏状态
	const toggleFavorite = async () => {
		const nextFavorite = !favorite;

		// biome-ignore lint/suspicious/noConsoleLog: 允许在关键收藏状态变更时使用日志
		console.log("⭐ [Item.toggleFavorite] 收藏状态变更:", {
			项ID: id,
			项类型: type,
			之前收藏状态: favorite,
			之后收藏状态: nextFavorite,
			时间戳: Date.now(),
		});

		find(state.list, { id })!.favorite = nextFavorite;

		// biome-ignore lint/suspicious/noConsoleLog: 允许在关键数据库操作时使用日志
		console.log("💾 [Item.toggleFavorite] 准备更新数据库收藏状态:", {
			项ID: id,
			新收藏状态: nextFavorite,
		});

		try {
			await updateSQL("history", { id, favorite: nextFavorite });

			// biome-ignore lint/suspicious/noConsoleLog: 允许在关键数据库操作成功时使用日志
			console.log("✅ [Item.toggleFavorite] 数据库收藏状态更新成功:", {
				项ID: id,
				新收藏状态: nextFavorite,
			});
		} catch (error) {
			// biome-ignore lint/suspicious/noConsoleLog: 允许在关键数据库操作失败时使用日志
			console.error("❌ [Item.toggleFavorite] 数据库收藏状态更新失败:", {
				项ID: id,
				新收藏状态: nextFavorite,
				错误: error instanceof Error ? error.message : String(error),
			});
		}
	};

	// 打开链接至浏览器
	const openBrowser = () => {
		const actualValue = getActualValue(value);
		const url = actualValue.startsWith("http")
			? actualValue
			: `http://${actualValue}`;

		openUrl(url);
	};

	// 发送邮件
	const sendEmail = () => {
		const actualValue = getActualValue(value);
		openUrl(`mailto:${actualValue}`);
	};

	// 导出文件
	const exportFile = async () => {
		const extname = type === "text" ? "txt" : type;
		const fileName = `${env.appName}_${id}.${extname}`;
		const path = joinPath(await downloadDir(), fileName);

		await writeTextFile(path, getActualValue(value));

		revealItemInDir(path);
	};

	// 预览
	const preview = () => {
		if (type !== "image") return;

		openPath(getActualValue(value));
	};

	// 下载图片
	const downloadImage = async () => {
		const fileName = `${env.appName}_${id}.png`;
		const path = joinPath(await downloadDir(), fileName);

		await copyFile(getActualValue(value), path);

		revealItemInDir(path);
	};

	// 打开文件至访达
	const openFinder = () => {
		if (subtype === "path") {
			revealItemInDir(getActualValue(value));
		} else {
			const actualValue = getActualValue(value);
			revealItemInDir(actualValue);
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

		try {
			await deleteSQL("history", data);

			// 使用强制刷新函数，确保缓存和lastQueryParams都被正确重置
			if (forceRefreshList) {
				forceRefreshList();
			}

			// 从本地状态中移除
			remove(state.list, { id });
		} catch (error) {
			console.error(`❌ 删除条目失败: ${id}`, error);
			message.error("删除失败，请重试");
		}
	};

	// 粘贴
	const pasteValue = async () => {
		await smartPasteClipboard(data);

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
