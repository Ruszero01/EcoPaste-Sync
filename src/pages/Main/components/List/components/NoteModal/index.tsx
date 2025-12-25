import { MainContext } from "@/pages/Main";
import { backendUpdateField } from "@/plugins/database";
import type { HistoryTablePayload } from "@/types/database";
import { Form, Input, type InputRef, Modal } from "antd";
import { find } from "lodash-es";
import { useTranslation } from "react-i18next";

export interface NoteModalRef {
	open: () => void;
}

interface FormFields {
	note: string;
}

const NoteModal = forwardRef<NoteModalRef>((_, ref) => {
	const { state } = useContext(MainContext);
	const { t } = useTranslation();
	const [open, { toggle }] = useBoolean();
	const [item, setItem] = useState<HistoryTablePayload>();
	const [form] = Form.useForm<FormFields>();
	const inputRef = useRef<InputRef>(null);

	useImperativeHandle(ref, () => ({
		open: () => {
			const findItem = find(state.list, { id: state.activeId });

			form.setFieldsValue({
				note: findItem?.note,
			});

			setItem(findItem);

			toggle();
		},
	}));

	const handleOk = async () => {
		const { note } = form.getFieldsValue();

		if (item) {
			const { id, favorite } = item;
			const currentTime = Date.now();

			item.note = note;
			item.lastModified = currentTime;

			// 调用database插件更新备注（后端会自动标记为已变更）
			await backendUpdateField(id, "note", note);

			if (clipboardStore.content.autoFavorite && !favorite) {
				item.favorite = true;

				// 调用database插件更新收藏状态（后端会自动标记为已变更）
				await backendUpdateField(id, "favorite", "true");
			}
		}

		toggle();
	};

	const handleAfterOpenChange = (open: boolean) => {
		if (!open) return;

		inputRef.current?.focus();
	};

	return (
		<Modal
			forceRender
			centered
			title={t("component.note_modal.label.note")}
			open={open}
			onOk={handleOk}
			onCancel={toggle}
			afterOpenChange={handleAfterOpenChange}
		>
			<Form
				form={form}
				initialValues={{ note: item?.note }}
				onFinish={handleOk}
			>
				<Form.Item name="note" className="mb-0!">
					<Input
						ref={inputRef}
						autoComplete="off"
						placeholder={t("component.note_modal.hints.input_note")}
					/>
				</Form.Item>
			</Form>
		</Modal>
	);
});

export default NoteModal;
