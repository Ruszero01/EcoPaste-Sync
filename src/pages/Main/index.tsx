import type { AudioRef } from "@/components/Audio";
import Audio from "@/components/Audio";
import { LISTEN_KEY } from "@/constants";
import {
	batchUpdateSyncStatus,
	executeSQL,
	insertWithDeduplication,
	updateSQL,
} from "@/database";
import { initializeMicaEffect } from "@/plugins/window";
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
	linkTab?: boolean; // 新增：链接分组状态
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

		// 设置同步事件监听器 - 确保在应用启动早期设置
		setSyncEventListener(() => {
			// 同步事件触发时刷新界面
			// 使用项目标准的刷新事件
			try {
				emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
			} catch {
				// 备用方案：直接调用列表刷新
				getListCache.current.clear();
				getListDebounced(50);
			}
		});

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

			// 对于图片和文件类型，进行跨类型和同类型去重检测
			let crossTypeDuplicateItem: HistoryTablePayload | undefined;
			if (type === "image" || type === "files") {
				// 检查是否存在相同文件路径的记录（包括不同类型和相同类型）
				crossTypeDuplicateItem = state.list.find((item) => {
					if (item.type === "image" || item.type === "files") {
						let itemFilePath = item.value;
						let currentFilePath = value;

						// 辅助函数：从值中提取第一个文件路径
						const extractFirstPath = (val: any) => {
							if (!val || typeof val !== "string") return val;

							try {
								const parsed = JSON.parse(val);

								// 如果是字符串数组，返回第一个
								if (
									Array.isArray(parsed) &&
									parsed.length > 0 &&
									typeof parsed[0] === "string"
								) {
									return parsed[0];
								}

								// 如果是对象数组，提取第一个对象的路径
								if (
									Array.isArray(parsed) &&
									parsed.length > 0 &&
									typeof parsed[0] === "object"
								) {
									const firstItem = parsed[0];
									return (
										firstItem.originalPath ||
										firstItem.path ||
										firstItem.fileName ||
										val
									);
								}
							} catch {
								// 解析失败，返回原值
							}

							return val;
						};

						// 提取文件路径
						itemFilePath = extractFirstPath(item.value);
						currentFilePath = extractFirstPath(value);

						// 确保是字符串
						if (
							typeof itemFilePath !== "string" ||
							typeof currentFilePath !== "string"
						) {
							return false;
						}

						// 标准化路径格式进行比较（处理大小写和路径分隔符差异）
						const normalizedItemPath = itemFilePath
							.toLowerCase()
							.replace(/\\/g, "/");
						const normalizedCurrentPath = currentFilePath
							.toLowerCase()
							.replace(/\\/g, "/");

						return normalizedItemPath === normalizedCurrentPath;
					}
					return false;
				});
			}

			// 检查是否需要去重（重复项）
			const isDuplicate = !!findItem || !!crossTypeDuplicateItem;
			const existingDuplicateItem = findItem || crossTypeDuplicateItem;

			// 检查是否是应用内部复制操作触发的剪切板更新
			const isInternalCopy = clipboardStore.internalCopy.isCopying;
			const internalCopyItemId = clipboardStore.internalCopy.itemId;

			// 如果是内部复制操作且是重复项目，跳过处理（避免重复移动到顶部）
			if (
				isInternalCopy &&
				isDuplicate &&
				existingDuplicateItem?.id === internalCopyItemId
			) {
				return; // 跳过内部复制操作触发的重复处理
			}

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
				// 自动排序关闭且发现重复项，不更新时间戳，只激活
				const latestItem = existingDuplicateItem;

				if (latestItem) {
					state.activeId = latestItem.id;
				}

				// 手动排序模式下不更新数据库时间戳，保持原有位置
			} else {
				// 使用数据库层面的去重插入
				try {
					let data: HistoryTablePayload;

					if (isDuplicate) {
						// 如果是重复项且自动排序开启，使用现有ID但更新时间
						data = {
							...payload,
							createTime,
							id: existingDuplicateItem!.id, // 使用现有ID
							favorite: existingDuplicateItem!.favorite || false, // 保持现有的收藏状态
							note: existingDuplicateItem!.note || "", // 保持现有的备注信息
							subtype: existingDuplicateItem!.subtype || undefined, // 保持现有的子类型信息
							syncStatus: existingDuplicateItem!.syncStatus, // 保持原有的同步状态
							isCloudData: existingDuplicateItem!.isCloudData, // 保持原有的云端数据标记
						};
					} else {
						// 新内容，生成新ID
						data = {
							...payload,
							createTime,
							id: nanoid(),
							favorite: false,
							syncStatus: "none", // 新项目默认为未同步状态
							isCloudData: false, // 标记为本地数据
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
							// 使用更新而不是插入，保持原有的同步状态
							await updateSQL("history", {
								id: data.id,
								createTime: data.createTime,
								note: data.note,
								subtype: data.subtype,
								favorite: data.favorite,
								syncStatus: data.syncStatus, // 保持原有的同步状态
								isCloudData: data.isCloudData, // 保持原有的云端数据标记
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
							const originalIndex = findIndex(state.list, {
								id: existingDuplicateItem!.id,
							});
							if (originalIndex !== -1) {
								// 直接在原位置更新数据
								state.list[originalIndex] = {
									...state.list[originalIndex],
									createTime,
								};
								state.activeId = existingDuplicateItem!.id;
							}
							// 不需要添加新项目，因为只是更新现有项目
						} else {
							// 新内容始终添加到顶部，重复内容在自动排序开启时移动到顶部
							// 对于重复内容，需要先移除原项目再添加到顶部
							if (isDuplicate) {
								const originalIndex = findIndex(state.list, {
									id: existingDuplicateItem!.id,
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
					if (isDuplicate && existingDuplicateItem) {
						try {
							// 对于重复内容，只更新数据库时间戳，不改变UI位置
							await updateSQL("history", {
								id: existingDuplicateItem.id,
								createTime,
							});
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
		clipboardStore.content.autoSort,
	]);

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

	// 强制刷新列表的函数（仅更新列表，不触发其他事件）
	const forceRefreshList = () => {
		getListCache.current.clear();
		lastQueryParams = "";
		// 直接调用getList而不是使用防抖，避免延迟
		getList();
	};

	// 获取剪切板内容（优化版本，带缓存）
	const getList = async () => {
		const { group, search, favorite, linkTab } = state;

		// 获取当前的自动排序设置
		const currentAutoSort = clipboardStore.content.autoSort;

		// 生成查询参数的字符串标识（包含自动排序状态）
		const queryParams = JSON.stringify({
			group,
			search,
			favorite,
			linkTab,
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
		// 手动排序时也保持最新在前，只是不重新排列现有条目
		const orderBy = "ORDER BY createTime DESC";

		let rawData: HistoryTablePayload[];

		// 如果是链接分组，查询所有链接类型和路径类型的数据，同时考虑书签筛选
		if (linkTab) {
			let whereClause =
				"WHERE (subtype = 'url' OR subtype = 'path') AND deleted = 0";
			const values: any[] = [];

			// 如果有搜索条件（书签分组筛选），添加到查询中
			if (search) {
				whereClause += " AND (search LIKE ? OR note LIKE ?)";
				const searchValue = `%${search}%`;
				values.push(searchValue, searchValue);
			}

			const list = await executeSQL(
				`SELECT * FROM history ${whereClause} ${orderBy};`,
				values,
			);
			// 转换数据类型，与 selectSQL 保持一致
			rawData = (Array.isArray(list) ? list : []).map((item: any) => {
				const favorite = Boolean(item.favorite);
				const deleted = Boolean(item.deleted);
				const lazyDownload = Boolean(item.lazyDownload);
				const isCloudData = Boolean(item.isCloudData);

				// 改进的同步状态验证逻辑
				let syncStatus: "none" | "synced" | "syncing" = "none";

				if (item.syncStatus) {
					const status = String(item.syncStatus).toLowerCase();
					if (["none", "synced", "syncing"].includes(status)) {
						syncStatus = status as "none" | "synced" | "syncing";
					}
				}

				// 状态一致性检查：如果是云端数据但状态不是已同步，则自动修正
				if (isCloudData && syncStatus !== "synced") {
					console.warn("检测到云端数据状态异常，自动修正为已同步:", item.id);
					syncStatus = "synced";

					// 异步更新数据库状态
					batchUpdateSyncStatus([item.id], "synced", true).catch((error) => {
						console.error("自动修正状态失败:", error);
					});
				}
				// 如果标记为已同步但不是云端数据，则重置为未同步
				else if (!isCloudData && syncStatus === "synced") {
					console.warn("检测到错误的同步状态，重置为未同步:", item.id);
					syncStatus = "none";

					// 异步更新数据库状态
					batchUpdateSyncStatus([item.id], "none", false).catch((error) => {
						console.error("重置状态失败:", error);
					});
				}

				return {
					...item,
					favorite,
					deleted,
					lazyDownload,
					isCloudData,
					syncStatus,
				};
			}) as HistoryTablePayload[];
		} else {
			rawData = await selectSQL<HistoryTablePayload[]>(
				"history",
				{
					group,
					search,
					favorite,
					deleted: false, // 过滤已删除项
				},
				orderBy,
			);
		}

		// 智能去重处理：对于文件和图片类型，基于文件路径去重；其他类型基于 type:value
		const uniqueItems: HistoryTablePayload[] = [];
		const seenKeys = new Set<string>();

		for (const item of rawData) {
			let key: string;

			// 对于文件和图片类型，基于文件路径去重（忽略类型差异）
			if (item.type === "files" || item.type === "image") {
				// 尝试从JSON中提取文件路径
				if (item.type === "files" && item.value?.startsWith("[")) {
					try {
						const filePaths = JSON.parse(item.value);
						// 使用第一个文件路径作为key，确保所有相同路径的文件使用相同的key
						key = `file:${filePaths[0]}`;
					} catch {
						key = `file:${item.value}`;
					}
				} else {
					key = `file:${item.value}`;
				}
			} else {
				// 其他类型使用原有的 type:value 组合
				key = `${item.type}:${item.value}`;
			}

			if (!seenKeys.has(key)) {
				seenKeys.add(key);
				uniqueItems.push(item);
			}
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

	// 同步事件监听器已在上面早期设置

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
					forceRefreshList,
				}}
			>
				{window.style === "float" ? <Float /> : <Dock />}
			</MainContext.Provider>
		</>
	);
};

export default Main;
