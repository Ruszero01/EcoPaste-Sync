import UnoIcon from "@/components/UnoIcon";
import { Button, Input, Popover } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface CustomGroup {
	id: string;
	name: string;
	color: string;
	isExpanded?: boolean;
}

interface CustomGroupManagerProps {
	groups: CustomGroup[];
	onAddGroup: (name: string) => void;
	onDeleteGroup: (id: string) => void;
	onToggleGroup: (id: string) => void;
}

const DEFAULT_COLORS = [
	"#ff6b6b",
	"#4ecdc4",
	"#45b7d1",
	"#96ceb4",
	"#feca57",
	"#ff9ff3",
	"#54a0ff",
	"#48dbfb",
];

const CustomGroupManager: CustomGroupManagerProps = ({
	groups,
	onAddGroup,
	onDeleteGroup,
	onToggleGroup,
}) => {
	const { t } = useTranslation();
	const [newGroupName, setNewGroupName] = useState("");
	const [showAddGroup, setShowAddGroup] = useState(false);
	const [selectedColor, setSelectedColor] = useState(DEFAULT_COLORS[0]);

	const handleAddGroup = () => {
		if (newGroupName.trim()) {
			onAddGroup(newGroupName.trim());
			setNewGroupName("");
			setShowAddGroup(false);
		}
	};

	const handleDeleteGroup = (id: string) => {
		onDeleteGroup(id);
	};

	return (
		<div className="custom-group-manager">
			{/* 现有固定分组 - 垂直布局 */}
			<div className="fixed-groups mb-4">
				<div className="group-section-title mb-2 px-2 font-medium text-color-2 text-xs">
					{t("clipboard.label.fixed_groups")}
				</div>
				<div className="fixed-group-list space-y-1">
					{/* 这些将由父组件传递的固定分组渲染 */}
				</div>
			</div>

			{/* 自定义分组 */}
			<div className="custom-groups">
				<div className="group-section-title mb-2 flex items-center justify-between px-2 font-medium text-color-2 text-xs">
					<span>{t("clipboard.label.custom_groups")}</span>
					<Button
						type="text"
						size="small"
						icon={<UnoIcon name="i-lucide:plus" />}
						className="text-color-2 hover:text-primary"
						onClick={() => setShowAddGroup(!showAddGroup)}
					/>
				</div>

				<div className="custom-group-list space-y-1">
					{groups.map((group) => (
						<div
							key={group.id}
							className="group-item group flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-color-2/10"
							onClick={() => onToggleGroup(group.id)}
						>
							<div className="flex items-center gap-2">
								<div
									className="h-3 w-3 flex-shrink-0 rounded-full"
									style={{ backgroundColor: group.color }}
								/>
								<span className="truncate text-sm">{group.name}</span>
							</div>
							<Button
								type="text"
								size="small"
								icon={<UnoIcon name="i-lucide:x" />}
								className="text-color-3 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
								onClick={(e) => {
									e.stopPropagation();
									handleDeleteGroup(group.id);
								}}
							/>
						</div>
					))}
				</div>

				{/* 新建分组输入框 */}
				{showAddGroup && (
					<div className="add-group-input border-color-2/20 border-t p-2">
						<Input
							size="small"
							placeholder={t("clipboard.hints.new_group_placeholder")}
							value={newGroupName}
							onChange={(e) => setNewGroupName(e.target.value)}
							onPressEnter={handleAddGroup}
							onBlur={() => setTimeout(() => setShowAddGroup(false), 200)}
							autoFocus
							suffix={
								<Popover
									content={
										<div className="color-picker">
											<div className="mb-2 text-color-2 text-xs">
												{t("clipboard.label.choose_color")}
											</div>
											<div className="grid grid-cols-4 gap-1">
												{DEFAULT_COLORS.map((color) => (
													<div
														key={color}
														className="h-5 w-5 cursor-pointer rounded transition-transform hover:scale-110"
														style={{ backgroundColor: color }}
														onClick={() => setSelectedColor(color)}
													/>
												))}
											</div>
										</div>
									}
									placement="bottomRight"
									trigger="click"
								>
									<div
										className="h-3 w-3 cursor-pointer rounded-full"
										style={{ backgroundColor: selectedColor }}
									/>
								</Popover>
							}
						/>
					</div>
				)}
			</div>
		</div>
	);
};

export default CustomGroupManager;
