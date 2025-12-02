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
import { App, Flex, type FlexProps } from "antd";
import type { HookAPI } from "antd/es/modal/useModal";
import clsx from "clsx";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { filesize } from "filesize";
import { findIndex, isNil, remove } from "lodash-es";
import type { DragEvent, FC, MouseEvent } from "react";
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";
import Files from "./components/Files";
import HTML from "./components/HTML";
import Header from "./components/Header";
import Image from "./components/Image";
import RTF from "./components/RTF";
import SyncStatus from "./components/SyncStatus";
import Text from "./components/Text";

interface ItemProps extends Partial<FlexProps> {
	index: number;
	data: HistoryTablePayload;
	deleteModal: HookAPI;
	openNoteModel: () => void;
	openEditModal?: () => void;
}

interface ContextMenuItem extends MenuItemOptions {
	hide?: boolean;
}

// 初始化dayjs插件
dayjs.extend(relativeTime);

const Item: FC<ItemProps> = (props) => {
	const { message } = App.useApp();
	const {
		index,
		data,
		className,
		deleteModal,
		openNoteModel,
		openEditModal,
		...rest
	} = props;
	const {
		id,
		type,
		value,
		search,
		group,
		favorite,
		note,
		subtype,
		count,
		width,
		height,
		createTime,
		lastModified,
	} = data;
	const { state, forceRefreshList } = useContext(MainContext);
	const { t, i18n: i18nInstance } = useTranslation();
	const { env } = useSnapshot(globalStore);
	const { content, multiSelect } = useSnapshot(clipboardStore);

	// 判断当前项目是否被多选
	const isSelected = multiSelect.selectedIds.has(id);

	// 辅助函数：从JSON数组格式中提取实际值
	const getActualValue = (val: string) => {
		if (!val || typeof val !== "string") {
			return val;
		}

		try {
			// 尝试解析为JSON
			const parsed = JSON.parse(val);

			// 如果是字符串数组，返回第一个值
			if (
				Array.isArray(parsed) &&
				parsed.length > 0 &&
				typeof parsed[0] === "string"
			) {
				return parsed[0];
			}
		} catch (_error) {
			// JSON解析失败，继续使用原始值
		}

		return val; // 返回原始值
	};

	state.$eventBus?.useSubscription((key) => {
		// 处理批量操作：如果是批量操作，不检查id匹配
		const isBatchOperation =
			key === LISTEN_KEY.CLIPBOARD_ITEM_BATCH_DELETE ||
			key === LISTEN_KEY.CLIPBOARD_ITEM_BATCH_FAVORITE;

		if (!isBatchOperation && id !== state.eventBusId) return;

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
			case LISTEN_KEY.CLIPBOARD_ITEM_BATCH_DELETE:
				return handleBatchDelete();
			case LISTEN_KEY.CLIPBOARD_ITEM_BATCH_FAVORITE:
				return handleBatchFavorite();
		}
	});

	// 复制
	const copy = async () => {
		let hasError = false;

		try {
			// 设置内部复制标志，防止复制操作后触发重复处理
			clipboardStore.internalCopy = {
				isCopying: true,
				itemId: id,
			};

			// 直接复制，同步阶段已确保所有文件都是本地可用的
			await writeClipboard(data);
		} catch (error) {
			hasError = true;
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
		} finally {
			// 清除内部复制标志
			clipboardStore.internalCopy = {
				isCopying: false,
				itemId: null,
			};
		}

		if (hasError) {
			return;
		}

		const index = findIndex(state.list, { id });

		if (index !== -1) {
			const createTime = formatDate();

			// 获取当前的自动排序设置
			const currentAutoSort = clipboardStore.content.autoSort;

			if (currentAutoSort) {
				// 自动排序开启：移动到顶部
				const [targetItem] = state.list.splice(index, 1);
				state.list.unshift({ ...targetItem, createTime });

				// 聚焦到移动后的条目
				state.activeId = id;
			} else {
				// 自动排序关闭：保持原位置，只更新时间
				state.list[index] = { ...state.list[index], createTime };

				// 聚焦到当前条目
				state.activeId = id;
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

		// 更新本地状态，确保界面响应
		const itemIndex = findIndex(state.list, { id });
		if (itemIndex !== -1) {
			state.list[itemIndex] = {
				...state.list[itemIndex],
				favorite: nextFavorite,
				lastModified: Date.now(), // 更新本地状态的时间戳
			};
		}

		try {
			// 更新收藏状态时同时更新最后修改时间，确保同步引擎能检测到变更
			await updateSQL("history", {
				id,
				favorite: nextFavorite ? 1 : 0,
				lastModified: Date.now(),
			} as any);
		} catch (error) {
			console.error("收藏状态更新失败:", error);
			// 如果数据库更新失败，恢复本地状态
			if (itemIndex !== -1) {
				state.list[itemIndex] = {
					...state.list[itemIndex],
					favorite: favorite,
				};
			}
		}
	};

	// 批量删除处理函数
	const handleBatchDelete = async () => {
		// 只在第一个被选中的项目中处理，避免重复执行
		const firstSelectedId = Array.from(
			clipboardStore.multiSelect.selectedIds,
		)[0];
		if (id !== firstSelectedId) return;

		// 获取所有选中的项目ID
		const selectedIds = Array.from(clipboardStore.multiSelect.selectedIds);

		// 显示确认对话框
		let confirmed = true;

		if (clipboardStore.content.deleteConfirm) {
			confirmed = await deleteModal.confirm({
				centered: true,
				content: `确定要删除选中的 ${selectedIds.length} 个项目吗？`,
				afterClose() {
					// 关闭确认框后焦点还在，需要手动取消焦点
					(document.activeElement as HTMLElement)?.blur();
				},
			});
		}

		if (!confirmed) return;

		try {
			// 执行批量删除
			const result = await batchDeleteItems(selectedIds);

			if (result.success) {
				// 清除多选状态
				clipboardStore.multiSelect.isMultiSelecting = false;
				clipboardStore.multiSelect.selectedIds.clear();
				clipboardStore.multiSelect.lastSelectedId = null;

				// 立即刷新列表，确保数据库操作完成
				if (forceRefreshList) {
					forceRefreshList();
				}

				// 从本地状态中移除已删除的项目（在刷新后执行，确保状态同步）
				// 创建新数组避免直接修改正在遍历的数组
				const remainingItems = state.list.filter(
					(item) => !selectedIds.includes(item.id),
				);
				state.list.splice(0, state.list.length, ...remainingItems);

				// 设置新的激活项
				if (remainingItems.length > 0) {
					state.activeId = remainingItems[0]?.id;
				} else {
					state.activeId = undefined;
				}

				// 显示成功提示
				message.success(`成功删除 ${result.deletedCount} 个项目`);
			} else {
				message.error(`批量删除失败: ${result.error}`);
			}
		} catch (error) {
			console.error("❌ 批量删除失败:", error);
			message.error("批量删除操作失败");
		}
	};

	// 批量收藏处理函数
	const handleBatchFavorite = async () => {
		// 只在第一个被选中的项目中处理，避免重复执行
		const firstSelectedId = Array.from(
			clipboardStore.multiSelect.selectedIds,
		)[0];
		if (id !== firstSelectedId) return;

		// 获取所有选中的项目ID
		const selectedIds = Array.from(clipboardStore.multiSelect.selectedIds);

		// 检查是否都是收藏的或都不是收藏的，以确定操作类型
		const selectedItems = state.list.filter((item) =>
			selectedIds.includes(item.id),
		);
		const areAllFavorited =
			selectedItems.length > 0 && selectedItems.every((item) => item.favorite);
		const newFavoriteStatus = !areAllFavorited; // 如果全部收藏，则取消收藏；否则全部收藏

		// 提前定义action变量，避免作用域问题
		const action = newFavoriteStatus ? "收藏" : "取消收藏";

		try {
			// 执行批量收藏/取消收藏
			const result = await batchUpdateFavorite(selectedIds, newFavoriteStatus);

			if (result.success) {
				// 更新本地状态
				for (const selectedId of selectedIds) {
					const itemIndex = findIndex(state.list, { id: selectedId });
					if (itemIndex !== -1) {
						state.list[itemIndex] = {
							...state.list[itemIndex],
							favorite: newFavoriteStatus,
							lastModified: Date.now(),
						};
					}
				}

				// 刷新列表，确保状态同步
				if (forceRefreshList) {
					forceRefreshList();
				}

				// 清除多选状态
				clipboardStore.multiSelect.isMultiSelecting = false;
				clipboardStore.multiSelect.selectedIds.clear();
				clipboardStore.multiSelect.lastSelectedId = null;

				// 显示成功提示
				message.success(`成功${action} ${result.updatedCount} 个项目`);
			} else {
				message.error(`批量${action}失败: ${result.error}`);
			}
		} catch (error) {
			console.error("❌ 批量收藏失败:", error);
			message.error("批量收藏操作失败");
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
		try {
			const fileName = `${env.appName}_${id}.png`;
			const path = joinPath(await downloadDir(), fileName);

			await copyFile(getActualValue(value), path);
			await revealItemInDir(path);
		} catch (error) {
			console.error("下载图片失败:", error);
			message.error("下载图片失败");
		}
	};

	// 打开文件至访达
	const openFinder = async () => {
		try {
			const pathToReveal = getActualValue(value);

			// 验证路径是否为有效格式
			if (!pathToReveal || typeof pathToReveal !== "string") {
				message.error("无效的文件路径");
				return;
			}

			// 检查是否只是文件名（无路径分隔符）
			if (!pathToReveal.includes("/") && !pathToReveal.includes("\\")) {
				message.warning("该文件只有文件名，无法在资源管理器中显示");
				return;
			}

			// 检测网络路径格式 (如 \\server\share 或 file:// 或 smb:// 等)
			const isNetworkPath = /^\\\\|^file:\/\/|^smb:\/\//i.test(pathToReveal);

			if (isNetworkPath) {
				// 网络路径尝试直接打开
				try {
					await openPath(pathToReveal);
				} catch {
					// 如果直接打开失败，尝试使用 revealItemInDir
					await revealItemInDir(pathToReveal);
				}
			} else {
				// 本地路径处理：区分文件和文件夹
				const { exists, lstat } = await import("@tauri-apps/plugin-fs");

				// 检查路径是否存在
				if (!(await exists(pathToReveal))) {
					message.error("路径不存在");
					return;
				}

				// 获取路径状态信息
				const stat = await lstat(pathToReveal);

				if (stat.isDirectory) {
					// 如果是文件夹，直接打开文件夹
					await openPath(pathToReveal);
				} else {
					// 如果是文件，在资源管理器中聚焦到文件
					await revealItemInDir(pathToReveal);
				}
			}
		} catch (error) {
			console.error("打开资源管理器失败:", error);
			message.error("无法在资源管理器中显示文件");
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
			// 统一使用软删除策略，让同步系统处理云端删除
			await updateSQL("history", {
				id,
				deleted: 1, // 标记为已删除
				syncStatus: "pending", // 标记为需要同步处理
			} as any);

			// 使用强制刷新函数，确保缓存和lastQueryParams都被正确重置
			if (forceRefreshList) {
				forceRefreshList();
			}

			// 从本地状态中移除
			remove(state.list, { id });
		} catch (error) {
			console.error(`❌ 删除条目失败: ${id}`, error);
		}
	};

	// 粘贴
	const pasteValue = async () => {
		await smartPasteClipboard(data);

		// 粘贴已有条目后，也触发移动到顶部并更新时间
		const index = findIndex(state.list, { id });

		if (index !== -1) {
			const createTime = formatDate();

			// 从原位置移除
			const [targetItem] = state.list.splice(index, 1);

			// 移动到顶部并更新时间
			state.list.unshift({ ...targetItem, createTime });

			// 更新数据库
			await updateSQL("history", { id, createTime });
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

		// 检查是否在多选模式且有选中的项目
		const isMultiSelectMode =
			clipboardStore.multiSelect.isMultiSelecting &&
			clipboardStore.multiSelect.selectedIds.size > 0;
		const selectedCount = clipboardStore.multiSelect.selectedIds.size;

		// 如果是多选模式且当前项目被选中，显示批量操作菜单
		if (isMultiSelectMode && clipboardStore.multiSelect.selectedIds.has(id)) {
			const batchItems: ContextMenuItem[] = [
				{
					text: `批量删除选中的 ${selectedCount} 个项目`,
					action: handleBatchDelete,
				},
				{
					text: `批量收藏选中的 ${selectedCount} 个项目`,
					action: handleBatchFavorite,
				},
				{
					text: "---", // 分隔符
					action: () => {},
				},
				{
					text: "取消多选",
					action: () => {
						clipboardStore.multiSelect.isMultiSelecting = false;
						clipboardStore.multiSelect.selectedIds.clear();
						clipboardStore.multiSelect.lastSelectedId = null;
					},
				},
			];

			const batchMenu = await Menu.new();

			for await (const item of batchItems) {
				if (item.text === "---") {
					// 添加分隔符
					await batchMenu.append({
						text: "",
						enabled: false,
					});
				} else {
					const menuItem = await MenuItem.new(item);
					await batchMenu.append(menuItem);
				}
			}

			batchMenu.popup();
			return;
		}

		// 常规右键菜单
		const items: ContextMenuItem[] = [
			{
				text: t("clipboard.button.context_menu.copy"),
				action: copy,
			},
			{
				text: t("clipboard.button.context_menu.edit"),
				hide: type !== "text" && type !== "html" && type !== "rtf",
				action: () => openEditModal?.(),
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
				hide: type !== "files" && !(type === "text" && subtype === "path"),
				action: openFinder,
			},
			{
				text: t("clipboard.button.context_menu.delete"),
				action: deleteItem,
			},
		];

		// 如果在多选模式但当前项目没有被选中，添加"全选"选项
		if (isMultiSelectMode) {
			items.unshift({
				text: "全选所有可见项目",
				action: () => {
					clipboardStore.multiSelect.isMultiSelecting = true;
					clipboardStore.multiSelect.selectedIds.clear();
					for (const item of state.list) {
						clipboardStore.multiSelect.selectedIds.add(item.id);
					}
					clipboardStore.multiSelect.lastSelectedId =
						state.list[state.list.length - 1]?.id || null;
				},
			});
			items.unshift({
				text: "选择所有可见项目",
				action: () => {
					clipboardStore.multiSelect.isMultiSelecting = true;
					clipboardStore.multiSelect.selectedIds.clear();
					for (const item of state.list) {
						clipboardStore.multiSelect.selectedIds.add(item.id);
					}
					clipboardStore.multiSelect.lastSelectedId =
						state.list[state.list.length - 1]?.id || null;
				},
			});
		}

		const menu = await Menu.new();

		for await (const item of items.filter(({ hide }) => !hide)) {
			const menuItem = await MenuItem.new(item);

			await menu.append(menuItem);
		}

		menu.popup();
	};

	// 处理多选逻辑
	const handleMultiSelect = (event: MouseEvent) => {
		const { multiSelect } = clipboardStore;

		// 如果是shift+点击，进行多选操作
		if (event.shiftKey) {
			event.stopPropagation();

			// 如果当前没有多选状态，开始多选
			if (!multiSelect.isMultiSelecting) {
				clipboardStore.multiSelect.isMultiSelecting = true;
				clipboardStore.multiSelect.selectedIds.clear();
			}

			// 如果有上次选中的项目，选择范围
			if (multiSelect.lastSelectedId) {
				const lastSelectedIndex = state.list.findIndex(
					(item) => item.id === multiSelect.lastSelectedId,
				);
				const currentIndex = index;

				if (lastSelectedIndex !== -1) {
					const startIndex = Math.min(lastSelectedIndex, currentIndex);
					const endIndex = Math.max(lastSelectedIndex, currentIndex);

					// 选择范围内的所有项目，包括起始和结束项目
					for (let i = startIndex; i <= endIndex; i++) {
						if (state.list[i]) {
							clipboardStore.multiSelect.selectedIds.add(state.list[i].id);
						}
					}
				} else {
					// 如果找不到上次选中的项目，只选中当前项目
					clipboardStore.multiSelect.selectedIds.add(id);
				}
			} else {
				// 如果没有上次选中的项目，选中当前聚焦的项目作为起点
				const currentActiveIndex = state.list.findIndex(
					(item) => item.id === state.activeId,
				);

				if (currentActiveIndex !== -1) {
					// 有聚焦项目时，选择从聚焦项目到当前项目的范围
					const startIndex = Math.min(currentActiveIndex, index);
					const endIndex = Math.max(currentActiveIndex, index);

					for (let i = startIndex; i <= endIndex; i++) {
						if (state.list[i]) {
							clipboardStore.multiSelect.selectedIds.add(state.list[i].id);
						}
					}
				} else {
					// 没有聚焦项目，只选中当前项目
					clipboardStore.multiSelect.selectedIds.add(id);
				}
			}

			clipboardStore.multiSelect.lastSelectedId = id;
			state.activeId = id;
			return;
		}

		// 如果是多选状态且不是shift+点击，取消多选但继续处理点击
		if (multiSelect.isMultiSelecting) {
			clipboardStore.multiSelect.isMultiSelecting = false;
			clipboardStore.multiSelect.selectedIds.clear();
			clipboardStore.multiSelect.lastSelectedId = null;
			// 不return，继续处理正常点击逻辑
		}

		// 对于正常点击（非shift+点击），设置lastSelectedId以便后续shift+点击使用
		if (!event.shiftKey) {
			clipboardStore.multiSelect.lastSelectedId = id;
		}
	};

	// 点击事件
	const handleClick = (type: typeof content.autoPaste, event: MouseEvent) => {
		handleMultiSelect(event);

		state.activeId = id;

		if (content.autoPaste !== type) return;

		pasteValue();
	};

	// 拖拽事件
	const handleDragStart = async (event: DragEvent) => {
		if (group === "text") {
			// 文本类型：使用 Web Native 拖拽，支持粘贴到其他应用
			const actualValue = getActualValue(value);
			const dataTransfer = event.dataTransfer;

			if (!dataTransfer) return;

			// 设置拖拽效果
			dataTransfer.effectAllowed = "copy";

			// 根据内容类型设置适当的格式
			if (type === "html") {
				// 对于HTML类型，需要提取纯文本版本作为text/plain
				let plainTextValue = actualValue;
				try {
					const tempDiv = document.createElement("div");
					tempDiv.innerHTML = actualValue;
					plainTextValue =
						tempDiv.textContent || tempDiv.innerText || actualValue;
				} catch {
					// 如果HTML解析失败，使用原值
				}

				// 设置纯文本版本作为主要格式
				dataTransfer.setData("text/plain", plainTextValue);
				// 设置HTML格式作为富文本版本
				dataTransfer.setData("text/html", actualValue);
			} else {
				// 非HTML类型，只需要设置纯文本
				dataTransfer.setData("text/plain", actualValue);
			}

			// 设置富文本格式
			if (type === "rtf") {
				dataTransfer.setData("text/rtf", actualValue);
			}

			// 设置自定义格式用于应用间识别
			dataTransfer.setData("application/x-ecopaste-clipboard", actualValue);

			// 创建类似书签预览的拖拽预览
			const dragPreview = document.createElement("div");
			const isDarkMode = document.documentElement.classList.contains("dark");

			// 使用书签预览的样式类
			dragPreview.className = `pointer-events-none fixed z-50 select-none rounded-md border px-2.5 py-1.5 font-medium text-xs shadow-lg backdrop-blur-xl transition-all duration-200 ${
				isDarkMode
					? "border-neutral-700/50 bg-neutral-800/90 text-neutral-300"
					: "border-neutral-300/50 bg-neutral-200/90 text-neutral-700"
			}`;

			// 创建尖角箭头
			const arrow = document.createElement("div");
			arrow.className = `-translate-y-1/2 absolute top-1/2 h-0 w-0 border-transparent ${
				isDarkMode
					? "border-transparent border-t-8 border-r-8 border-r-neutral-800/90 border-b-8"
					: "border-transparent border-t-8 border-r-8 border-r-neutral-200/90 border-b-8"
			}`;
			arrow.style.left = "-8px";

			// 创建内容容器
			const contentSpan = document.createElement("span");
			contentSpan.className = "relative z-10 max-w-40 truncate";
			contentSpan.style.cssText = `
				max-width: 200px;
				display: -webkit-box;
				-webkit-line-clamp: 3;
				-webkit-box-orient: vertical;
				overflow: hidden;
				white-space: pre-wrap;
			`;

			// 设置预览内容
			let previewContent = actualValue.trim();
			if (type === "html") {
				// 对于HTML，提取纯文本显示
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = previewContent;
				previewContent =
					tempDiv.textContent || tempDiv.innerText || previewContent;
			}

			contentSpan.textContent = previewContent;

			// 组装预览元素
			dragPreview.appendChild(arrow);
			dragPreview.appendChild(contentSpan);

			// 设置拖拽预览，让尖角对准鼠标
			dataTransfer.setDragImage(dragPreview, 0, 20);

			// 将预览元素添加到body以确保渲染
			document.body.appendChild(dragPreview);
			// 短暂延迟后移除，让浏览器有时间截图
			setTimeout(() => {
				if (document.body.contains(dragPreview)) {
					document.body.removeChild(dragPreview);
				}
			}, 100);

			return;
		}

		// 非文本类型：使用 Tauri 拖拽插件，支持拖拽到文件系统
		event.preventDefault();

		const icon = await resolveResource("assets/drag-icon.png");

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
			data-item-id={id}
			className={clsx(
				className,
				"group antd-input! b-color-2 absolute inset-0 mx-0 h-full rounded-md p-1.5",
				{
					"antd-input-focus!": state.activeId === id,
					"border-2 border-blue-500!": isSelected,
				},
			)}
			onContextMenu={handleContextMenu}
			onClick={(event) => handleClick("single", event)}
			onDoubleClick={(event) => handleClick("double", event)}
			onDragStart={handleDragStart}
		>
			{/* 同步状态指示灯 */}
			<SyncStatus data={data} />

			<Header
				data={data}
				copy={copy}
				pastePlain={pastePlain}
				openNoteModel={openNoteModel}
				openEditModal={openEditModal}
				toggleFavorite={toggleFavorite}
				deleteItem={deleteItem}
				previewImage={preview}
				showInExplorer={openFinder}
				openInBrowser={openBrowser}
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

				{/* 右下角：统计信息标签（叠加方式） */}
				<Flex
					align="center"
					justify="flex-end"
					gap={4}
					className={clsx(
						"pointer-events-none absolute right-1 bottom-0 text-xs opacity-0 transition group-hover:opacity-100",
						{
							"opacity-100": state.activeId === id,
						},
					)}
					style={{ fontSize: "10px" }}
				>
					<span className="rounded-t bg-neutral-200/90 px-1.5 py-0.5 text-neutral-600 backdrop-blur-xl dark:bg-neutral-800/90 dark:text-neutral-400">
						{type === "files" || type === "image"
							? filesize(count, { standard: "jedec" })
							: t("clipboard.label.n_chars", { replace: [count] })}
					</span>
					{type === "image" && width && height && (
						<span className="rounded-t bg-neutral-200/90 px-1.5 py-0.5 text-neutral-600 backdrop-blur-xl dark:bg-neutral-800/90 dark:text-neutral-400">
							{width}×{height}
						</span>
					)}
					<span className="rounded-t bg-neutral-200/90 px-1.5 py-0.5 text-neutral-600 backdrop-blur-xl dark:bg-neutral-800/90 dark:text-neutral-400">
						{dayjs(lastModified || createTime)
							.locale(i18nInstance.language)
							.fromNow()}
					</span>
				</Flex>
			</div>
		</Flex>
	);
};

export default Item;
