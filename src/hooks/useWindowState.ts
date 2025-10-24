import { clipboardStore } from "@/stores/clipboard";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
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

		const { x, y, width, height } = state;

		// 获取窗口位置设置
		const windowPosition = clipboardStore.window.position;

		// 根据设置处理窗口位置
		if (windowPosition === "remember") {
			// 记住位置：恢复上次的位置
			if (x && y) {
				appWindow.setPosition(new PhysicalPosition(x, y));
			}
		} else if (windowPosition === "center") {
			// 居中显示：不恢复位置，让窗口居中
			// 不设置位置，让Tauri使用默认的居中位置
		}
		// "follow" 模式：跟随鼠标，这会在显示窗口时处理

		// 恢复窗口大小
		if (width && height) {
			appWindow.setSize(new PhysicalSize(width, height));
		}
	};

	return {
		saveState,
		restoreState,
	};
};
