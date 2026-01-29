import { createDragPreview } from "@/components/DragPreview";
import { LISTEN_KEY } from "@/constants";
import { MainContext } from "@/pages/Main";
import { convertColor, smartPasteClipboard } from "@/plugins/clipboard";
import { backendDeleteItems, backendUpdateField } from "@/plugins/database";
import { clipboardStore } from "@/stores/clipboard";
import { globalStore } from "@/stores/global";
import type { DeleteResult, HistoryTablePayload } from "@/types/database";
import { parseColorString } from "@/utils/color";
import { isMac } from "@/utils/is";
import { joinPath } from "@/utils/path";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Menu, MenuItem, type MenuItemOptions } from "@tauri-apps/api/menu";
import { downloadDir } from "@tauri-apps/api/path";
import { resolveResource } from "@tauri-apps/api/path";
import { copyFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { App, Flex, type FlexProps } from "antd";
import type { HookAPI } from "antd/es/modal/useModal";
import clsx from "clsx";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { filesize } from "filesize";
import { findIndex, isNil, remove } from "lodash-es";
import type { FC } from "react";
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";
import Files from "./components/Files";
import HTML from "./components/HTML";
import Header from "./components/Header";
import Image from "./components/Image";
import Note from "./components/Note";
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
		time,
	} = data;
	const { state } = useContext(MainContext);
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

	// 辅助函数：从HTML提取保留换行的纯文本（用于拖拽）
	const extractTextWithNewlines = (html: string): string => {
		if (!html) return "";

		try {
			// 提取 StartFragment 和 EndFragment 之间的内容
			const start = html.indexOf("<!--StartFragment-->");
			const end = html.indexOf("<!--EndFragment-->");
			let content = "";
			if (start !== -1 && end !== -1 && end > start) {
				content = html.substring(start + 20, end);
			} else {
				content = html;
			}

			// 将块级标签（div, p, br, li 等）替换为换行符
			content = content
				.replace(/<\/?div[^>]*>/gi, "\n")
				.replace(/<\/?p[^>]*>/gi, "\n")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<\/?li[^>]*>/gi, "\n");

			// 移除剩余标签
			content = content.replace(/<[^>]+>/g, "");

			// 解码 HTML 实体
			const textarea = document.createElement("textarea");
			textarea.innerHTML = content;
			let text = textarea.value;

			// 将不间断空格 (NBSP, 码点 160) 替换为普通空格
			text = text.replace(/\u00A0/g, " ");

			// 将多个连续换行替换为单个换行
			text = text.replace(/\n\s*\n/g, "\n");

			return text.trim();
		} catch {
			return "";
		}
	};

	// 创建图片缩略图函数
	const createImageThumbnail = async (imagePath: string): Promise<string> => {
		try {
			// 创建一个canvas元素来生成缩略图
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			if (!ctx) return imagePath;

			// 设置缩略图的最大尺寸
			const MAX_WIDTH = 200;
			const MAX_HEIGHT = 200;

			// 创建图片对象
			const img = document.createElement("img");
			img.crossOrigin = "anonymous";

			// 使用Promise等待图片加载完成
			await new Promise((resolve, reject) => {
				img.onload = resolve;
				img.onerror = reject;
				img.src = convertFileSrc(imagePath);
			});

			// 计算缩略图尺寸，保持宽高比
			let width = img.width;
			let height = img.height;

			if (width > height) {
				if (width > MAX_WIDTH) {
					height = Math.round((height * MAX_WIDTH) / width);
					width = MAX_WIDTH;
				}
			} else {
				if (height > MAX_HEIGHT) {
					width = Math.round((width * MAX_HEIGHT) / height);
					height = MAX_HEIGHT;
				}
			}

			// 设置canvas尺寸
			canvas.width = width;
			canvas.height = height;

			// 绘制缩略图
			ctx.drawImage(img, 0, 0, width, height);

			// 转换为data URL
			return canvas.toDataURL("image/png", 0.8);
		} catch (error) {
			console.error("创建图片缩略图失败:", error);
			// 如果创建缩略图失败，返回原始路径
			return imagePath;
		}
	};

	// 公共函数：清除多选状态
	const clearMultiSelectState = () => {
		clipboardStore.multiSelect.isMultiSelecting = false;
		clipboardStore.multiSelect.selectedIds = new Set();
		clipboardStore.multiSelect.lastSelectedId = null;
		clipboardStore.multiSelect.shiftSelectDirection = null;
		clipboardStore.multiSelect.selectedOrder = [];
	};

	// 公共函数：初始化多选状态
	const initializeMultiSelectState = () => {
		clipboardStore.multiSelect.isMultiSelecting = true;
		clipboardStore.multiSelect.selectedIds = new Set();
		clipboardStore.multiSelect.selectedOrder = [];
	};

	// 公共函数：重置多选状态
	const resetMultiSelectState = () => {
		clipboardStore.multiSelect.selectedIds = new Set();
		clipboardStore.multiSelect.selectedOrder = [];
	};

	// 公共函数：选择所有可见项目
	const selectAllVisibleItems = () => {
		initializeMultiSelectState();
		for (const item of state.list) {
			clipboardStore.multiSelect.selectedIds.add(item.id);
			clipboardStore.multiSelect.selectedOrder.push(item.id);
		}
		clipboardStore.multiSelect.lastSelectedId =
			state.list[state.list.length - 1]?.id || null;
		clipboardStore.multiSelect.shiftSelectDirection = "down"; // 从上到下选择
	};

	// 公共函数：选择单个项目
	const selectSingleItem = (itemId: string) => {
		clipboardStore.multiSelect.selectedIds.add(itemId);
		clipboardStore.multiSelect.selectedOrder.push(itemId);
		clipboardStore.multiSelect.lastSelectedId = itemId;
	};

	// 公共函数：更新项目时间（排序由后端处理）
	const updateItemsPositionAndTime = (items: HistoryTablePayload[]) => {
		const currentTime = Date.now();
		const updatedItems = items.map((item) => ({
			...item,
			time: currentTime,
		}));

		// 只更新时间，不处理位置（后端在去重时已根据 autoSort 设置处理 position）
		// 前端通过刷新列表获取最新数据
		return { updatedItems, currentTime };
	};

	// 公共函数：批量更新数据库
	const batchUpdateDatabase = async (
		items: HistoryTablePayload[],
		updateData: Partial<HistoryTablePayload>,
	) => {
		for (const item of items) {
			// 调用database插件批量更新
			await backendUpdateField(
				item.id,
				"time",
				(updateData.time || Date.now()).toString(),
			);
		}
	};

	// 公共函数：设置操作后的激活项
	const setActiveItemAfterOperation = (
		items: HistoryTablePayload[],
		preserveOrder = true,
	) => {
		if (items.length > 0) {
			state.activeId = preserveOrder ? items[0].id : items[items.length - 1].id;
		}
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
		try {
			// 写入剪贴板，后端去重时会自动更新时间戳
			await writeClipboard(data);
		} catch (error) {
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
		}
	};

	// 粘贴纯文本（从全局状态获取最新数据，避免OCR更新后数据不同步）
	const pastePlain = () => {
		// 从列表中获取最新的项目数据
		const latestItem = state.list.find((item) => item.id === data.id);
		smartPasteClipboard(latestItem || data, true);
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
			};
		}

		try {
			// 调用database插件更新收藏状态（后端会自动标记为已变更）
			await backendUpdateField(id, "favorite", nextFavorite.toString());
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
		// 获取所有选中的项目ID
		const selectedIds = Array.from(clipboardStore.multiSelect.selectedIds);

		// 使用全局标志防止重复执行
		if (clipboardStore.batchOperationInProgress) return;

		// 设置批量操作进行中标志
		clipboardStore.batchOperationInProgress = true;
		// 设置批量删除进行中标志，防止List组件自动聚焦到第一个项目
		state.batchDeleteInProgress = true;

		try {
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

			// 使用统一的删除命令
			const result = (await backendDeleteItems(selectedIds)) as DeleteResult;

			if (!result.success) {
				message.error(
					`批量删除失败: ${result.errors?.join("; ") ?? "未知错误"}`,
				);
				return;
			}

			// 清除多选状态
			clearMultiSelectState();

			// 保存当前激活项及其位置
			const currentActiveId = state.activeId;
			const isCurrentActiveDeleted = selectedIds.includes(
				currentActiveId || "",
			);

			// 先找到当前激活项在列表中的位置（删除前）
			let targetId: string | undefined;
			if (isCurrentActiveDeleted && state.list.length > 0) {
				const deletedIndex = state.list.findIndex(
					(item) => item.id === currentActiveId,
				);
				// 优先选择删除位置后面的第一项，如果没有则选择前面的
				if (deletedIndex >= 0) {
					targetId = state.list[deletedIndex + 1]?.id;
				}
				if (!targetId) {
					targetId = state.list[deletedIndex - 1]?.id;
				}
				if (!targetId && state.list.length > 0) {
					targetId = state.list[0]?.id;
				}
			}

			// 从本地状态中移除
			for (const selectedId of selectedIds) {
				remove(state.list, { id: selectedId });
			}

			// 聚焦管理：设置新的激活项
			if (targetId) {
				state.activeId = targetId;
			} else if (state.list.length > 0) {
				// 如果没有找到目标项，选择列表第一个
				state.activeId = state.list[0]?.id;
			} else {
				state.activeId = undefined;
			}

			// 显示成功提示
			const softDeletedCount = result.softDeletedIds?.length || 0;
			let deleteMessage = `成功删除 ${result.deletedCount} 个项目`;

			if (softDeletedCount > 0) {
				deleteMessage += `（${softDeletedCount} 个已同步项目将在下次同步时从云端删除）`;
			}

			message.success(deleteMessage);
		} catch (error) {
			console.error("❌ 批量删除失败:", error);
			message.error("批量删除操作失败");
		} finally {
			// 清除批量操作进行中标志
			clipboardStore.batchOperationInProgress = false;
			// 清除批量删除进行中标志，恢复正常的聚焦行为
			state.batchDeleteInProgress = false;
		}
	};

	// 批量收藏处理函数
	const handleBatchFavorite = async () => {
		// 获取所有选中的项目ID
		const selectedIds = Array.from(clipboardStore.multiSelect.selectedIds);

		// 使用全局标志防止重复执行
		if (clipboardStore.batchOperationInProgress) return;

		// 设置批量操作进行中标志
		clipboardStore.batchOperationInProgress = true;

		try {
			// 检查是否都是收藏的或都不是收藏的，以确定操作类型
			const selectedItems = state.list.filter((item) =>
				selectedIds.includes(item.id),
			);
			const areAllFavorited =
				selectedItems.length > 0 &&
				selectedItems.every((item) => item.favorite);
			const newFavoriteStatus = !areAllFavorited; // 如果全部收藏，则取消收藏；否则全部收藏

			// 提前定义action变量，避免作用域问题
			const action = newFavoriteStatus ? "收藏" : "取消收藏";

			// 执行批量收藏/取消收藏
			try {
				// 调用database插件批量更新收藏状态
				const promises = selectedIds.map((id) =>
					backendUpdateField(id, "favorite", newFavoriteStatus.toString()),
				);
				await Promise.all(promises);

				// 更新本地状态 - 只更新收藏状态，不更新时间戳和位置
				for (const selectedId of selectedIds) {
					const itemIndex = findIndex(state.list, { id: selectedId });
					if (itemIndex !== -1) {
						state.list[itemIndex] = {
							...state.list[itemIndex],
							favorite: newFavoriteStatus,
						};
					}
				}

				// 清除多选状态
				clearMultiSelectState();

				// 显示成功提示
				message.success(`成功${action} ${selectedIds.length} 个项目`);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "未知错误";
				message.error(`批量${action}失败: ${errorMessage}`);
			}
		} finally {
			// 清除批量操作进行中标志
			clipboardStore.batchOperationInProgress = false;
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

		// 先处理焦点，再执行删除
		if (state.activeId === id) {
			const nextIndex = selectNextOrPrev();

			if (isNil(nextIndex)) {
				selectNextOrPrev(false);
			}
		}

		try {
			// 使用统一的删除命令
			const result = (await backendDeleteItems([id])) as DeleteResult;

			if (!result.success) {
				message.error(`删除失败: ${result.errors?.join("; ") ?? "未知错误"}`);
				return;
			}

			// 从本地状态中移除
			remove(state.list, { id });

			// 显示成功提示
			message.success("删除成功");
		} catch (error) {
			console.error(`❌ 删除条目失败: ${id}`, error);
			message.error(
				`删除失败: ${error instanceof Error ? error.message : "未知错误"}`,
			);
		}
	};

	// 粘贴
	const pasteValue = async () => {
		// 检查是否在多选模式且有选中的项目
		const isMultiSelectMode =
			clipboardStore.multiSelect.isMultiSelecting &&
			clipboardStore.multiSelect.selectedIds.size > 0;

		if (isMultiSelectMode && clipboardStore.multiSelect.selectedIds.has(id)) {
			// 批量粘贴逻辑
			const selectedIds = Array.from(clipboardStore.multiSelect.selectedIds);
			const selectedItems = state.list.filter((item) =>
				selectedIds.includes(item.id),
			);

			if (selectedItems.length > 0) {
				// 使用记录的选择顺序数组，而不是Set
				// 这样可以保持用户选择的顺序，无论是Ctrl加选还是Shift连选
				const selectedOrderArray = clipboardStore.multiSelect.selectedOrder;
				const sortedSelectedItems: HistoryTablePayload[] = [];

				// 按照选中顺序添加项目，确保顺序正确
				for (const id of selectedOrderArray) {
					const item = selectedItems.find((item) => item.id === id);
					if (item) {
						sortedSelectedItems.push(item);
					}
				}

				await batchPasteClipboard(sortedSelectedItems);

				// 更新项目位置和时间
				const { updatedItems, currentTime } =
					updateItemsPositionAndTime(sortedSelectedItems);

				// 批量更新数据库
				await batchUpdateDatabase(sortedSelectedItems, { time: currentTime });

				// 清除多选状态
				clearMultiSelectState();

				// 设置激活项为第一个粘贴的项目
				setActiveItemAfterOperation(updatedItems);
			}
		} else {
			// 单个粘贴逻辑
			await smartPasteClipboard(data);

			// 粘贴已有条目后，只更新时间（由后端决定是否更新 position）
			const index = findIndex(state.list, { id });

			if (index !== -1) {
				const currentTime = Date.now();

				// 只更新时间，不修改本地列表顺序（后端根据 autoSort 设置处理 position）
				state.list[index] = { ...state.list[index], time: currentTime };

				// 更新数据库（后端根据 autoSort 决定是否更新 position）
				await backendUpdateField(id, "time", currentTime.toString());

				// 无论是否在多选状态，都清除多选状态，确保聚焦框正常显示
				clearMultiSelectState();

				// 确保activeId指向当前粘贴的项目
				state.activeId = id;
			}
		}
	};

	// 通用颜色格式转换函数
	const pasteColorAs = async (
		format: "rgbVector" | "hex" | "cmyk",
		successMessage: string,
	) => {
		try {
			const actualValue = getActualValue(value);
			const result = await convertColor(actualValue, format);

			if (!result.success) {
				message.error(result.error ?? "颜色格式转换失败");
				return;
			}

			const { pasteColor } = await import("@/plugins/paste");
			// 异步触发，不等待完成
			void pasteColor(result.value);
			message.success(successMessage);
		} catch (error) {
			console.error("颜色格式转换失败:", error);
			message.error("颜色格式转换失败");
		}
	};

	// 右键菜单
	const handleContextMenu = async (event: React.MouseEvent) => {
		event.preventDefault();

		state.activeId = id;

		// 检查是否在多选模式且有选中的项目
		const isMultiSelectMode =
			clipboardStore.multiSelect.isMultiSelecting &&
			clipboardStore.multiSelect.selectedIds.size > 0;

		// 如果是多选模式且当前项目被选中，显示批量操作菜单
		if (isMultiSelectMode && clipboardStore.multiSelect.selectedIds.has(id)) {
			const batchItems: ContextMenuItem[] = [
				{
					text: `批量粘贴选中的 ${clipboardStore.multiSelect.selectedIds.size}个项目`,
					action: pasteValue,
				},
				{
					text: `批量收藏选中的 ${clipboardStore.multiSelect.selectedIds.size}个项目`,
					action: () => {
						// 使用事件总线触发批量收藏，与Header组件保持一致
						state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_BATCH_FAVORITE);
					},
				},
				{
					text: `批量删除选中的 ${clipboardStore.multiSelect.selectedIds.size}个项目`,
					action: () => {
						// 使用事件总线触发批量删除，与Header组件保持一致
						state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_BATCH_DELETE);
					},
				},
				{
					text: "取消多选",
					action: () => {
						clearMultiSelectState();
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
				hide: type !== "text" && type !== "formatted" && type !== "code",
				action: () => openEditModal?.(),
			},
			{
				text: t("clipboard.button.context_menu.note"),
				action: openNoteModel,
			},
			{
				text: t("clipboard.button.context_menu.paste_as_plain_text"),
				hide: type !== "formatted",
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
			// 颜色类型专用的转换选项
			// 颜色存储为 type="text", subtype="color"
			// 根据当前颜色格式显示对应的转换选项
			{
				text: t("clipboard.button.context_menu.paste_as_rgb"),
				hide:
					!(type === "text" && subtype === "color") ||
					parseColorString(getActualValue(value))?.format === "rgb",
				action: () => pasteColorAs("rgbVector", "已粘贴RGB向量格式颜色值"),
			},
			{
				text: t("clipboard.button.context_menu.paste_as_hex"),
				hide:
					!(type === "text" && subtype === "color") ||
					parseColorString(getActualValue(value))?.format === "hex",
				action: () => pasteColorAs("hex", "已粘贴HEX格式颜色值"),
			},
			{
				text: t("clipboard.button.context_menu.paste_as_cmyk"),
				hide:
					!(type === "text" && subtype === "color") ||
					parseColorString(getActualValue(value))?.format === "cmyk",
				action: () => pasteColorAs("cmyk", "已粘贴CMYK向量格式颜色值"),
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
					selectAllVisibleItems();
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
	const handleMultiSelect = (event: React.MouseEvent) => {
		const { multiSelect } = clipboardStore;

		// 如果是双击事件，不处理多选逻辑，直接返回
		// 但要确保当前项目被选中，以便双击粘贴能正常工作
		if (event.detail === 2) {
			// 如果当前项目没有被选中，确保它被选中
			if (!multiSelect.selectedIds.has(id)) {
				selectSingleItem(id);
			}
			return;
		}

		// 如果是shift+点击，进行连续多选操作
		if (event.shiftKey) {
			event.stopPropagation();

			// 如果当前没有多选状态，开始多选
			if (!multiSelect.isMultiSelecting) {
				initializeMultiSelectState();
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

					// 确定选择方向
					const direction = currentIndex > lastSelectedIndex ? "down" : "up";
					clipboardStore.multiSelect.shiftSelectDirection = direction;

					// 清空之前的选择和顺序
					resetMultiSelectState();

					// 根据选择方向按顺序添加项目
					if (direction === "down") {
						// 从上往下：按照列表顺序添加
						for (let i = startIndex; i <= endIndex; i++) {
							if (state.list[i]) {
								clipboardStore.multiSelect.selectedIds.add(state.list[i].id);
								clipboardStore.multiSelect.selectedOrder.push(state.list[i].id);
							}
						}
					} else {
						// 从下往上：按照逆序添加
						for (let i = endIndex; i >= startIndex; i--) {
							if (state.list[i]) {
								clipboardStore.multiSelect.selectedIds.add(state.list[i].id);
								clipboardStore.multiSelect.selectedOrder.push(state.list[i].id);
							}
						}
					}
				} else {
					// 如果找不到上次选中的项目，只选中当前项目
					resetMultiSelectState();
					selectSingleItem(id);
					clipboardStore.multiSelect.shiftSelectDirection = null;
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

					// 确定选择方向
					const direction = index > currentActiveIndex ? "down" : "up";
					clipboardStore.multiSelect.shiftSelectDirection = direction;

					// 清空之前的选择和顺序
					resetMultiSelectState();

					// 根据选择方向按顺序添加项目
					if (direction === "down") {
						// 从上往下：按照列表顺序添加
						for (let i = startIndex; i <= endIndex; i++) {
							if (state.list[i]) {
								clipboardStore.multiSelect.selectedIds.add(state.list[i].id);
								clipboardStore.multiSelect.selectedOrder.push(state.list[i].id);
							}
						}
					} else {
						// 从下往上：按照逆序添加
						for (let i = endIndex; i >= startIndex; i--) {
							if (state.list[i]) {
								clipboardStore.multiSelect.selectedIds.add(state.list[i].id);
								clipboardStore.multiSelect.selectedOrder.push(state.list[i].id);
							}
						}
					}
				} else {
					// 没有聚焦项目，只选中当前项目
					resetMultiSelectState();
					selectSingleItem(id);
					clipboardStore.multiSelect.shiftSelectDirection = null;
				}
			}

			clipboardStore.multiSelect.lastSelectedId = id;
			state.activeId = id;
			return;
		}

		// 如果是ctrl+点击（或mac上的cmd+点击），进行加选操作
		if (event.ctrlKey || event.metaKey) {
			event.stopPropagation();

			// 开始多选模式
			if (!multiSelect.isMultiSelecting) {
				initializeMultiSelectState();

				// 如果有当前聚焦的项目，先将其加入选中列表
				if (state.activeId && state.activeId !== id) {
					clipboardStore.multiSelect.selectedIds.add(state.activeId);
					clipboardStore.multiSelect.selectedOrder.push(state.activeId);
				}
			}

			// 如果当前项目已经被选中，则取消选中
			if (multiSelect.selectedIds.has(id)) {
				clipboardStore.multiSelect.selectedIds.delete(id);
				// 从选择顺序数组中移除
				const orderIndex = clipboardStore.multiSelect.selectedOrder.indexOf(id);
				if (orderIndex > -1) {
					clipboardStore.multiSelect.selectedOrder.splice(orderIndex, 1);
				}

				// 如果没有选中的项目了，退出多选模式
				if (multiSelect.selectedIds.size === 0) {
					clearMultiSelectState();
				} else {
					// 更新lastSelectedId为最后一个选中的项目
					const lastSelected =
						clipboardStore.multiSelect.selectedOrder[
							clipboardStore.multiSelect.selectedOrder.length - 1
						];
					clipboardStore.multiSelect.lastSelectedId = lastSelected;
				}
			} else {
				// 如果当前项目未被选中，则添加到选中列表
				selectSingleItem(id);
				// Ctrl加选时重置Shift选择方向
				clipboardStore.multiSelect.shiftSelectDirection = null;
			}

			state.activeId = id;
			return;
		}

		// 如果是多选状态且不是shift+点击或ctrl+点击，只有点击未选中的条目才取消多选
		if (
			multiSelect.isMultiSelecting &&
			!clipboardStore.multiSelect.selectedIds.has(id)
		) {
			clearMultiSelectState();
			// 不return，继续处理正常点击逻辑
		}

		// 对于正常点击（非shift+点击或ctrl+点击），设置lastSelectedId以便后续shift+点击使用
		// 但只有当项目当前没有被选中时才设置（避免影响已选中项目的状态）
		if (
			!event.shiftKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!multiSelect.selectedIds.has(id)
		) {
			clipboardStore.multiSelect.lastSelectedId = id;
			clipboardStore.multiSelect.shiftSelectDirection = null;
			clipboardStore.multiSelect.selectedOrder = [];
		}
	};

	// 点击事件
	const handleClick = (
		type: typeof content.autoPaste,
		event: React.MouseEvent,
	) => {
		// 先处理多选逻辑
		handleMultiSelect(event);

		state.activeId = id;

		// 检查是否匹配自动粘贴设置
		if (content.autoPaste !== type) {
			return;
		}

		// 检查是否在多选模式且有选中的项目
		const isMultiSelectMode =
			clipboardStore.multiSelect.isMultiSelecting &&
			clipboardStore.multiSelect.selectedIds.size > 0;

		// 如果是多选模式且当前项目被选中，执行批量粘贴
		if (isMultiSelectMode && clipboardStore.multiSelect.selectedIds.has(id)) {
			// 执行批量粘贴
			pasteValue(); // pasteValue函数内部已经包含了批量粘贴逻辑
		} else {
			// 单个粘贴逻辑
			pasteValue();
		}
	};

	// 拖拽事件
	const handleDragStart = async (event: React.DragEvent) => {
		// 检查是否在多选模式且有选中的项目
		const isMultiSelectMode =
			clipboardStore.multiSelect.isMultiSelecting &&
			clipboardStore.multiSelect.selectedIds.size > 0 &&
			clipboardStore.multiSelect.selectedIds.has(id);

		// 如果是多选模式，存储批量拖拽信息
		if (isMultiSelectMode) {
			// 使用记录的选择顺序数组，而不是Set
			// 这样可以保持用户选择的顺序，无论是Ctrl加选还是Shift连选
			const selectedOrderArray = clipboardStore.multiSelect.selectedOrder;
			const selectedItems = state.list.filter((item) =>
				selectedOrderArray.includes(item.id),
			);

			// 按照用户选中的顺序排序项目，而不是按照列表中的顺序
			const sortedSelectedItems: HistoryTablePayload[] = [];

			// 按照选中顺序添加项目，确保顺序正确
			for (const id of selectedOrderArray) {
				const item = selectedItems.find((item) => item.id === id);
				if (item) {
					sortedSelectedItems.push(item);
				}
			}

			// 将批量拖拽信息存储到全局状态，供onDragEnd使用
			clipboardStore.batchDragInfo = {
				items: sortedSelectedItems,
				isDragging: true,
			};

			// 只拖拽第一条数据
			const firstItem = sortedSelectedItems[0];
			if (!firstItem) return;

			// 使用第一条数据的信息进行拖拽
			const {
				subtype: firstSubtype,
				value: firstValue,
				group: firstGroup,
			} = firstItem;
			const actualValue = getActualValue(firstValue);

			if (firstGroup === "text") {
				// 文本类型：使用 Web Native 拖拽
				const dataTransfer = event.dataTransfer;
				if (!dataTransfer) return;

				dataTransfer.effectAllowed = "copy";

				// 根据内容类型设置适当的格式
				if (firstSubtype === "html") {
					// 使用保留换行的文本提取函数
					const plainTextValue = extractTextWithNewlines(actualValue);

					dataTransfer.setData("text/plain", plainTextValue);
					dataTransfer.setData("text/html", actualValue);
				} else {
					dataTransfer.setData("text/plain", actualValue);
				}

				if (firstSubtype === "rtf") {
					dataTransfer.setData("text/rtf", actualValue);
				}

				dataTransfer.setData("application/x-ecopaste-clipboard", actualValue);

				// 创建批量拖拽预览
				createDragPreview(event, {
					content: "",
					isBatch: true,
					batchCount: sortedSelectedItems.length,
				});

				return;
			}

			// 非文本类型：使用 Tauri 拖拽插件
			event.preventDefault();

			const icon = await resolveResource("assets/drag-icon.png");

			// 文件类型特殊处理：多选时合并所有文件路径
			if (firstGroup === "files") {
				// 收集所有选中项目的文件路径
				const allFiles: string[] = [];
				for (const selectedItem of sortedSelectedItems) {
					if (selectedItem.group === "files") {
						try {
							const files = JSON.parse(selectedItem.value);
							if (Array.isArray(files)) {
								allFiles.push(...files);
							}
						} catch (error) {
							console.warn("解析文件路径失败:", selectedItem.value, error);
						}
					}
				}

				if (allFiles.length > 0) {
					return startDrag({ icon, item: allFiles });
				}
			}

			if (firstGroup === "image") {
				// 为批量拖拽的第一个图片创建合适大小的预览
				const thumbnail = await createImageThumbnail(
					getActualValue(firstValue),
				);
				return startDrag({ item: [firstValue], icon: thumbnail });
			}

			startDrag({ icon, item: JSON.parse(firstValue) });
		} else {
			// 单个拖拽逻辑（保持原有逻辑不变）
			if (group === "text") {
				const actualValue = getActualValue(value);
				const dataTransfer = event.dataTransfer;

				if (!dataTransfer) return;

				dataTransfer.effectAllowed = "copy";

				// 格式文本类型：设置 HTML 和纯文本数据
				if (type === "formatted") {
					// 使用保留换行的文本提取函数
					const plainTextValue = extractTextWithNewlines(actualValue);

					dataTransfer.setData("text/plain", plainTextValue);
					// 只有 HTML 类型才写入 text/html，RTF 类型由 text/rtf 处理
					if (subtype === "html") {
						dataTransfer.setData("text/html", actualValue);
					}
					// RTF 类型由 text/rtf 处理，无需额外设置
				} else {
					dataTransfer.setData("text/plain", actualValue);
				}

				dataTransfer.setData("application/x-ecopaste-clipboard", actualValue);

				// 创建拖拽预览
				const previewContent = extractTextWithNewlines(actualValue.trim());

				createDragPreview(event, {
					content: previewContent,
					isBatch: false,
				});

				return;
			}

			// 非文本类型：使用 Tauri 拖拽插件
			event.preventDefault();

			const icon = await resolveResource("assets/drag-icon.png");

			if (group === "image") {
				// 为图片拖拽创建合适大小的预览
				const thumbnail = await createImageThumbnail(getActualValue(value));
				return startDrag({ item: [value], icon: thumbnail });
			}

			startDrag({ icon, item: JSON.parse(value) });
		}
	};

	// 拖拽结束事件
	const handleDragEnd = async () => {
		// 检查是否有批量拖拽信息
		const batchDragInfo = clipboardStore.batchDragInfo;
		if (!batchDragInfo || !batchDragInfo.isDragging) return;

		try {
			// 等待一小段时间确保拖拽操作完成
			await new Promise((resolve) => setTimeout(resolve, 100));

			// 检查第一个项目的类型，如果是文件类型，不需要执行批量粘贴
			// 因为文件拖拽到资源管理器已经完成了操作
			const firstItem = batchDragInfo.items[0];
			if (firstItem && firstItem.group === "files") {
				// 文件类型拖拽完成后，只需要更新状态和清除多选

				// 更新项目位置和时间
				const { updatedItems, currentTime } = updateItemsPositionAndTime(
					batchDragInfo.items,
				);

				// 批量更新数据库
				await batchUpdateDatabase(batchDragInfo.items, { time: currentTime });

				// 清除多选状态
				clearMultiSelectState();

				// 设置激活项为第一个项目
				setActiveItemAfterOperation(updatedItems);
			} else {
				// 非文件类型：批量粘贴时跳过第一个项目，因为第一个项目已经通过拖拽粘贴了
				const remainingItems = batchDragInfo.items.slice(1);
				if (remainingItems.length > 0) {
					// 提取 ID 列表，使用新的 prependNewline 参数
					const { batchPasteByIds } = await import("@/plugins/paste");
					const ids = remainingItems.map((item) => item.id).filter(Boolean);
					await batchPasteByIds(ids, false, false, true); // prependNewline=true
				}
			}

			// 更新项目位置和时间
			const { updatedItems, currentTime } = updateItemsPositionAndTime(
				batchDragInfo.items,
			);

			// 批量更新数据库
			await batchUpdateDatabase(batchDragInfo.items, { time: currentTime });

			// 清除多选状态
			clearMultiSelectState();

			// 设置激活项为第一个粘贴的项目
			setActiveItemAfterOperation(updatedItems);
		} catch (error) {
			console.error("批量拖拽粘贴失败:", error);
		} finally {
			// 清除批量拖拽信息
			clipboardStore.batchDragInfo = {
				items: [],
				isDragging: false,
			};
		}
	};

	// 渲染内容
	const renderContent = () => {
		switch (type) {
			case "formatted": {
				// 基于内容检测 RTF：如果 value 以 {\rtf 开头
				const isRtf =
					value?.startsWith("{\\rtf") || value?.startsWith("{\\\\rtf");
				if (isRtf) {
					return <RTF {...data} />;
				}
				// HTML 和 Markdown 使用 HTML 组件
				return <HTML {...data} />;
			}
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
					// 只在非多选状态下显示单选聚焦框
					"antd-input-focus!":
						state.activeId === id &&
						!clipboardStore.multiSelect.isMultiSelecting,
					// 多选状态下显示多选框，使用统一的样式系统
					"border-2 border-primary! shadow-[0_0_0_2px_rgba(5,145,255,0.1)] dark:shadow-[0_0_0_2px_rgba(0,60,180,0.15)]":
						isSelected,
				},
			)}
			onContextMenu={handleContextMenu}
			onClick={(event) => handleClick("single", event)}
			onDoubleClick={(event) => handleClick("double", event)}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
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
				sendEmail={sendEmail}
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
					<Note value={note} />
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
							// 在多选状态下，如果被选中则显示；否则在单选聚焦时显示
							"opacity-100":
								(clipboardStore.multiSelect.isMultiSelecting && isSelected) ||
								(!clipboardStore.multiSelect.isMultiSelecting &&
									state.activeId === id),
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
						{dayjs(time).locale(i18nInstance.language).fromNow()}
					</span>
				</Flex>
			</div>
		</Flex>
	);
};

export default Item;
