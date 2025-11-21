import { updateSQL } from "@/database";
import { MainContext } from "@/pages/Main";
import { clipboardStore } from "@/stores/clipboard";
import type { HistoryTablePayload } from "@/types/database";
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

	// 获取剪贴板内容的可编辑形式
	const getEditableContent = (item: HistoryTablePayload): string => {
		if (!item) return "";

		const { type, value } = item;

		switch (type) {
			case "text":
				return value;
			case "html":
				// 去除HTML标签获取纯文本进行编辑
				return value.replace(/<[^>]*>/g, "");
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
				const content = getEditableContent(findItem);

				form.setFieldsValue({
					content,
				});

				setItem(findItem);
			}

			toggle();
		},
	}));

	const handleOk = async () => {
		const { content } = form.getFieldsValue();

		if (item && content) {
			const { id, favorite, type: originalType } = item;

			// 更新内容，根据原始类型处理
			let finalValue = content;

			// 对于HTML类型，将纯文本转换为HTML格式
			if (originalType === "html") {
				// 将纯文本转换为HTML（转义HTML字符，保留换行）
				finalValue = content
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/\n/g, "<br>");
			}

			item.value = finalValue;
			item.lastModified = Date.now();

			await updateSQL("history", {
				id,
				value: finalValue,
				lastModified: Date.now(),
			});

			if (clipboardStore.content.autoFavorite && !favorite) {
				item.favorite = true;

				await updateSQL("history", { id, favorite: 1 } as any);
			}
		}

		toggle();
	};

	return (
		<Modal
			forceRender
			centered
			title={t("component.edit_modal.label.edit")}
			open={open}
			onOk={handleOk}
			onCancel={toggle}
			width={600}
		>
			<Form
				form={form}
				initialValues={{ content: item?.value }}
				onFinish={handleOk}
			>
				<Form.Item
					name="content"
					className="mb-0!"
					label={item ? getTextTypeLabel(item.type || "text") : ""}
				>
					<Input.TextArea
						autoComplete="off"
						placeholder={t("component.edit_modal.hints.input_content")}
						rows={12}
					/>
				</Form.Item>
			</Form>
		</Modal>
	);
});

export default EditModal;
