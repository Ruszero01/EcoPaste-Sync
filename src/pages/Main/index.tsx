import type { AudioRef } from "@/components/Audio";
import Audio from "@/components/Audio";
import { LISTEN_KEY } from "@/constants";
import {
	backendInsertWithDeduplication,
	backendQueryHistoryWithFilter,
} from "@/plugins/database";
import { initializeMicaEffect } from "@/plugins/window";
import type { HistoryTablePayload, TablePayload } from "@/types/database";
import type { Store } from "@/types/store";
import { formatDate } from "@/utils/dayjs";
import { emit } from "@tauri-apps/api/event";
import { useReactive } from "ahooks";
import type { EventEmitter } from "ahooks/lib/useEventEmitter";
import { findIndex, last, range } from "lodash-es";
import { nanoid } from "nanoid";
import { createContext } from "react";
import { useSnapshot } from "valtio";
import Dock from "./components/Dock";
import Float from "./components/Float";

interface State extends TablePayload {
	pin?: boolean;
	list: HistoryTablePayload[];
	activeId?: string;
	eventBusId?: string;
	$eventBus?: EventEmitter<string>;
	quickPasteKeys: string[];
	lastProcessedTime?: number;
	lastProcessedPayload?: {
		type?: string;
		value?: string;
		group?: string;
	};
	linkTab?: boolean; // 新增：链接分组状态
	isCode?: boolean; // 新增：代码分组状态
	colorTab?: boolean; // 新增：颜色分组状态
	batchDeleteInProgress?: boolean; // 新增：批量删除进行中标志
}

const INITIAL_STATE: State = {
	list: [],
	quickPasteKeys: [],
};

interface MainContextValue {
	state: State;
	getList?: (payload?: HistoryTablePayload) => Promise<void>;
	getListCache?: React.MutableRefObject<Map<string, HistoryTablePayload[]>>;
	getListDebounced?: (delay?: number) => Promise<void>;
	forceRefreshList?: () => void;
}

export const MainContext = createContext<MainContextValue>({
	state: INITIAL_STATE,
});

const Main = () => {
	const { shortcut } = useSnapshot(globalStore);
	const { window } = useSnapshot(clipboardStore);

	const state = useReactive<State>(INITIAL_STATE);
	const audioRef = useRef<AudioRef>(null);
	const $eventBus = useEventEmitter<string>();
	const windowHideTimer = useRef<NodeJS.Timeout>();

	useMount(() => {
		state.$eventBus = $eventBus;

		// 初始化 Windows 11 Mica 材质效果
		initializeMicaEffect();

		// 开启剪贴板监听
		startListen();

		// 监听剪贴板更新
		onClipboardUpdate(async (payload) => {
			const { type, value, group } = payload;

			// 检查是否是应用内部复制操作
			const isInternalCopy = clipboardStore.internalCopy.isCopying;

			// 如果是内部复制操作，跳过处理
			if (isInternalCopy) {
				return;
			}

			if (clipboardStore.audio.copy) {
				audioRef.current?.play();
			}

			const createTime = formatDate();

			// 额外检查：防止短时间内处理相同内容
			const now = Date.now();
			if (state.lastProcessedTime && now - state.lastProcessedTime < 100) {
				const lastProcessed = state.lastProcessedPayload;
				if (
					lastProcessed &&
					lastProcessed.type === type &&
					lastProcessed.value === value
				) {
					return; // 跳过重复处理
				}
			}

			// 更新处理时间和内容
			state.lastProcessedTime = now;
			state.lastProcessedPayload = { type, value, group };

			// 数据库层面已经处理了去重，直接插入新数据
			try {
				const data: HistoryTablePayload = {
					...payload,
					createTime,
					id: nanoid(),
					favorite: false,
					syncStatus: "not_synced", // 新项目默认为未同步状态
				};

				// 调用后端数据库插件插入数据
				// 注意：后端期待的是 i32 类型，需要转换布尔值为 0/1
				const result = await backendInsertWithDeduplication({
					...data,
					time: Date.now(), // Rust端需要time字段为毫秒时间戳
					favorite: data.favorite ? 1 : 0,
					deleted: data.deleted ? 1 : 0,
					isCode: data.isCode ? 1 : 0,
				});

				// 清除缓存，因为数据已更新
				getListCache.current.clear();
				lastQueryParams = "";

				// 获取当前的自动排序设置
				const currentAutoSort = clipboardStore.content.autoSort;

				// 如果是插入新记录（不是更新现有记录）
				if (!result.is_update) {
					if (currentAutoSort) {
						// 自动排序模式下：刷新列表，新记录会自动排在顶部
						await getList();
						// 设置活动ID为新添加的记录
						state.activeId = data.id;
						// 触发滚动到顶部
						emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "new-content");
					} else {
						// 手动排序模式下：直接在顶部插入新记录，不刷新整个列表
						state.list.unshift({ ...data, id: data.id });
						// 设置活动ID为新添加的记录
						state.activeId = data.id;
						// 触发滚动到顶部
						emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "new-content");
					}
				} else {
					// 如果是更新现有记录
					const updatedItemId = result.insert_id;

					if (currentAutoSort) {
						// 自动排序模式下：刷新列表，更新的记录会根据时间重新排序
						await getList();
						if (updatedItemId) {
							// 设置活动ID为更新的记录
							state.activeId = updatedItemId;
						}
						// 触发滚动到顶部，显示更新的记录
						emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "updated-content");
					} else {
						// 手动排序模式下：只更新记录信息，保持原位置
						if (updatedItemId) {
							// 找到要更新的记录在列表中的位置
							const itemIndex = state.list.findIndex(
								(item) => item.id === updatedItemId,
							);
							if (itemIndex !== -1) {
								// 更新该记录的信息，但保持位置不变
								// 使用现有的记录作为基础，只更新需要更新的字段
								const existingItem = state.list[itemIndex];

								// 保留原始来源应用信息，不被新数据覆盖
								const { sourceAppName, sourceAppIcon, ...dataWithoutSource } =
									data;

								state.list[itemIndex] = {
									...existingItem,
									...dataWithoutSource,
									id: updatedItemId, // 确保使用数据库中的ID
									createTime: data.createTime,
									// 明确保留原始来源应用信息
									sourceAppName: existingItem.sourceAppName,
									sourceAppIcon: existingItem.sourceAppIcon,
								};
								// 设置活动ID为更新的记录
								state.activeId = updatedItemId;
								// 触发滚动到对应条目位置
								emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "updated-content");
							}
						}
					}
				}
			} catch (error) {
				console.error("处理剪贴板数据失败:", error);
			}
		});
	});

	// 监听快速粘贴的启用状态变更
	useImmediateKey(globalStore.shortcut.quickPaste, "enable", () => {
		setQuickPasteKeys();
	});

	// 监听快速粘贴的快捷键变更
	useSubscribeKey(globalStore.shortcut.quickPaste, "value", () => {
		setQuickPasteKeys();
	});

	// 监听是否显示任务栏图标
	useImmediateKey(globalStore.app, "showTaskbarIcon", showTaskbarIcon);

	// 监听刷新列表
	useTauriListen(LISTEN_KEY.REFRESH_CLIPBOARD_LIST, () => {
		// 清除缓存并重新加载（保持当前过滤条件）
		getListCache.current.clear();
		lastQueryParams = ""; // 重置查询参数以强制刷新
		getListDebounced(50);
	});

	// 监听搜索状态变化，自动刷新列表
	useEffect(() => {
		const currentAutoSort = clipboardStore.content.autoSort;

		// 如果启用自动排序或搜索状态改变，清除缓存
		if (currentAutoSort || state.search !== undefined) {
			getListCache.current.clear();
			lastQueryParams = "";
		} else {
			// 手动排序模式：只在group/favorite改变时保留当前顺序，不完全清除缓存
			// 但仍需要重新加载数据，只是保持手动排序逻辑
			getListCache.current.clear();
			lastQueryParams = "";
		}

		getListDebounced(50);
	}, [
		state.search,
		state.group,
		state.favorite,
		state.isCode,
		state.colorTab,
		clipboardStore.content.autoSort,
	]);

	// 监听配置项变化
	useTauriListen<Store>(LISTEN_KEY.STORE_CHANGED, ({ payload }) => {
		deepAssign(globalStore, payload.globalStore);
		deepAssign(clipboardStore, payload.clipboardStore);

		// 如果代码检测设置发生变化，清除缓存并刷新列表
		if (payload.clipboardStore?.content?.codeDetection !== undefined) {
			getListCache.current.clear();
			lastQueryParams = "";
			getListDebounced(50);
		}

		// 如果颜色识别设置发生变化，清除缓存并刷新列表
		if (payload.clipboardStore?.content?.colorDetection !== undefined) {
			getListCache.current.clear();
			lastQueryParams = "";
			getListDebounced(50);
		}
	});

	// 切换剪贴板监听状态
	useTauriListen<boolean>(LISTEN_KEY.TOGGLE_LISTEN_CLIPBOARD, ({ payload }) => {
		toggleListen(payload);
	});

	// 监听窗口焦点
	useTauriFocus({
		onFocus() {
			// 重置隐藏计时器
			if (windowHideTimer.current) {
				clearTimeout(windowHideTimer.current);
				windowHideTimer.current = undefined;
			}
		},
		onBlur() {
			if (state.pin) return;

			// 固定延迟后隐藏窗口
			const delay = 300;

			windowHideTimer.current = setTimeout(() => {
				hideWindow();
				windowHideTimer.current = undefined;
			}, delay);
		},
	});

	// 监听窗口显隐的快捷键
	useRegister(() => {
		toggleWindowVisible();
	}, [shortcut.clipboard]);

	// 监听粘贴为纯文本的快捷键
	useKeyPress(shortcut.pastePlain, (event) => {
		event.preventDefault();

		// const data = find(state.list, { id: state.activeId });
	});

	// 监听快速粘贴的快捷键
	useRegister(
		async (event) => {
			if (!globalStore.shortcut.quickPaste.enable) return;

			const index = Number(last(event.shortcut));

			const data = state.list[index - 1];

			if (!data) return;

			// 设置内部复制标志，防止快速粘贴操作后触发重复处理
			clipboardStore.internalCopy = {
				isCopying: true,
				itemId: data.id,
			};

			try {
				await pasteClipboard(data);
			} finally {
				// 清除内部复制标志
				clipboardStore.internalCopy = {
					isCopying: false,
					itemId: null,
				};
			}

			// 快速粘贴已有条目后，也触发移动到顶部并更新时间
			const itemIndex = findIndex(state.list, { id: data.id });

			if (itemIndex !== -1) {
				const currentTime = Date.now();

				// 获取当前的自动排序设置
				const currentAutoSort = clipboardStore.content.autoSort;

				if (currentAutoSort) {
					// 自动排序模式：更新时间，让系统重新排序
					await backendUpdateField(data.id, "time", currentTime.toString());
					// 刷新列表以获取新的排序
					await getList();
				} else {
					// 手动排序模式：只更新时间，不改变位置
					await backendUpdateField(data.id, "time", currentTime.toString());
					// 更新本地列表中的时间，但保持位置不变
					state.list[itemIndex] = {
						...state.list[itemIndex],
						time: currentTime,
					};
				}

				// 自动聚焦到快速粘贴的条目
				state.activeId = data.id;

				// 触发滚动事件（发送到 List 组件）
				emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "main");
			}
		},
		[state.quickPasteKeys],
	);

	// 打开偏好设置窗口
	useKeyPress(PRESET_SHORTCUT.OPEN_PREFERENCES, () => {
		showWindow("preference");
	});

	// Ctrl+A 全选功能
	useKeyPress(["ctrl.a", "meta.a"], (event) => {
		// 阻止默认行为（避免浏览器全选）
		event.preventDefault();

		// 检查是否有剪贴板条目
		if (state.list.length === 0) return;

		// 检查是否已经是全选状态
		const isAllSelected =
			clipboardStore.multiSelect.isMultiSelecting &&
			clipboardStore.multiSelect.selectedIds.size === state.list.length;

		if (isAllSelected) {
			// 如果已经全选，则取消全选
			clipboardStore.multiSelect.isMultiSelecting = false;
			// 重新分配一个新的 Set 来确保响应式更新
			clipboardStore.multiSelect.selectedIds = new Set();
			clipboardStore.multiSelect.lastSelectedId = null;
			clipboardStore.multiSelect.shiftSelectDirection = null;
			clipboardStore.multiSelect.selectedOrder = [];

			// 保持当前聚焦项不变
		} else {
			// 进入多选模式
			clipboardStore.multiSelect.isMultiSelecting = true;
			// 重新分配一个新的 Set 来确保响应式更新
			clipboardStore.multiSelect.selectedIds = new Set();

			// 选择所有条目
			for (const item of state.list) {
				clipboardStore.multiSelect.selectedIds.add(item.id);
			}

			// 设置最后一个选中的ID
			clipboardStore.multiSelect.lastSelectedId =
				state.list[state.list.length - 1]?.id || null;

			// 聚焦到第一个条目
			if (state.list.length > 0) {
				state.activeId = state.list[0].id;
			}
		}
	});

	// 缓存机制，避免重复查询
	let lastQueryParams = "";
	// const cachedResult: HistoryTablePayload[] = [];
	const getListCache = useRef(new Map<string, HistoryTablePayload[]>());
	const getListDebounceTimer = useRef<NodeJS.Timeout | null>(null);

	// 强制刷新列表的函数（仅更新列表，不触发其他事件）
	const forceRefreshList = () => {
		// 彻底清除所有缓存，确保删除操作能立即反映
		getListCache.current.clear();
		lastQueryParams = "";
		// 清除防抖计时器，确保立即刷新
		if (getListDebounceTimer.current) {
			clearTimeout(getListDebounceTimer.current);
			getListDebounceTimer.current = null;
		}
		// 直接调用getList而不是使用防抖，避免延迟
		getList();
	};

	// 获取剪切板内容（优化版本，带缓存）
	const getList = async () => {
		const { group, search, favorite, linkTab, isCode, colorTab } = state;

		// 获取当前的自动排序设置
		const currentAutoSort = clipboardStore.content.autoSort;

		// 生成查询参数的字符串标识（包含自动排序状态）
		const queryParams = JSON.stringify({
			group,
			search,
			favorite,
			linkTab,
			isCode,
			colorTab,
			autoSort: currentAutoSort,
		});

		// 如果查询参数相同，使用缓存结果
		if (
			getListCache.current.has(queryParams) &&
			lastQueryParams === queryParams
		) {
			const cachedData = getListCache.current.get(queryParams)!;
			state.list = cachedData;
			return;
		}

		// 根据自动排序设置决定排序方式
		// 自动排序：按时间排序；手动排序：按位置倒序（新的在上面）
		const orderBy = currentAutoSort
			? "ORDER BY time DESC"
			: "ORDER BY position DESC, time DESC";

		let rawData: HistoryTablePayload[];

		// 如果是链接分组，查询所有链接类型和路径类型的数据，同时考虑书签筛选
		if (linkTab) {
			let whereClause =
				"(subtype = 'url' OR subtype = 'path') AND (deleted IS NULL OR deleted = 0)";
			const searchParams: any = {};

			// 如果有搜索条件（书签分组筛选），添加到查询中
			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
				searchParams.search = `%${search}%`;
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
				order_by: orderBy,
				limit: undefined,
				offset: undefined,
			});

			// 转换数据类型，与 selectSQL 保持一致
			rawData = (Array.isArray(list) ? list : []).map((item: any) => ({
				...item,
				favorite: Boolean(item.favorite),
				deleted: Boolean(item.deleted),
				isCode: Boolean(item.isCode),
				position: Number(item.position || 0),
				syncStatus: item.syncStatus || "none",
				createTime: item.time, // 统一使用createTime字段
			})) as HistoryTablePayload[];
		} else if (colorTab) {
			// 颜色分组查询：查询 type 为 'color' 的数据
			let whereClause = "type = 'color' AND (deleted IS NULL OR deleted = 0)";
			const searchParams: any = {};

			// 如果有搜索条件，添加到查询中
			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
				searchParams.search = `%${search}%`;
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
				order_by: orderBy,
				limit: undefined,
				offset: undefined,
			});

			// 转换数据类型，与 selectSQL 保持一致
			rawData = (Array.isArray(list) ? list : []).map((item: any) => ({
				...item,
				favorite: Boolean(item.favorite),
				deleted: Boolean(item.deleted),
				isCode: Boolean(item.isCode),
				position: Number(item.position || 0),
				syncStatus: item.syncStatus || "none",
				createTime: item.time, // 统一使用createTime字段
			})) as HistoryTablePayload[];
		} else {
			// 特殊处理纯文本和代码分组的查询
			let whereClause = "(deleted IS NULL OR deleted = 0)";
			const searchParams: any = {};

			// 添加基本条件
			if (group) {
				whereClause += " AND [group] = ?";
				searchParams.group = group;
			}

			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
				searchParams.search = `%${search}%`;
			}

			if (favorite !== undefined) {
				whereClause += " AND favorite = ?";
				searchParams.favorite = favorite ? 1 : 0;
			}

			// 如果是代码分组，添加 isCode = true 条件
			if (isCode) {
				whereClause += " AND isCode = 1";
			}
			// 如果是纯文本分组且不是"全部"，添加 isCode = false 条件，同时排除颜色类型
			else if (group === "text") {
				whereClause +=
					" AND (isCode = 0 OR isCode IS NULL) AND type != 'color'";
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
				order_by: orderBy,
				limit: undefined,
				offset: undefined,
			});

			// 转换数据类型，与 selectSQL 保持一致
			rawData = (Array.isArray(list) ? list : []).map((item: any) => ({
				...item,
				favorite: Boolean(item.favorite),
				deleted: Boolean(item.deleted),
				isCode: Boolean(item.isCode),
				position: Number(item.position || 0),
				syncStatus: item.syncStatus || "none",
				createTime: item.time, // 统一使用createTime字段
			})) as HistoryTablePayload[];
		}

		// 数据库层面已经进行了去重处理，这里直接使用原始数据
		// 更新缓存
		getListCache.current.set(queryParams, rawData);
		lastQueryParams = queryParams;
		state.list = rawData;
	};

	// 防抖版本的getList，避免频繁调用
	const getListDebounced = async (delay = 100) => {
		if (getListDebounceTimer.current) {
			clearTimeout(getListDebounceTimer.current);
		}

		getListDebounceTimer.current = setTimeout(() => {
			getList();
		}, delay);
	};

	// 监听滚动到顶部事件
	useTauriListen(LISTEN_KEY.ACTIVATE_BACK_TOP, (_event) => {
		// 这个监听器主要用于调试，实际逻辑在 List 组件中处理
	});

	// 全局点击事件，用于清除多选状态
	useEffect(() => {
		const handleGlobalClick = (event: MouseEvent) => {
			// 如果正在多选状态，且点击的不是剪贴板条目，则清除多选
			if (clipboardStore.multiSelect.isMultiSelecting) {
				const target = event.target as Element;

				// 检查点击的目标是否在剪贴板条目内
				const isClickInsideItem = target.closest("[data-item-id]");

				if (!isClickInsideItem) {
					clipboardStore.multiSelect.isMultiSelecting = false;
					clipboardStore.multiSelect.selectedIds.clear();
					clipboardStore.multiSelect.lastSelectedId = null;
				}
			}
		};

		// 添加全局点击监听器
		document.addEventListener("click", handleGlobalClick);

		// 清理函数
		return () => {
			document.removeEventListener("click", handleGlobalClick);
		};
	}, [clipboardStore.multiSelect.isMultiSelecting]);

	// 清理计时器
	useUnmount(() => {
		if (windowHideTimer.current) {
			clearTimeout(windowHideTimer.current);
			windowHideTimer.current = undefined;
		}

		if (getListDebounceTimer.current) {
			clearTimeout(getListDebounceTimer.current);
			getListDebounceTimer.current = null;
		}
	});

	// 设置快捷粘贴的快捷键
	const setQuickPasteKeys = () => {
		const { enable, value } = globalStore.shortcut.quickPaste;

		if (!enable) {
			state.quickPasteKeys = [];

			return;
		}

		state.quickPasteKeys = range(1, 10).map((item) => [value, item].join("+"));
	};

	return (
		<>
			<Audio ref={audioRef} />

			<MainContext.Provider
				value={{
					state,
					getList,
					getListCache,
					getListDebounced,
					forceRefreshList,
				}}
			>
				{window.style === "float" ? <Float /> : <Dock />}
			</MainContext.Provider>
		</>
	);
};

export default Main;
