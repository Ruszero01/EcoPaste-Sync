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
	} = data;
	const { state, forceRefreshList } = useContext(MainContext);
	const { t, i18n: i18nInstance } = useTranslation();
	const { env } = useSnapshot(globalStore);
	const { content } = useSnapshot(clipboardStore);

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

			await revealItemInDir(pathToReveal);
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
			className={clsx(
				className,
				"group antd-input! b-color-2 absolute inset-0 mx-0 h-full rounded-md p-1.5",
				{
					"antd-input-focus!": state.activeId === id,
				},
			)}
			onContextMenu={handleContextMenu}
			onClick={() => handleClick("single")}
			onDoubleClick={() => handleClick("double")}
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
						{dayjs(createTime).locale(i18nInstance.language).fromNow()}
					</span>
				</Flex>
			</div>
		</Flex>
	);
};

export default Item;
