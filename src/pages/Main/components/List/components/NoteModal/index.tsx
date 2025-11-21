import { MainContext } from "@/pages/Main";
import type { HistoryTablePayload } from "@/types/database";
import { Form, Input, type InputRef, Modal } from "antd";
import { t } from "i18next";
import { find } from "lodash-es";

export interface NoteModalRef {
	open: () => void;
}

interface FormFields {
	note: string;
}

const NoteModal = forwardRef<NoteModalRef>((_, ref) => {
	const { state } = useContext(MainContext);
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

	const handleOk = () => {
		const { note } = form.getFieldsValue();

		if (item) {
			const { id, favorite } = item;
			const currentTime = Date.now();

			item.note = note;
			item.lastModified = currentTime;
			// 重置同步状态为'none'，表示需要同步
			item.syncStatus = "none";

			// 更新备注时同时更新最后修改时间和同步状态
			updateSQL("history", {
				id,
				note,
				lastModified: currentTime,
				syncStatus: "none",
			});

			if (clipboardStore.content.autoFavorite && !favorite) {
				item.favorite = true;

				updateSQL("history", {
					id,
					favorite: 1,
					lastModified: currentTime,
					syncStatus: "none",
				} as any);
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
