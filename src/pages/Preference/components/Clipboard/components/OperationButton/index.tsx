import ProListItem from "@/components/ProListItem";
import UnoIcon from "@/components/UnoIcon";
import type { OperationButton as Key } from "@/types/store";
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Flex, Modal, Transfer } from "antd";
import type { TransferCustomListBodyProps } from "antd/lib/transfer/list";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";

interface TransferData {
	key: Key;
	title: string;
	icon: string;
	activeIcon?: string;
}

export const transferData: TransferData[] = [
	{
		key: "copy",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.copy",
		icon: "i-lucide:copy",
	},
	{
		key: "pastePlain",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.paste_plain",
		icon: "i-lucide:clipboard-paste",
	},
	{
		key: "edit",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.edit",
		icon: "i-lucide:edit",
	},
	{
		key: "note",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.notes",
		icon: "i-lucide:clipboard-pen-line",
	},
	{
		key: "star",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.favorite",
		icon: "i-iconamoon:star",
		activeIcon: "i-iconamoon:star-fill",
	},
	{
		key: "showInExplorer",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.show_in_explorer",
		icon: "i-lucide:folder-open",
	},
	{
		key: "previewImage",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.preview_image",
		icon: "i-lucide:image",
	},
	{
		key: "openInBrowser",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.open_in_browser",
		icon: "i-lucide:globe",
	},
	{
		key: "sendEmail",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.send_email",
		icon: "i-lucide:mail",
	},
	{
		key: "delete",
		title:
			"preference.clipboard.content_settings.label.operation_button_option.delete",
		icon: "i-lucide:trash",
	},
];

// 左侧按钮项
const ButtonItem: React.FC<{
	data: TransferData;
	isChecked: boolean;
	onCheck: (key: string) => void;
	t: ReturnType<typeof useTranslation>[0];
}> = ({ data, isChecked, onCheck, t }) => {
	return (
		<Flex
			align="center"
			gap={8}
			className="h-8 cursor-pointer rounded px-2 hover:bg-gray-100 dark:hover:bg-gray-700"
			onClick={() => onCheck(data.key)}
		>
			<input
				type="checkbox"
				checked={isChecked}
				readOnly
				className="cursor-pointer"
			/>
			<UnoIcon name={data.icon} />
			<span className="truncate text-sm">{t(data.title)}</span>
		</Flex>
	);
};

// 右侧可排序按钮项
const SortableButtonItem: React.FC<{
	data: TransferData;
	isChecked: boolean;
	onCheck: (key: string) => void;
	t: ReturnType<typeof useTranslation>[0];
}> = ({ data, isChecked, onCheck, t }) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: data.key });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<Flex
			ref={setNodeRef}
			style={style}
			align="center"
			gap={8}
			className="h-8 cursor-pointer rounded px-2 hover:bg-gray-100 dark:hover:bg-gray-700"
			onClick={() => onCheck(data.key)}
		>
			<input
				type="checkbox"
				checked={isChecked}
				readOnly
				className="cursor-pointer"
			/>
			<div
				{...attributes}
				{...listeners}
				onClick={(e) => e.stopPropagation()}
				className="cursor-grab active:cursor-grabbing"
			>
				<UnoIcon name="i-lucide:grip-vertical" className="text-gray-400" />
			</div>
			<UnoIcon name={data.icon} />
			<span className="truncate text-sm">{t(data.title)}</span>
		</Flex>
	);
};

const OperationButton = () => {
	const { content } = useSnapshot(clipboardStore);
	const [open, { toggle }] = useBoolean();
	const { t } = useTranslation();

	// 使用 state 管理选中状态
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		new Set(content.operationButtons.map(String)),
	);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = (event: {
		active: { id: string | number };
		over: { id: string | number } | null;
	}) => {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			const oldIndex = content.operationButtons.findIndex(
				(key) => key === active.id,
			);
			const newIndex = content.operationButtons.findIndex(
				(key) => key === over.id,
			);

			const newOrder = arrayMove(content.operationButtons, oldIndex, newIndex);
			clipboardStore.content.operationButtons = newOrder;
			setSelectedKeys(new Set(newOrder.map(String)));
		}
	};

	const handleCheck = (key: string) => {
		const newSet = new Set(selectedKeys);
		if (newSet.has(key)) {
			newSet.delete(key);
		} else {
			newSet.add(key);
		}
		setSelectedKeys(newSet);
	};

	const renderTransferData = (data: TransferData) => {
		return (
			<Flex key={data.key} align="center" gap={8} className="h-8">
				<UnoIcon name={data.icon} />
				<span className="truncate text-sm">{t(data.title)}</span>
			</Flex>
		);
	};

	const renderTree = (data: TransferCustomListBodyProps<TransferData>) => {
		const { direction } = data;

		if (direction === "right" && content.operationButtons?.length) {
			return (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={content.operationButtons}
						strategy={verticalListSortingStrategy}
					>
						<div
							className="space-y-1 overflow-y-auto px-1"
							style={{ height: 280 }}
						>
							{content.operationButtons.map((key) => {
								const itemData = transferData.find((d) => d.key === key);
								if (!itemData) return null;

								const isChecked = selectedKeys.has(String(key));

								return (
									<SortableButtonItem
										key={key}
										data={itemData}
										isChecked={isChecked}
										onCheck={(itemKey) => {
											handleCheck(itemKey);
										}}
										t={t}
									/>
								);
							})}
						</div>
					</SortableContext>
				</DndContext>
			);
		}

		if (direction === "left") {
			// 左侧只显示未选中的项
			const unselectedItems = transferData.filter(
				(item) => !content.operationButtons.includes(item.key),
			);
			return (
				<div className="space-y-1 overflow-y-auto px-1" style={{ height: 280 }}>
					{unselectedItems.map((item) => {
						const isChecked = selectedKeys.has(String(item.key));
						return (
							<ButtonItem
								key={item.key}
								data={item}
								isChecked={isChecked}
								onCheck={(itemKey) => {
									handleCheck(itemKey);
								}}
								t={t}
							/>
						);
					})}
				</div>
			);
		}

		return null;
	};

	return (
		<>
			<ProListItem
				title={t(
					"preference.clipboard.content_settings.label.operation_button",
				)}
				description={t(
					"preference.clipboard.content_settings.hints.operation_button",
				)}
			>
				<Button onClick={toggle}>
					{t(
						"preference.clipboard.content_settings.button.custom_operation_button",
					)}
				</Button>
			</ProListItem>

			<Modal
				centered
				destroyOnClose
				open={open}
				title={t(
					"preference.clipboard.content_settings.label.custom_operation_button_title",
				)}
				width={480}
				footer={null}
				onCancel={toggle}
			>
				<Transfer
					dataSource={transferData}
					targetKeys={Array.from(new Set(content.operationButtons.map(String)))}
					render={renderTransferData}
					showSearch={false}
					titles={["", ""]}
					listStyle={{
						width: 200,
						height: 320,
					}}
					selectedKeys={Array.from(selectedKeys)}
					onSelectChange={(_, targetSelectedKeys) => {
						setSelectedKeys(new Set(targetSelectedKeys.map(String)));
					}}
					onChange={(keys) => {
						clipboardStore.content.operationButtons = keys as Key[];
					}}
				>
					{renderTree}
				</Transfer>
			</Modal>
		</>
	);
};

export default OperationButton;
