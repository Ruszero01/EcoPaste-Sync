import { updateSQL } from "@/database";
import { MainContext } from "@/pages/Main";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { githubDark } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { useBoolean } from "ahooks";
import { Form, Input, Modal } from "antd";
import { find } from "lodash-es";
import { forwardRef, useContext, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

export interface EditModalRef {
	open: () => void;
}

interface FormFields {
	content: string;
}

const EditModal = forwardRef<EditModalRef>((_, ref) => {
	const { t } = useTranslation();
	const { state } = useContext(MainContext);
	const [open, { toggle }] = useBoolean();
	const [item, setItem] = useState<HistoryTablePayload>();
	const [form] = Form.useForm<FormFields>();
	const [content, setContent] = useState<string>("");

	// 获取剪贴板内容的可编辑形式
	const getEditableContent = (item: HistoryTablePayload): string => {
		if (!item) return "";

		const { type, value } = item;

		switch (type) {
			case "text":
				return value;
			case "html":
				// 显示完整的HTML原始内容进行编辑
				return value;
			case "rtf":
				// 去除RTF标记获取纯文本进行编辑
				return value.replace(/\\[a-zA-Z]+\d*/g, "").replace(/[{}]/g, "");
			default:
				return value;
		}
	};

	// 获取文本类型的显示名称
	const getTextTypeLabel = (type: string): string => {
		switch (type) {
			case "text":
				return t("clipboard.label.plain_text");
			case "html":
				return t("clipboard.label.html");
			case "rtf":
				return t("clipboard.label.rtf");
			default:
				return t("clipboard.label.plain_text");
		}
	};

	useImperativeHandle(ref, () => ({
		open: () => {
			const findItem = find(state.list, { id: state.activeId });

			if (findItem) {
				const editableContent = getEditableContent(findItem);

				setContent(editableContent);
				form.setFieldsValue({
					content: editableContent,
				});

				setItem(findItem);
			}

			toggle();
		},
	}));

	const handleOk = async () => {
		if (item && content) {
			const { id, favorite } = item;

			// 使用统一的时间戳
			const currentTime = Date.now();

			// 更新本地数据
			item.value = content;
			item.lastModified = currentTime;
			// 重置同步状态为'none'，表示需要同步
			item.syncStatus = "none";

			// 更新数据库，包含新的内容、时间戳和同步状态
			await updateSQL("history", {
				id,
				value: content,
				lastModified: currentTime,
				syncStatus: "none",
			});

			// 如果自动收藏功能开启，更新收藏状态，同时保持同步状态为'none'
			if (clipboardStore.content.autoFavorite && !favorite) {
				item.favorite = true;

				await updateSQL("history", {
					id,
					favorite: 1,
					lastModified: currentTime,
					syncStatus: "none",
				} as any);
			}
		}

		toggle();
	};

	// 判断是否使用代码编辑器
	const shouldUseCodeEditor = (type?: string) => {
		return type === "html" || type === "rtf";
	};

	// 获取语言扩展
	const getLanguageExtension = (type?: string) => {
		switch (type) {
			case "html":
				return [html()];
			case "rtf":
				// RTF 使用JavaScript语言高亮（作为代码文本）
				return [javascript()];
			default:
				return [];
		}
	};

	return (
		<Modal
			forceRender
			centered
			title={t("component.edit_modal.label.edit")}
			open={open}
			onOk={handleOk}
			onCancel={toggle}
			width={900}
		>
			<Form form={form} initialValues={{ content }} onFinish={handleOk}>
				<Form.Item
					className="mb-0!"
					label={item ? getTextTypeLabel(item.type || "text") : ""}
				>
					{shouldUseCodeEditor(item?.type) ? (
						<div className="rounded border border-gray-300">
							<CodeMirror
								value={content}
								height="400px"
								theme={githubDark}
								extensions={getLanguageExtension(item?.type)}
								onChange={(value) => {
									const newContent = value || "";
									setContent(newContent);
									form.setFieldsValue({ content: newContent });
								}}
								basicSetup={{
									lineNumbers: true,
									highlightActiveLineGutter: true,
									highlightSpecialChars: true,
									history: true,
									foldGutter: true,
									drawSelection: true,
									dropCursor: true,
									allowMultipleSelections: true,
									indentOnInput: true,
									syntaxHighlighting: true,
									bracketMatching: true,
									closeBrackets: true,
									autocompletion: true,
									highlightActiveLine: true,
									highlightSelectionMatches: true,
								}}
							/>
						</div>
					) : (
						<Input.TextArea
							value={content}
							onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
								const newContent = e.target.value;
								setContent(newContent);
								form.setFieldsValue({ content: newContent });
							}}
							autoComplete="off"
							placeholder={t("component.edit_modal.hints.input_content")}
							rows={12}
						/>
					)}
				</Form.Item>
			</Form>
		</Modal>
	);
});

export default EditModal;
