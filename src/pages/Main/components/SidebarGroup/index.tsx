import { LISTEN_KEY } from "@/constants";
import type { BookmarkGroup } from "@/types/sync";
import { bookmarkManager } from "@/utils/bookmarkManager";
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
import { listen } from "@tauri-apps/api/event";
// 移除了useKeyPress导入，因为不再需要Tab键切换功能
import { Input, Modal } from "antd";
import clsx from "clsx";
import { useCallback, useContext, useEffect, useState } from "react";
import { MainContext } from "../..";

interface CustomGroup {
	id: string;
	name: string;
	color: string;
	createTime: number;
}

interface SidebarGroupProps {
	onHasGroupsChange?: (hasGroups: boolean) => void;
}

// 可拖拽的书签项组件
const SortableBookmarkItem: React.FC<{
	group: CustomGroup;
	isChecked: boolean;
	onChange: (group: CustomGroup) => void;
	onMiddleClick: (id: string) => void;
	onContextMenu: (e: React.MouseEvent, group: CustomGroup) => void;
}> = ({ group, isChecked, onChange, onMiddleClick, onContextMenu }) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: group.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={clsx(
				"group relative flex h-6 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md transition-all duration-200",
				{
					"bg-primary text-white shadow-md": isChecked,
					"bg-color-1 hover:scale-105 hover:bg-color-1 hover:shadow-sm":
						!isChecked && !isDragging,
					"bg-color-1/50": isDragging,
				},
			)}
			onClick={() => onChange(group)}
			onMouseDown={(e) => {
				// 中键点击（button === 1）
				if (e.button === 1) {
					e.preventDefault();
					onMiddleClick(group.id);
				}
			}}
			onContextMenu={(e) => onContextMenu(e, group)}
			title={`${group.name}`}
		>
			{/* 拖拽手柄 */}
			<div
				{...attributes}
				{...listeners}
				className="absolute top-0 bottom-0 left-0 w-full cursor-grab bg-gradient-to-r from-transparent via-black/10 to-transparent opacity-0 transition-opacity hover:opacity-100 active:cursor-grabbing"
			/>

			{/* 彩色指示条 */}
			<div
				className="absolute top-1 bottom-1 left-0 w-1 rounded-r"
				style={{ backgroundColor: group.color }}
			/>

			{/* 分组名称缩写 */}
			<span
				className={clsx(
					"select-none truncate font-medium text-xs leading-tight",
					{ "text-white": isChecked, "text-color-1": !isChecked },
				)}
			>
				{(() => {
					const hasEnglish = /[a-zA-Z]/.test(group.name);
					const maxLength = hasEnglish ? 3 : 2;
					return group.name.length > maxLength
						? group.name.slice(0, maxLength)
						: group.name;
				})()}
			</span>
		</div>
	);
};

const SidebarGroup: React.FC<SidebarGroupProps> = ({ onHasGroupsChange }) => {
	const { state, getListCache, getListDebounced } = useContext(MainContext);
	const [checked, setChecked] = useState<string>();
	const [customGroups, setCustomGroups] = useState<CustomGroup[]>([]);

	// 拖拽传感器配置
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8, // 移动8px后才开始拖拽
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	// 拖拽结束处理
	const handleDragEnd = async (event: any) => {
		const { active, over } = event;

		if (active.id !== over?.id) {
			const oldIndex = customGroups.findIndex(
				(group) => group.id === active.id,
			);
			const newIndex = customGroups.findIndex((group) => group.id === over?.id);

			if (oldIndex !== -1 && newIndex !== -1) {
				const newGroups = arrayMove(customGroups, oldIndex, newIndex);

				// 更新UI状态
				setCustomGroups(newGroups);

				// 更新书签管理器中的数据
				try {
					// 转换为BookmarkGroup格式，更新修改时间
					const bookmarkGroups: BookmarkGroup[] = newGroups.map((group) => ({
						...group,
						updateTime: Date.now(), // 更新修改时间以触发同步
						createTime: group.createTime || Date.now(), // 确保有createTime
					}));

					// 使用新的reorderGroups方法更新顺序
					await bookmarkManager.reorderGroups(bookmarkGroups);

					onHasGroupsChange?.(newGroups.length > 0);
				} catch (error) {
					console.error("更新书签顺序失败:", error);
					// 恢复原顺序
					setCustomGroups(customGroups);
				}
			}
		}
	};

	// 右键菜单状态
	const [contextMenuVisible, setContextMenuVisible] = useState(false);
	const [contextMenuPosition, setContextMenuPosition] = useState({
		x: 0,
		y: 0,
	});
	const [selectedGroup, setSelectedGroup] = useState<CustomGroup | null>(null);
	const [editModalVisible, setEditModalVisible] = useState(false);
	const [editGroupName, setEditGroupName] = useState("");
	const [editGroupColor, setEditGroupColor] = useState("");

	const colorOptions = [
		{ value: "#ff6b6b", label: "红色", display: "bg-red-400" },
		{ value: "#4ecdc4", label: "青色", display: "bg-teal-400" },
		{ value: "#45b7d1", label: "蓝色", display: "bg-blue-400" },
		{ value: "#96ceb4", label: "绿色", display: "bg-green-400" },
		{ value: "#feca57", label: "黄色", display: "bg-yellow-400" },
		{ value: "#ff9ff3", label: "粉色", display: "bg-pink-400" },
		{ value: "#54a0ff", label: "深蓝色", display: "bg-blue-500" },
		{ value: "#48dbfb", label: "天蓝色", display: "bg-sky-400" },
		{ value: "#ff6348", label: "橙红色", display: "bg-orange-500" },
		{ value: "#1dd1a1", label: "翠绿色", display: "bg-emerald-400" },
		{ value: "#ffeaa7", label: "浅黄色", display: "bg-amber-200" },
		{ value: "#dfe6e9", label: "灰色", display: "bg-gray-300" },
	];

	// 移除了Tab键切换书签功能，避免与顶部分组Tab键冲突
	// 用户可以通过鼠标点击来选择和切换书签

	const handleChange = useCallback(
		(group: CustomGroup) => {
			// 如果点击的是已激活的分组，则取消激活
			if (checked === group.id) {
				setChecked(undefined);
				state.search = undefined;

				// 取消选中书签时，强制清除所有缓存并刷新列表
				// 确保在书签选中期间新增的条目能够正确显示
				if (getListCache?.current) {
					getListCache.current.clear();
				}
				// 立即触发刷新，不使用防抖，确保新条目立即显示
				if (getListDebounced) {
					getListDebounced(0);
				}
			} else {
				setChecked(group.id);
				// 自定义分组使用搜索逻辑，但保留其他过滤条件
				state.search = group.name;
				// 不再重置 state.group 和 state.favorite，使其与顶部固定分组可以同时生效

				// 强制触发列表刷新
				if (getListCache?.current) {
					getListCache.current.clear();
				}
				if (getListDebounced) {
					getListDebounced(50);
				}
			}
		},
		[checked, state, getListCache, getListDebounced],
	);

	const handleDeleteCustomGroup = async (id: string) => {
		const success = await bookmarkManager.deleteGroup(id);
		if (success) {
			setCustomGroups(customGroups.filter((group) => group.id !== id));
			if (checked === id) {
				// 如果删除的是当前选中的分组，清除搜索但保留其他过滤条件
				state.search = undefined;
				setChecked(undefined);
				// 删除选中的书签时，也要强制刷新列表确保新条目显示
				if (getListCache?.current) {
					getListCache.current.clear();
				}
				// 立即刷新，确保新条目能够显示
				if (getListDebounced) {
					getListDebounced(0);
				}
			}
		}
	};

	// 右键菜单处理函数
	const handleContextMenu = (event: React.MouseEvent, group: CustomGroup) => {
		event.preventDefault();
		event.stopPropagation();

		setSelectedGroup(group);
		setContextMenuPosition({ x: event.clientX, y: event.clientY });
		setContextMenuVisible(true);
	};

	const handleEditGroup = () => {
		if (selectedGroup) {
			setEditGroupName(selectedGroup.name);
			setEditGroupColor(selectedGroup.color);
			setEditModalVisible(true);
		}
		setContextMenuVisible(false);
	};

	const handleDeleteGroup = async () => {
		if (selectedGroup) {
			await handleDeleteCustomGroup(selectedGroup.id);
		}
		setContextMenuVisible(false);
	};

	const handleSaveEdit = async () => {
		if (selectedGroup && editGroupName.trim()) {
			// 使用bookmarkManager更新分组
			const updatedGroup = await bookmarkManager.updateGroup(selectedGroup.id, {
				name: editGroupName.trim(),
				color: editGroupColor,
			});

			if (updatedGroup) {
				// 更新本地状态
				setCustomGroups((prev) =>
					prev.map((group) =>
						group.id === selectedGroup.id
							? { ...group, name: editGroupName.trim(), color: editGroupColor }
							: group,
					),
				);

				// 如果编辑的是当前选中的分组，更新搜索状态
				if (checked === selectedGroup.id) {
					state.search = editGroupName.trim();
					if (getListDebounced) {
						getListDebounced(50);
					}
				}
			}
		}
		setEditModalVisible(false);
		setSelectedGroup(null);
	};

	// 点击其他地方关闭右键菜单
	useEffect(() => {
		const handleClickOutside = () => {
			setContextMenuVisible(false);
		};

		if (contextMenuVisible) {
			document.addEventListener("click", handleClickOutside);
			return () => {
				document.removeEventListener("click", handleClickOutside);
			};
		}
	}, [contextMenuVisible]);

	// 初始化时加载书签数据
	useEffect(() => {
		const loadBookmarks = async () => {
			try {
				const groups = await bookmarkManager.getGroups();
				// 转换为CustomGroup格式
				const customGroups: CustomGroup[] = groups.map((group) => ({
					id: group.id,
					name: group.name,
					color: group.color,
					createTime: group.createTime,
				}));
				setCustomGroups(customGroups);
				onHasGroupsChange?.(customGroups.length > 0);
			} catch (error) {
				console.error("Failed to load bookmark groups:", error);
				setCustomGroups([]);
				onHasGroupsChange?.(false);
			}
		};

		loadBookmarks();
	}, [onHasGroupsChange]);

	// 监听书签数据变化事件和创建分组事件
	useEffect(() => {
		// 监听书签数据变化事件
		const unlistenDataChanged = listen(
			LISTEN_KEY.BOOKMARK_DATA_CHANGED,
			async () => {
				try {
					const groups = await bookmarkManager.getGroups();
					// 转换为CustomGroup格式
					const customGroups: CustomGroup[] = groups.map((group) => ({
						id: group.id,
						name: group.name,
						color: group.color,
						createTime: group.createTime,
					}));

					// 检查是否有实际变化，避免不必要的重新渲染
					setCustomGroups((prevGroups) => {
						const hasChanged =
							prevGroups.length !== customGroups.length ||
							prevGroups.some((prev, index) => {
								const curr = customGroups[index];
								return (
									!curr ||
									prev.id !== curr.id ||
									prev.name !== curr.name ||
									prev.color !== curr.color
								);
							});

						if (!hasChanged) {
							console.info("🔄 书签数据无变化，跳过UI刷新");
							return prevGroups;
						}

						console.info(
							`🔄 书签数据已更新，UI将刷新: ${prevGroups.length} -> ${customGroups.length}个分组`,
						);
						return customGroups;
					});

					onHasGroupsChange?.(customGroups.length > 0);
				} catch (error) {
					console.error(
						"Failed to reload bookmark groups after data change:",
						error,
					);
				}
			},
		);

		const handleCreateGroup = async (groupName: string) => {
			const colors = [
				"#ff6b6b", // 红色
				"#4ecdc4", // 青色
				"#45b7d1", // 蓝色
				"#96ceb4", // 绿色
				"#feca57", // 黄色
				"#ff9ff3", // 粉色
				"#54a0ff", // 深蓝色
				"#48dbfb", // 天蓝色
				"#ff6348", // 橙红色
				"#1dd1a1", // 翠绿色
				"#ffeaa7", // 浅黄色
				"#dfe6e9", // 灰色
			];
			// 使用更好的随机数生成方式
			const randomIndex = Math.floor(Math.random() * colors.length);

			// 使用bookmarkManager创建新分组
			const newGroup = await bookmarkManager.addGroup(
				groupName,
				colors[randomIndex],
			);
			if (newGroup) {
				// 不再手动更新本地状态，让BOOKMARK_DATA_CHANGED事件处理UI更新
				// 这样可以避免重复添加的问题
				console.info(
					`➕ 书签分组创建成功: ${newGroup.name}, 等待事件触发UI更新`,
				);

				// 自动激活新创建的书签（延迟执行，等待UI更新）
				setTimeout(() => {
					const customGroup: CustomGroup = {
						id: newGroup.id,
						name: newGroup.name,
						color: newGroup.color,
						createTime: newGroup.createTime,
					};
					handleChange(customGroup);
				}, 100); // 增加延迟确保UI已更新
			}
		};

		// 监听Tauri事件
		const unlisten = listen<string>(LISTEN_KEY.CREATE_CUSTOM_GROUP, (event) => {
			handleCreateGroup(event.payload);
		});

		return () => {
			// 清理所有事件监听器
			Promise.all([unlistenDataChanged, unlisten]).then((unlistenFunctions) => {
				for (const fn of unlistenFunctions) {
					fn();
				}
			});
		};
	}, [onHasGroupsChange, handleChange]);

	// 通知父组件是否有书签
	useEffect(() => {
		onHasGroupsChange?.(customGroups.length > 0);
	}, [customGroups, onHasGroupsChange]);

	// 监听搜索状态变化，当用户激活输入框时清除书签选中状态
	useEffect(() => {
		// 如果当前有选中的书签，且搜索内容不再是书签名称，则清除选中状态
		if (checked && state.search) {
			const selectedGroup = customGroups.find((group) => group.id === checked);
			if (selectedGroup && state.search !== selectedGroup.name) {
				// 搜索内容已变化，清除书签选中状态
				setChecked(undefined);
			}
		}
	}, [state.search, checked, customGroups]);

	// 如果没有自定义分组，不显示侧边栏
	if (customGroups.length === 0) {
		return null;
	}

	return (
		/* 书签栏 - 与列表容器等高，可垂直滚动 */
		<div className="flex h-full w-12 shrink-0 flex-col items-center bg-color-2/3 py-1">
			{/* 可滚动的书签列表 */}
			<div className="scrollbar-hide flex-1 overflow-y-auto overflow-x-hidden">
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={customGroups.map((group) => group.id)}
						strategy={verticalListSortingStrategy}
					>
						<div className="flex flex-col items-center gap-0.5 py-1">
							{customGroups.map((group) => {
								const isChecked = checked === group.id;

								return (
									<SortableBookmarkItem
										key={group.id}
										group={group}
										isChecked={isChecked}
										onChange={handleChange}
										onMiddleClick={handleDeleteCustomGroup}
										onContextMenu={handleContextMenu}
									/>
								);
							})}
						</div>
					</SortableContext>
				</DndContext>
			</div>

			{/* 开发模式：清空书签按钮 */}
			{import.meta.env.DEV && (
				<div className="flex flex-col items-center gap-0.5 py-1">
					<div
						className="group relative flex h-6 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md bg-orange-500/20 transition-all duration-200 hover:bg-orange-500/30"
						onClick={async () => {
							await bookmarkManager.clearForNewDevice();
							// 刷新UI
							setCustomGroups([]);
							onHasGroupsChange?.(false);
						}}
						title="开发模式：清空书签(模拟新设备)"
					>
						{/* 清空图标 */}
						<span className="font-bold text-orange-500 text-xs">🧹</span>
					</div>
				</div>
			)}

			{/* 右键菜单 */}
			{contextMenuVisible && (
				<div
					className="fixed z-50 min-w-32 rounded-md border border-color-2 bg-color-1 py-1 shadow-lg"
					style={{
						left: `${contextMenuPosition.x}px`,
						top: `${contextMenuPosition.y}px`,
					}}
					onClick={(e) => e.stopPropagation()}
				>
					<div
						className="cursor-pointer px-3 py-2 text-color-1 text-sm hover:bg-color-2"
						onClick={handleEditGroup}
					>
						编辑
					</div>
					<div
						className="cursor-pointer px-3 py-2 text-red-500 text-sm hover:bg-color-2"
						onClick={handleDeleteGroup}
					>
						删除
					</div>
				</div>
			)}

			{/* 编辑模态框 */}
			<Modal
				title="编辑书签"
				open={editModalVisible}
				onOk={handleSaveEdit}
				onCancel={() => setEditModalVisible(false)}
				okText="保存"
				cancelText="取消"
			>
				<div className="space-y-4">
					<div>
						<label
							htmlFor="bookmark-name"
							className="mb-1 block font-medium text-color-1 text-sm"
						>
							书签名称
						</label>
						<Input
							id="bookmark-name"
							value={editGroupName}
							onChange={(e) => setEditGroupName(e.target.value)}
							placeholder="请输入书签名称"
							maxLength={10}
						/>
					</div>
					<div>
						<span className="mb-2 block font-medium text-color-1 text-sm">
							选择颜色
						</span>
						<div className="grid grid-cols-6 gap-2">
							{colorOptions.map((color) => (
								<button
									type="button"
									key={color.value}
									className={clsx(
										"h-8 w-8 rounded-md border-2 transition-all",
										color.display,
										editGroupColor === color.value
											? "scale-110 border-primary"
											: "border-transparent hover:border-color-2",
									)}
									onClick={() => setEditGroupColor(color.value)}
									title={color.label}
								/>
							))}
						</div>
					</div>
				</div>
			</Modal>
		</div>
	);
};

export default SidebarGroup;
