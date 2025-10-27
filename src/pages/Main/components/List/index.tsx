import Scrollbar from "@/components/Scrollbar";
import { MainContext } from "@/pages/Main";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FloatButton, Modal } from "antd";
import { findIndex } from "lodash-es";
import Item from "./components/Item";
import NoteModal, { type NoteModalRef } from "./components/NoteModal";

const List = () => {
	const { state, getList } = useContext(MainContext);
	const outerRef = useRef<HTMLDivElement>(null);
	const noteModelRef = useRef<NoteModalRef>(null);
	const [deleteModal, contextHolder] = Modal.useModal();
	const [scrollTrigger, setScrollTrigger] = useState(0); // 强制滚动触发器

	const rowVirtualizer = useVirtualizer({
		count: state.list.length,
		gap: 12,
		getScrollElement: () => outerRef.current,
		estimateSize: () => 120,
		getItemKey: (index) => state.list[index].id,
	});

	// 监听激活时回到顶部并选中第一个
	useTauriListen(LISTEN_KEY.ACTIVATE_BACK_TOP, (event) => {
		// 窗口激活事件（来自 showWindow），需要检查 backTop 设置
		if (event?.payload === "window-activate") {
			// 动态获取最新的 backTop 设置值
			const currentBackTopSetting = clipboardStore.window.backTop;

			if (currentBackTopSetting) {
				// 增加延迟，确保窗口完全显示和渲染完成
				setTimeout(() => {
					scrollToTop();
				}, 200);
			}
			// 对于窗口激活事件，不再记录详细的日志以避免控制台噪音
		}
		// 来自剪贴板操作的各种事件，总是执行滚动
		else if (
			event?.payload === "main" ||
			event?.payload === "new-content" ||
			event?.payload === "duplicate-content"
		) {
			setScrollTrigger((prev) => prev + 1); // 增加触发器，强制重新滚动
		}
		// 其他事件，使用原有逻辑
		else {
			scrollToTop();
		}
	});

	const isFocusWithin = useFocusWithin(document.body);

	useAsyncEffect(async () => {
		rowVirtualizer.scrollToIndex(0);

		await getList?.();

		state.activeId = state.list[0]?.id;
	}, [state.search, state.group, state.favorite]);

	// 滚动到选中
	useEffect(() => {
		if (!state.activeId) return;

		const index = findIndex(state.list, { id: state.activeId });

		if (index < 0) return;

		// 使用 requestAnimationFrame 确保 DOM 更新完成
		requestAnimationFrame(() => {
			setTimeout(() => {
				try {
					rowVirtualizer.scrollToIndex(index);
				} catch (_error) {
					// 备用方法：手动设置 scrollTop
					try {
						const virtualItem = rowVirtualizer
							.getVirtualItems()
							.find((item) => item.index === index);
						if (virtualItem && outerRef.current) {
							outerRef.current.scrollTop = virtualItem.start;
						}
					} catch (_fallbackError) {
						// 最后的备用方案：估计位置
						if (outerRef.current) {
							const itemHeight = 120; // 估计的项高度
							const estimatedScrollTop = index * itemHeight;
							outerRef.current.scrollTop = estimatedScrollTop;
						}
					}
				}
			}, 50);
		});
	}, [state.activeId, scrollTrigger]); // 添加 scrollTrigger 依赖，强制触发滚动

	// 额外的滚动保障：当列表长度变化时，确保聚焦项可见
	useUpdateEffect(() => {
		if (!state.activeId || state.list.length === 0) return;

		const index = findIndex(state.list, { id: state.activeId });

		if (index >= 0) {
			// 稍微延迟一下，确保虚拟化重新计算完成
			setTimeout(() => {
				try {
					rowVirtualizer.scrollToIndex(index);
				} catch (_error) {
					// 备用方案：手动设置 scrollTop
					try {
						const virtualItem = rowVirtualizer
							.getVirtualItems()
							.find((item) => item.index === index);
						if (virtualItem && outerRef.current) {
							outerRef.current.scrollTop = virtualItem.start;
						}
					} catch (_err) {
						// 忽略错误，滚动失败不是致命问题
					}
				}
			}, 100);
		}
	}, [state.list.length]);

	// 始终保持有一个选中
	useUpdateEffect(() => {
		if (state.list.length === 0) {
			state.activeId = void 0;
		}

		state.activeId ??= state.list[0]?.id;
	}, [state.list.length]);

	useKeyPress(
		[
			"space",
			"enter",
			"backspace",
			"delete",
			"uparrow",
			"downarrow",
			"home",
			PRESET_SHORTCUT.FAVORITE,
		],
		(_, key) => {
			state.eventBusId = state.activeId;

			switch (key) {
				// 空格预览
				case "space":
					return state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_PREVIEW);
				// 回车粘贴
				case "enter":
					return state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_PASTE);
				// 删除
				case "backspace":
				case "delete":
					return state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_DELETE);
				// 选中上一个
				case "uparrow":
					return state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_SELECT_PREV);
				// 选中下一个
				case "downarrow":
					return state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_SELECT_NEXT);
				// 回到顶部
				case "home":
					return scrollToTop();
				// 收藏和取消收藏
				case PRESET_SHORTCUT.FAVORITE:
					return state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_FAVORITE);
			}
		},
		{
			events: isFocusWithin ? [] : ["keydown"],
		},
	);

	// 回到顶部并选中第一个
	const scrollToTop = () => {
		if (state.list.length === 0) return;

		// 设置活跃项到第一个
		state.activeId = state.list[0]?.id;

		// 滚动到顶部
		requestAnimationFrame(() => {
			try {
				// 方法1：虚拟列表滚动
				rowVirtualizer.scrollToIndex(0, {
					align: "start",
				});

				// 验证是否成功，如果失败则使用备用方法
				setTimeout(() => {
					const scrollOffset = rowVirtualizer.scrollOffset;
					if (scrollOffset && scrollOffset > 10) {
						// 备用方法：直接设置 scrollTop
						if (outerRef.current) {
							outerRef.current.scrollTop = 0;
						}
					}
				}, 50);
			} catch (_error) {
				// 备用方法：直接设置 scrollTop
				if (outerRef.current) {
					outerRef.current.scrollTop = 0;
				}
			}
		});
	};

	return (
		<>
			<Scrollbar ref={outerRef} offset={3} className="flex-1">
				<div
					data-tauri-drag-region
					className="relative w-full"
					style={{ height: rowVirtualizer.getTotalSize() }}
				>
					{rowVirtualizer.getVirtualItems().map((virtualItem) => {
						const { key, size, start, index } = virtualItem;
						const data = state.list[index];
						let { type, value } = data;

						value = type !== "image" ? value : resolveImagePath(value);

						return (
							<Item
								key={key}
								index={index}
								data={{ ...data, value }}
								deleteModal={deleteModal}
								openNoteModel={() => noteModelRef.current?.open()}
								style={{ height: size, transform: `translateY(${start}px)` }}
							/>
						);
					})}
				</div>
			</Scrollbar>

			<FloatButton.BackTop
				duration={0}
				target={() => outerRef.current!}
				onClick={scrollToTop}
			/>

			<NoteModal ref={noteModelRef} />

			{contextHolder}
		</>
	);
};

export default List;
