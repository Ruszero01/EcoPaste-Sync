import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { debounce } from "lodash-es";

interface Props {
	onFocus?: () => void;
	onBlur?: () => void;
}

export const useTauriFocus = (props: Props) => {
	const { onFocus, onBlur } = props;
	const unlistenRef = useRef(() => {});

	useMount(async () => {
		const appWindow = getCurrentWebviewWindow();

		// 简单的防抖，避免快速状态变化
		const debounced = debounce(({ payload }) => {
			if (payload) {
				onFocus?.();
			} else {
				onBlur?.();
			}
		}, 50); // 适中的防抖延迟

		unlistenRef.current = await appWindow.onFocusChanged(debounced);
	});

	useUnmount(unlistenRef.current);
};
