import { LISTEN_KEY } from "@/constants";
import { bookmarkManager } from "@/utils/bookmarkManager";
import { listen } from "@tauri-apps/api/event";
import { useKeyPress } from "ahooks";
import { Input, Modal } from "antd";
import clsx from "clsx";
import { useCallback, useContext, useEffect, useState } from "react";
import { MainContext } from "../..";

interface CustomGroup {
	id: string;
	name: string;
	color: string;
}

interface SidebarGroupProps {
	onHasGroupsChange?: (hasGroups: boolean) => void;
}

const SidebarGroup: React.FC<SidebarGroupProps> = ({ onHasGroupsChange }) => {
	const { state, getListCache, getListDebounced } = useContext(MainContext);
	const [checked, setChecked] = useState<string>();
	const [customGroups, setCustomGroups] = useState<CustomGroup[]>([]);

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

	useKeyPress("tab", (event) => {
		if (customGroups.length === 0) return;

		const currentIndex = checked
			? customGroups.findIndex((group) => group.id === checked)
			: -1;
		const length = customGroups.length;

		let nextIndex = currentIndex;

		if (event.shiftKey) {
			nextIndex = currentIndex <= 0 ? length - 1 : currentIndex - 1;
		} else {
			nextIndex = currentIndex >= length - 1 ? 0 : currentIndex + 1;
		}

		if (nextIndex >= 0 && nextIndex < customGroups.length) {
			handleChange(customGroups[nextIndex]);
		}
	});

	const handleChange = useCallback(
		(group: CustomGroup) => {
			// 如果点击的是已激活的分组，则取消激活
			if (checked === group.id) {
				setChecked(undefined);
				state.search = undefined;
			} else {
				setChecked(group.id);
				// 自定义分组使用搜索逻辑
				state.search = group.name;
				state.group = undefined;
				state.favorite = undefined;
			}

			// 强制触发列表刷新
			if (getListCache?.current) {
				getListCache.current.clear();
			}
			if (getListDebounced) {
				getListDebounced(50);
			}
		},
		[checked, state, getListCache, getListDebounced],
	);

	const handleDeleteCustomGroup = async (id: string) => {
		const success = await bookmarkManager.deleteGroup(id);
		if (success) {
			setCustomGroups(customGroups.filter((group) => group.id !== id));
			if (checked === id) {
				// 如果删除的是当前选中的分组，清除搜索
				state.search = undefined;
				setChecked(undefined);
				if (getListCache?.current) {
					getListCache.current.clear();
				}
				if (getListDebounced) {
					getListDebounced(50);
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

	// 监听创建分组事件
	useEffect(() => {
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
				const customGroup: CustomGroup = {
					id: newGroup.id,
					name: newGroup.name,
					color: newGroup.color,
				};
				setCustomGroups((prev) => [...prev, customGroup]);
				onHasGroupsChange?.(true);

				// 自动激活新创建的书签
				setTimeout(() => {
					handleChange(customGroup);
				}, 0);
			}
		};

		// 监听Tauri事件
		const unlisten = listen<string>(LISTEN_KEY.CREATE_CUSTOM_GROUP, (event) => {
			handleCreateGroup(event.payload);
		});

		// 开发模式测试函数
		const clearBookmarksForTesting = async () => {
			if (import.meta.env.DEV) {
				await bookmarkManager.clearForNewDevice();
				// 刷新UI
				setCustomGroups([]);
				onHasGroupsChange?.(false);
			}
		};

		// 简单的测试函数，可以在控制台调用
		(window as any).createTestGroup = handleCreateGroup;
		(window as any).clearBookmarksForTesting = clearBookmarksForTesting;

		return () => {
			unlisten.then((fn) => fn());
			if ((window as any).createTestGroup) {
				(window as any).createTestGroup = undefined;
			}
			if ((window as any).clearBookmarksForTesting) {
				(window as any).clearBookmarksForTesting = undefined;
			}
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
			<div className="flex-1 overflow-y-auto overflow-x-hidden">
				<div className="flex flex-col items-center gap-0.5 py-1">
					{customGroups.map((group) => {
						const isChecked = checked === group.id;

						return (
							<div
								key={group.id}
								className={clsx(
									"group relative flex h-6 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md transition-all duration-200",
									{
										"bg-primary text-white shadow-md": isChecked,
										"bg-color-1 hover:scale-105 hover:bg-color-1 hover:shadow-sm":
											!isChecked,
									},
								)}
								onClick={() => handleChange(group)}
								onDoubleClick={() => handleDeleteCustomGroup(group.id)}
								onContextMenu={(e) => handleContextMenu(e, group)}
								title={group.name}
							>
								{/* 彩色指示条 */}
								<div
									className="absolute top-1 bottom-1 left-0 w-1 rounded-r"
									style={{ backgroundColor: group.color }}
								/>

								{/* 分组名称缩写 */}
								<span
									className={clsx(
										"truncate font-medium text-xs leading-tight",
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
					})}
				</div>
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
