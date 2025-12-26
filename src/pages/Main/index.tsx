import type { AudioRef } from "@/components/Audio";
import Audio from "@/components/Audio";
import { LISTEN_KEY } from "@/constants";
import { backendQueryHistoryWithFilter } from "@/plugins/database";
import { initializeMicaEffect } from "@/plugins/window";
import type { HistoryTablePayload, TablePayload } from "@/types/database";
import type { Store } from "@/types/store";
import { emit, listen } from "@tauri-apps/api/event";
import { useReactive } from "ahooks";
import type { EventEmitter } from "ahooks/lib/useEventEmitter";
import { findIndex, last, range } from "lodash-es";
import { createContext, useCallback, useRef } from "react";
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

	// 监听后端数据库更新事件
	const handleDatabaseUpdated = useCallback(
		async (event: { payload: { duplicate_id: string | null } }) => {
			// 检查是否是应用内部复制操作
			if (clipboardStore.internalCopy.isCopying) {
				return;
			}

			// 播放音效
			if (clipboardStore.audio.copy) {
				audioRef.current?.play();
			}

			// 清除缓存并刷新列表
			getListCache.current.clear();
			lastQueryParams = "";
			await getList();

			// 如果是重复数据，设置聚焦到被重复的项目
			if (event.payload?.duplicate_id) {
				state.activeId = event.payload.duplicate_id;
			}

			// 触发滚动到对应项目
			emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "updated-content");
		},
		[state], // 依赖 state，确保能访问最新的 activeId
	);

	// 使用 useEffect 管理监听器生命周期
	useEffect(() => {
		let unlisten: (() => void) | null = null;

		const initListen = async () => {
			unlisten = await listen<{ duplicate_id: string | null }>(
				"plugin:eco-clipboard://database_updated",
				handleDatabaseUpdated,
			);
		};

		initListen();

		return () => {
			unlisten?.();
		};
	}, [handleDatabaseUpdated]);

	useMount(() => {
		state.$eventBus = $eventBus;

		// 初始化 Windows 11 Mica 材质效果
		initializeMicaEffect();

		// 开启剪贴板监听（后端会自动处理数据插入）
		startListen();
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

			// 快速粘贴已有条目后，只更新时间（由后端决定是否更新 position）
			const itemIndex = findIndex(state.list, { id: data.id });

			if (itemIndex !== -1) {
				const currentTime = Date.now();

				// 只更新时间，不修改本地列表顺序（后端根据 autoSort 设置处理 position）
				state.list[itemIndex] = {
					...state.list[itemIndex],
					time: currentTime,
				};

				// 更新数据库（后端根据 autoSort 设置决定是否更新 position）
				await backendUpdateField(data.id, "time", currentTime.toString());

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

		// 生成查询参数的字符串标识
		const queryParams = JSON.stringify({
			group,
			search,
			favorite,
			linkTab,
			isCode,
			colorTab,
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

		let rawData: HistoryTablePayload[];

		// 如果是链接分组，查询所有链接类型和路径类型的数据，同时考虑书签筛选
		if (linkTab) {
			let whereClause =
				"(subtype = 'url' OR subtype = 'path') AND (deleted IS NULL OR deleted = 0)";

			// 如果有搜索条件（书签分组筛选），添加到查询中
			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
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
			})) as HistoryTablePayload[];
		} else if (colorTab) {
			// 颜色分组查询：查询 type 为 'color' 的数据
			let whereClause = "type = 'color' AND (deleted IS NULL OR deleted = 0)";

			// 如果有搜索条件，添加到查询中
			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
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
			})) as HistoryTablePayload[];
		} else {
			// 特殊处理纯文本和代码分组的查询
			let whereClause = "(deleted IS NULL OR deleted = 0)";

			// 添加基本条件
			if (group) {
				whereClause += " AND [group] = ?";
			}

			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
			}

			if (favorite !== undefined) {
				whereClause += " AND favorite = ?";
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
			})) as HistoryTablePayload[];
		}

		// 数据库层面已经进行了去重处理，这里直接使用原始数据
		// 更新缓存
		getListCache.current.set(queryParams, rawData);
		lastQueryParams = queryParams;
		state.list = rawData;

		// 自动选中第一个项目（最新插入的）
		if (rawData.length > 0) {
			state.activeId = rawData[0].id;
		}
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
