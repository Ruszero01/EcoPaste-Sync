import UnoIcon from "@/components/UnoIcon";
import { MainContext } from "@/pages/Main";
import { transferData } from "@/pages/Preference/components/Clipboard/components/OperationButton";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import type { OperationButton } from "@/types/store";
import { Flex } from "antd";
import clsx from "clsx";
import type { FC, MouseEvent } from "react";
import { memo, useContext } from "react";
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
}

const Header: FC<HeaderProps> = (props) => {
	const { data } = props;
	const {
		id,
		type,
		favorite,
		subtype,
		search,
		isCode,
		codeLanguage,
		sourceAppName,
	} = data;
	const { state } = useContext(MainContext);
	const { t } = useTranslation();
	const { content } = useSnapshot(clipboardStore);

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
			case "pastePlain":
				// 只在文本类条目和图片包含OCR文字时显示
				return (
					type === "html" ||
					type === "rtf" ||
					(type === "image" &&
						typeof search === "string" &&
						!/^[\s]*$/.test(search))
				);
			case "edit":
				// 只在文本类条目上显示
				return type === "text" || type === "html" || type === "rtf";
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

		switch (subtype) {
			case "url":
				return t("clipboard.label.link");
			case "email":
				return t("clipboard.label.email");
			case "color":
				return t("clipboard.label.color");
			case "path":
				return t("clipboard.label.path");
		}

		switch (type) {
			case "text":
				// 如果是代码，显示编程语言名称
				if (isCode && codeLanguage) {
					return getLanguageDisplayName(codeLanguage);
				}
				return t("clipboard.label.plain_text");
			case "rtf":
				return t("clipboard.label.rtf");
			case "html":
				return t("clipboard.label.html");
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
		} = props;

		event.stopPropagation();

		state.activeId = id;

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
			{/* 左上角：来源应用 + 类型 */}
			<Flex align="center" gap={4} className="font-medium text-xs">
				{sourceAppName && (
					<span
						className="rounded bg-neutral-200/80 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-400"
						title={`来源: ${sourceAppName}`}
					>
						{sourceAppName}
					</span>
				)}
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
