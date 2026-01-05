import { type PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { Event } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const appWindow = getCurrentWebviewWindow();
const { label } = appWindow;

export const useWindowState = () => {
	const state = useReactive<Partial<PhysicalPosition & PhysicalSize>>({});

	useMount(() => {
		appWindow.onMoved(onChange);
		appWindow.onResized(onChange);
	});

	useTauriFocus({
		onBlur() {
			saveState();
		},
	});

	const onChange = async (event: Event<PhysicalPosition | PhysicalSize>) => {
		const minimized = await appWindow.isMinimized();

		if (minimized) return;

		Object.assign(state, event.payload);
	};

	const getSavedStates = async () => {
		const path = await getSaveWindowStatePath();

		const existed = await exists(path);

		if (!existed) return {};

		const states = await readTextFile(path);

		return JSON.parse(states);
	};

	const saveState = async () => {
		const path = await getSaveWindowStatePath();

		const states = await getSavedStates();

		states[label] = state;

		return writeTextFile(path, JSON.stringify(states, null, 2));
	};

	const restoreState = async () => {
		const states = await getSavedStates();

		Object.assign(state, states[label]);

		const { width, height } = state;

		// 注意：窗口位置现在由 Rust 端在创建窗口时直接设置
		// 这里只处理窗口大小的恢复

		// 恢复窗口大小
		if (width && height) {
			appWindow.setSize(new PhysicalSize(width, height));
		}
	};

	// 在窗口显示后恢复位置（不需要等待 focus 事件）
	useEffect(() => {
		// 加一个短暂的延迟，确保窗口已经显示
		const timer = setTimeout(() => {
			restoreState();
		}, 50);
		return () => clearTimeout(timer);
	}, []);

	return {
		saveState,
		restoreState,
	};
};
