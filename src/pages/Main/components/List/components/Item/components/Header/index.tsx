import UnoIcon from "@/components/UnoIcon";
import { LISTEN_KEY } from "@/constants";
import { MainContext } from "@/pages/Main";
import { transferData } from "@/pages/Preference/components/Clipboard/components/OperationButton";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import type { OperationButton } from "@/types/store";
import { useCreation } from "ahooks";
import { Flex } from "antd";
import clsx from "clsx";
import type { FC, MouseEvent } from "react";
import { memo, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";

interface HeaderProps {
	data: HistoryTablePayload;
	copy: () => void;
	pastePlain: () => void;
	openNoteModel: () => void;
	openEditModal?: () => void;
	toggleFavorite: () => void;
	deleteItem: () => void;
	previewImage?: () => void;
	showInExplorer?: () => void;
	openInBrowser?: () => void;
	sendEmail?: () => void;
}

const Header: FC<HeaderProps> = (props) => {
	const { data } = props;
	const { id, type, favorite, subtype, search, sourceAppName, sourceAppIcon } =
		data;
	const { state } = useContext(MainContext);
	const { t } = useTranslation();
	const { content } = useSnapshot(clipboardStore);
	const [showTooltip, setShowTooltip] = useState(false);

	const operationButtons = useCreation(() => {
		return content.operationButtons.map((key) => {
			return transferData.find((data) => data.key === key)!;
		});
	}, [content.operationButtons]);

	// 判断按钮是否应该显示
	const shouldShowButton = (key: OperationButton): boolean => {
		switch (key) {
			case "showInExplorer":
				// 在文件类型和文本类型的路径条目上显示
				return type === "files" || (type === "text" && subtype === "path");
			case "previewImage":
				// 只在图片条目上显示
				return type === "image";
			case "openInBrowser":
				// 只在链接类型条目上显示
				return subtype === "url";
			case "sendEmail":
				// 只在邮箱类型条目上显示
				return subtype === "email";
			case "pastePlain":
				// 只在文本类条目和图片包含OCR文字时显示
				return (
					type === "formatted" ||
					(type === "image" &&
						typeof search === "string" &&
						!/^[\s]*$/.test(search))
				);
			case "edit":
				// 在文本类条目上显示（包括 markdown、color 等 text 子类型）
				return type === "text" || type === "formatted";
			case "copy":
			case "note":
			case "star":
			case "delete":
				// 在所有条目上都显示
				return true;
			default:
				return true;
		}
	};

	const renderType = () => {
		const { value } = data;

		// 优先检查type字段，而不是subtype字段
		// 这样可以确保当用户修改类型后，标题能正确更新
		switch (type) {
			case "code":
				// 代码类型，subtype 存储编程语言名称
				if (subtype) {
					return getLanguageDisplayName(subtype);
				}
				return t("clipboard.label.code");
			case "text":
				// 对于文本类型，检查subtype以显示更具体的信息
				switch (subtype) {
					case "url":
						return t("clipboard.label.link");
					case "email":
						return t("clipboard.label.email");
					case "path":
						return t("clipboard.label.path");
					case "markdown":
						return "Markdown";
					case "color":
						return t("clipboard.label.color");
					default:
						return t("clipboard.label.plain_text");
				}
			case "formatted":
				return t("clipboard.label.formatted");
			case "image":
				return t("clipboard.label.image");
			case "files": {
				let fileCount = 0;
				try {
					const parsed = JSON.parse(value);
					if (Array.isArray(parsed)) {
						if (parsed.length > 0 && typeof parsed[0] === "object") {
							// 新格式：文件元数据数组
							fileCount = parsed.length;
						} else if (parsed.length > 0 && typeof parsed[0] === "string") {
							// 旧格式：文件路径数组
							fileCount = parsed.length;
						}
					} else if (parsed.files && Array.isArray(parsed.files)) {
						// 新包模式，使用files数组的长度
						fileCount = parsed.files.length;
					}
				} catch (error) {
					console.warn("解析文件数量失败:", error);
					fileCount = 1; // 默认为1个文件
				}

				return t("clipboard.label.n_files", {
					replace: [fileCount],
				});
			}
			default:
				// 对于未知类型，检查subtype作为后备
				switch (subtype) {
					case "url":
						return t("clipboard.label.link");
					case "email":
						return t("clipboard.label.email");
					case "color":
						return t("clipboard.label.color");
					case "path":
						return t("clipboard.label.path");
					default:
						return t("clipboard.label.plain_text");
				}
		}
	};

	const handleClick = (event: MouseEvent, key: OperationButton) => {
		const {
			copy,
			pastePlain,
			openNoteModel,
			openEditModal,
			toggleFavorite,
			deleteItem,
			previewImage,
			showInExplorer,
			openInBrowser,
			sendEmail,
		} = props;

		event.stopPropagation();

		// 检查是否在多选模式
		const { multiSelect } = clipboardStore;
		const isMultiSelectMode =
			multiSelect.isMultiSelecting && multiSelect.selectedIds.size > 0;

		state.activeId = id;

		// 如果是多选模式且当前项目被选中，执行批量操作
		if (isMultiSelectMode && multiSelect.selectedIds.has(id)) {
			switch (key) {
				case "delete":
					// 触发批量删除 - 删除操作允许在任何选中的项目上执行
					return state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_BATCH_DELETE);
				case "star":
					// 触发批量收藏 - 收藏操作允许在任何选中的项目上执行
					return state.$eventBus?.emit(
						LISTEN_KEY.CLIPBOARD_ITEM_BATCH_FAVORITE,
					);
				default:
					// 其他操作不批量处理，只处理当前项目
					return;
			}
		}

		switch (key) {
			case "copy":
				return copy();
			case "pastePlain":
				return pastePlain();
			case "edit":
				return openEditModal?.();
			case "note":
				return openNoteModel();
			case "star":
				return toggleFavorite();
			case "showInExplorer":
				return showInExplorer?.();
			case "previewImage":
				return previewImage?.();
			case "openInBrowser":
				return openInBrowser?.();
			case "sendEmail":
				return sendEmail?.();
			case "delete":
				return deleteItem();
		}
	};

	return (
		<Flex
			justify="space-between"
			align="flex-start"
			gap="small"
			className="text-color-2"
		>
			{/* 左上角：来源应用图标 + 类型 */}
			<Flex align="center" gap={4} className="font-medium text-xs">
				{/* 仅在开启显示来源应用时显示图标和名称 */}
				{content.showSourceApp && sourceAppIcon ? (
					<div
						className="relative"
						onMouseEnter={() => sourceAppName && setShowTooltip(true)}
						onMouseLeave={() => setShowTooltip(false)}
					>
						<img
							src={sourceAppIcon}
							alt={sourceAppName}
							className="h-4 w-4 rounded"
							style={{
								maxWidth: "16px",
								maxHeight: "16px",
								objectFit: "contain",
							}}
						/>
						{/* 悬停提示 */}
						{showTooltip && sourceAppName && (
							<div className="absolute top-full left-0 z-50 mt-1 whitespace-nowrap rounded border border-neutral-300/50 bg-neutral-200/90 px-2 py-1 text-neutral-700 text-xs shadow-lg backdrop-blur-xl dark:border-neutral-700/50 dark:bg-neutral-800/90 dark:text-neutral-300">
								{sourceAppName}
							</div>
						)}
					</div>
				) : content.showSourceApp && sourceAppName ? (
					<div
						className="relative"
						onMouseEnter={() => setShowTooltip(true)}
						onMouseLeave={() => setShowTooltip(false)}
					>
						<div
							className="flex h-4 w-4 items-center justify-center rounded bg-neutral-300 font-medium text-[10px] text-neutral-700 dark:bg-neutral-600 dark:text-neutral-300"
							style={{
								width: "16px",
								height: "16px",
							}}
						>
							{sourceAppName.substring(0, 3).toUpperCase()}
						</div>
						{/* 悬停提示 */}
						{showTooltip && (
							<div className="absolute top-full left-0 z-50 mt-1 whitespace-nowrap rounded border border-neutral-300/50 bg-neutral-200/90 px-2 py-1 text-neutral-700 text-xs shadow-lg backdrop-blur-xl dark:border-neutral-700/50 dark:bg-neutral-800/90 dark:text-neutral-300">
								来源: {sourceAppName}
							</div>
						)}
					</div>
				) : null}
				<span>{renderType()}</span>
			</Flex>

			{/* 右上角：操作按钮 */}
			<Flex
				align="center"
				gap={6}
				className={clsx("opacity-0 transition group-hover:opacity-100", {
					"opacity-100": state.activeId === id,
				})}
				onDoubleClick={(event) => event.stopPropagation()}
			>
				{operationButtons
					.filter((item) => shouldShowButton(item.key))
					.map((item) => {
						const { key, icon, activeIcon, title } = item;

						const isFavorite = key === "star" && favorite;

						return (
							<UnoIcon
								key={key}
								hoverable
								name={isFavorite ? activeIcon : icon}
								title={t(title)}
								className={clsx({ "text-gold!": isFavorite })}
								onClick={(event) => handleClick(event, key)}
							/>
						);
					})}
			</Flex>
		</Flex>
	);
};

export default memo(Header);
