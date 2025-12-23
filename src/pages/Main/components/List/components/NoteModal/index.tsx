import { MainContext } from "@/pages/Main";
import type { HistoryTablePayload } from "@/types/database";
import { invoke } from "@tauri-apps/api/core";
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

			// 检测备注变更
			if (item.note !== note) {
				// 通知后端变更跟踪器（备注变更）
				try {
					invoke("notify_data_changed", {
						item_id: id,
						change_type: "note",
					});
				} catch (notifyError) {
					console.warn("通知后端变更跟踪器失败:", notifyError);
					// 不影响主要功能继续执行
				}
			}

			item.note = note;
			item.lastModified = currentTime;

			// 调用database插件更新备注
			await invoke("update_note", { id, note });

			// 通知后端变更跟踪器（备注变更）
			try {
				invoke("notify_data_changed", {
					item_id: id,
					change_type: "note",
				});
			} catch (notifyError) {
				console.warn("通知后端变更跟踪器失败:", notifyError);
				// 不影响主要功能继续执行
			}

			if (clipboardStore.content.autoFavorite && !favorite) {
				item.favorite = true;

				// 调用database插件更新收藏状态
				invoke("update_favorite", { id, favorite: true });

				// 通知后端变更跟踪器（收藏状态变更）
				try {
					invoke("notify_data_changed", {
						item_id: id,
						change_type: "favorite",
					});
				} catch (notifyError) {
					console.warn("通知后端变更跟踪器失败:", notifyError);
					// 不影响主要功能继续执行
				}
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
