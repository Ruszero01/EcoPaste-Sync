import type { AudioRef } from "@/components/Audio";
import Audio from "@/components/Audio";
import { insertWithDeduplication, updateSQL } from "@/database";
import type { HistoryTablePayload, TablePayload } from "@/types/database";
import type { Store } from "@/types/store";
import { formatDate } from "@/utils/dayjs";
import { setSyncEventListener } from "@/utils/syncEngine";
import { emit } from "@tauri-apps/api/event";
import { useReactive } from "ahooks";
import type { EventEmitter } from "ahooks/lib/useEventEmitter";
import { find, findIndex, isNil, last, range } from "lodash-es";
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

		// 开启剪贴板监听
		startListen();

		// 监听剪贴板更新
		onClipboardUpdate(async (payload) => {
			if (clipboardStore.audio.copy) {
				audioRef.current?.play();
			}

			const { type, value, group } = payload;

			const createTime = formatDate();

			// 检查是否有重复项 - 更严格的重复检测
			const findItem = find(state.list, { type, value });

			// 检查是否需要去重（重复项）
			const isDuplicate = !!findItem;

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

			// 获取最新的自动排序设置，确保响应状态变化
			const currentAutoSort = clipboardStore.content.autoSort;

			if (isDuplicate && !currentAutoSort) {
				// 自动排序关闭且发现重复项，只更新数据库中的时间戳
				const latestItem = findItem;
				// const updatedItem = { ...latestItem, createTime };

				state.activeId = latestItem.id;

				// 更新数据库中的时间戳
				await updateSQL("history", { id: latestItem.id, createTime });

				// 重复内容已更新时间戳（自动排序关闭）
			} else {
				// 使用数据库层面的去重插入
				try {
					let data: HistoryTablePayload;

					if (isDuplicate) {
						// 如果是重复项且自动排序开启，使用现有ID但更新时间
						data = {
							...payload,
							createTime,
							id: findItem.id, // 使用现有ID
							favorite: findItem.favorite || false, // 保持现有的收藏状态
							note: findItem.note || "", // 保持现有的备注信息
							subtype: findItem.subtype || undefined, // 保持现有的子类型信息
						};
					} else {
						// 新内容，生成新ID
						data = {
							...payload,
							createTime,
							id: nanoid(),
							favorite: false,
						};
					}

					try {
						await insertWithDeduplication("history", data);
					} catch (error) {
						// 如果是约束冲突错误，尝试更新现有记录而不是插入
						if (
							error instanceof Error &&
							error.message.includes("UNIQUE constraint failed")
						) {
							// 检测到ID冲突，尝试更新现有记录
							// 使用更新而不是插入
							await updateSQL("history", {
								id: data.id,
								createTime: data.createTime,
								note: data.note,
								subtype: data.subtype,
								favorite: data.favorite,
							});
						} else {
							throw error; // 重新抛出其他错误
						}
					}

					// 清除缓存，因为数据已更新
					getListCache.current.clear();
					lastQueryParams = "";

					// 根据自动排序设置和内容类型决定如何处理界面列表
					if (
						state.group === group ||
						(isNil(state.group) && !state.favorite)
					) {
						if (isDuplicate && !currentAutoSort) {
							// 重复内容且自动排序关闭：保持原位置，只更新时间戳
							const originalIndex = findIndex(state.list, { id: findItem.id });
							if (originalIndex !== -1) {
								// 直接在原位置更新数据
								state.list[originalIndex] = {
									...state.list[originalIndex],
									createTime,
								};
								state.activeId = findItem.id;
							}
							// 不需要添加新项目，因为只是更新现有项目
						} else {
							// 新内容始终添加到顶部，重复内容在自动排序开启时移动到顶部
							// 对于重复内容，需要先移除原项目再添加到顶部
							if (isDuplicate) {
								const originalIndex = findIndex(state.list, {
									id: findItem.id,
								});
								if (originalIndex !== -1) {
									state.list.splice(originalIndex, 1);
								}
							}
							state.list.unshift(data);
							state.activeId = data.id;
						}
					}

					// 新内容总是触发滚动到顶部，重复内容根据自动排序设置决定
					if (!isDuplicate || currentAutoSort) {
						emit(
							LISTEN_KEY.ACTIVATE_BACK_TOP,
							isDuplicate ? "duplicate-content" : "new-content",
						);
					}
				} catch (_error) {
					// 数据库去重插入失败

					// 如果是重复内容且去重失败，尝试简单的更新操作
					if (isDuplicate) {
						try {
							// 对于重复内容，只更新数据库时间戳，不改变UI位置
							await updateSQL("history", { id: findItem.id, createTime });
						} catch (_updateError) {
							// 更新时间戳也失败
						}
					}
					// 对于新内容，如果去重失败，直接忽略（因为这是很少见的情况）
				}
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
		// 重置过滤条件以显示所有数据
		state.group = undefined;
		state.search = undefined;
		state.favorite = undefined;

		// 清除缓存并重新加载
		getListCache.current.clear();
		lastQueryParams = "";
		getListDebounced(50); // 使用防抖版本，减少频繁调用
	});

	// 监听搜索状态变化，自动刷新列表
	useEffect(() => {
		// 清除缓存并重新加载数据
		getListCache.current.clear();
		lastQueryParams = "";
		getListDebounced(50);
	}, [state.search, state.group, state.favorite]);

	// 监听配置项变化
	useTauriListen<Store>(LISTEN_KEY.STORE_CHANGED, ({ payload }) => {
		deepAssign(globalStore, payload.globalStore);
		deepAssign(clipboardStore, payload.clipboardStore);
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

			// 检查云端数据更新（如果启用了实时同步）
			checkCloudDataOnFocus();
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

			await pasteClipboard(data);

			// 快速粘贴已有条目后，也触发移动到顶部并更新时间
			const itemIndex = findIndex(state.list, { id: data.id });

			if (itemIndex !== -1) {
				const createTime = formatDate();

				// 快速粘贴条目，准备移动到顶部

				// 从原位置移除
				const [targetItem] = state.list.splice(itemIndex, 1);

				// 移动到顶部并更新时间
				state.list.unshift({ ...targetItem, createTime });

				// 自动聚焦到快速粘贴的条目
				state.activeId = data.id;

				// 更新数据库
				await updateSQL("history", { id: data.id, createTime });

				// 触发滚动事件（发送到 List 组件）
				emit(LISTEN_KEY.ACTIVATE_BACK_TOP, "main");

				// 快速粘贴条目已移动到顶部并更新时间
			}
		},
		[state.quickPasteKeys],
	);

	// 打开偏好设置窗口
	useKeyPress(PRESET_SHORTCUT.OPEN_PREFERENCES, () => {
		showWindow("preference");
	});

	// 缓存机制，避免重复查询
	let lastQueryParams = "";
	// const cachedResult: HistoryTablePayload[] = [];
	const getListCache = useRef(new Map<string, HistoryTablePayload[]>());
	const getListDebounceTimer = useRef<NodeJS.Timeout | null>(null);

	// 获取剪切板内容（优化版本，带缓存）
	const getList = async () => {
		const { group, search, favorite } = state;

		// 生成查询参数的字符串标识
		const queryParams = JSON.stringify({ group, search, favorite });

		// 如果查询参数相同，使用缓存结果
		if (
			getListCache.current.has(queryParams) &&
			lastQueryParams === queryParams
		) {
			const cachedData = getListCache.current.get(queryParams)!;
			state.list = cachedData;
			return;
		}

		// 数据库按时间降序排列
		const orderBy = "ORDER BY createTime DESC";

		const rawData = await selectSQL<HistoryTablePayload[]>(
			"history",
			{
				group,
				search,
				favorite,
			},
			orderBy,
		);

		// 去重处理：对于相同 type 和 value 的内容，只保留最新的一个
		const uniqueItems: HistoryTablePayload[] = [];
		const seenKeys = new Set<string>();

		for (const item of rawData) {
			const key = `${item.type}:${item.value}`;

			if (!seenKeys.has(key)) {
				seenKeys.add(key);
				uniqueItems.push(item);
			}
			// 如果是重复项，跳过不添加（因为已经在uniqueItems中有更新的版本）
		}

		// 更新缓存
		getListCache.current.set(queryParams, uniqueItems);
		lastQueryParams = queryParams;
		state.list = uniqueItems;
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

	// 设置同步事件监听器 - 只设置一次
	useMount(() => {
		setSyncEventListener(() => {
			// 同步事件触发时刷新界面
		});
	});

	// 检查云端数据更新（在窗口激活时）
	const checkCloudDataOnFocus = async () => {
		// 只在启用了实时同步时检查云端数据
		try {
			// const { realtimeSync } = await import("@/utils/realtimeSync");
			// 检查远程变化
			// await realtimeSync.checkForRemoteChanges();
		} catch (_error) {
			// 实时同步未启用或其他错误，忽略
		}
	};

	// 监听滚动到顶部事件
	useTauriListen(LISTEN_KEY.ACTIVATE_BACK_TOP, (_event) => {
		// 这个监听器主要用于调试，实际逻辑在 List 组件中处理
	});

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
			<Audio hiddenIcon ref={audioRef} />

			<MainContext.Provider
				value={{
					state,
					getList,
					getListCache,
					getListDebounced,
				}}
			>
				{window.style === "float" ? <Float /> : <Dock />}
			</MainContext.Provider>
		</>
	);
};

export default Main;
