import { LISTEN_KEY } from "@/constants";
import { backendQueryHistoryWithFilter } from "@/plugins/database";
import { COMMAND, toggleWindow } from "@/plugins/window";
import type { HistoryTablePayload, TablePayload } from "@/types/database";
import type { Store } from "@/types/store";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useReactive } from "ahooks";
import type { EventEmitter } from "ahooks/lib/useEventEmitter";
import { range } from "lodash-es";
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
	const $eventBus = useEventEmitter<string>();
	const windowHideTimer = useRef<NodeJS.Timeout>();

	// 监听后端数据库更新事件
	const handleDatabaseUpdated = useCallback(
		async (event: { payload: { duplicate_id: string | null } }) => {
			// 检查是否是应用内部复制操作
			if (clipboardStore.internalCopy.isCopying) {
				return;
			}

			// 清除缓存并刷新列表
			getListCache.current.clear();
			lastQueryParams = "";

			// 使用 forceRefreshList 确保缓存和防抖都被正确处理
			forceRefreshList();

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
			// 监听剪贴板插件的数据库更新事件（包括同步成功后的刷新）
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

		// TODO: mica 效果在新版 webview 上存在 BUG，暂时禁用
		// initializeMicaEffect();
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
	useImmediateKey(globalStore.app, "showTaskbarIcon", (value) => {
		const isVisible =
			typeof value === "boolean"
				? value
				: ((value as { showTaskbarIcon?: boolean }).showTaskbarIcon ?? true);
		invoke(COMMAND.SHOW_TASKBAR_ICON, { visible: isVisible });
	});

	// 监听刷新列表
	useTauriListen(LISTEN_KEY.REFRESH_CLIPBOARD_LIST, () => {
		// 清除缓存并重新加载（保持当前过滤条件）
		getListCache.current.clear();
		lastQueryParams = ""; // 重置查询参数以强制刷新
		getListDebounced(50);
	});

	useTauriListen("plugin:eco-paste://paste_plain", async () => {
		if (!state.activeId) {
			return;
		}

		const data = state.list.find((item) => item.id === state.activeId);
		if (!data) {
			return;
		}

		const { smartPasteClipboard } = await import("@/plugins/clipboard");
		smartPasteClipboard(data, true);
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
		state.linkTab,
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

			// 只有窗口可见时才设置自动隐藏计时器
			const appWindow = getCurrentWebviewWindow();
			void appWindow.isVisible().then((isVisible) => {
				if (!isVisible) return;

				windowHideTimer.current = setTimeout(() => {
					toggleWindow("main", undefined);
					windowHideTimer.current = undefined;
				}, 300);
			});
		},
	});

	// 监听粘贴为纯文本的快捷键
	useKeyPress(shortcut.pastePlain, (event) => {
		event.preventDefault();

		// const data = find(state.list, { id: state.activeId });
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

		// 如果是链接分组，查询所有链接类型、路径和邮箱类型的数据，同时考虑书签筛选
		if (linkTab) {
			let whereClause =
				"(subtype = 'url' OR subtype = 'path' OR subtype = 'email') AND (deleted IS NULL OR deleted = 0)";
			const params: string[] = [];

			// 如果有搜索条件（书签分组筛选），添加到查询中
			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
				params.push(`%${search}%`, `%${search}%`);
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
				params,
			});

			// 转换数据类型，与 selectSQL 保持一致
			rawData = (Array.isArray(list) ? list : []).map((item: any) => ({
				...item,
				favorite: Boolean(item.favorite),
				deleted: Boolean(item.deleted),
				position: Number(item.position || 0),
				syncStatus: item.syncStatus || "none",
			})) as HistoryTablePayload[];
		} else if (colorTab) {
			// 颜色分组查询：查询 type 为 'text' 且 subtype 为 'color' 的数据
			let whereClause =
				"type = 'text' AND subtype = 'color' AND (deleted IS NULL OR deleted = 0)";
			const params: string[] = [];

			// 如果有搜索条件，添加到查询中
			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
				params.push(`%${search}%`, `%${search}%`);
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
				params,
			});

			// 转换数据类型，与 selectSQL 保持一致
			rawData = (Array.isArray(list) ? list : []).map((item: any) => ({
				...item,
				favorite: Boolean(item.favorite),
				deleted: Boolean(item.deleted),
				position: Number(item.position || 0),
				syncStatus: item.syncStatus || "none",
			})) as HistoryTablePayload[];
		} else {
			// 特殊处理纯文本和代码分组的查询
			let whereClause = "(deleted IS NULL OR deleted = 0)";
			const params: string[] = [];

			// 添加基本条件
			if (group) {
				whereClause += " AND [group] = ?";
				params.push(group);
			}

			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
				// LIKE 需要 % 包裹
				params.push(`%${search}%`, `%${search}%`);
			}

			if (favorite !== undefined) {
				whereClause += " AND favorite = ?";
				params.push(favorite ? "1" : "0");
			}

			// 如果是代码分组，添加 type = 'code' 条件
			if (isCode) {
				whereClause += " AND type = 'code'";
			}
			// 如果是纯文本分组，只显示纯文本（无子类型）和格式文本
			else if (group === "text") {
				whereClause +=
					" AND ((type = 'text' AND (subtype IS NULL OR subtype = '')) OR type = 'formatted')";
			}

			const list = await backendQueryHistoryWithFilter({
				where_clause: whereClause,
				params,
			});

			// 转换数据类型，与 selectSQL 保持一致
			rawData = (Array.isArray(list) ? list : []).map((item: any) => ({
				...item,
				favorite: Boolean(item.favorite),
				deleted: Boolean(item.deleted),
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
	);
};

export default Main;
