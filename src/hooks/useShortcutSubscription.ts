import { generateQuickPasteShortcuts } from "@/constants";
import { registerAllShortcuts } from "@/plugins/hotkey";
import { subscribeKey } from "valtio/utils";

type UnsubscribeFn = () => void;

// 是否正在注册中（防止并发调用）
let isRegistering = false;

const registerAllShortcutsSync = async () => {
	const clipboardShortcut = globalStore.shortcut.clipboard ?? "";
	const preferenceShortcut = globalStore.shortcut.preference ?? "";
	const quickPasteShortcuts = globalStore.shortcut.quickPaste.enable
		? generateQuickPasteShortcuts(globalStore.shortcut.quickPaste.value ?? "")
		: [];
	const pastePlainShortcut = globalStore.shortcut.pastePlain ?? "";

	try {
		await registerAllShortcuts(
			clipboardShortcut,
			preferenceShortcut,
			quickPasteShortcuts,
			pastePlainShortcut,
		);
	} catch (err) {
		console.error("[useShortcutSubscription] 注册失败:", err);
	}
};

export const useShortcutSubscription = (): UnsubscribeFn => {
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const debouncedRegister = () => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (!isRegistering) {
				isRegistering = true;
				registerAllShortcutsSync().finally(() => {
					isRegistering = false;
				});
			}
		}, 200);
	};

	// 注意：不再在 useEffect 中自动注册
	// 后端在 setup 中会自动注册默认快捷键
	// 前端只负责在快捷键配置变化时通知后端重新注册

	const unsubClipboard = subscribeKey(
		globalStore.shortcut,
		"clipboard",
		debouncedRegister,
	);
	const unsubPreference = subscribeKey(
		globalStore.shortcut,
		"preference",
		debouncedRegister,
	);
	const unsubQuickPasteEnable = subscribeKey(
		globalStore.shortcut.quickPaste,
		"enable",
		debouncedRegister,
	);
	const unsubQuickPasteValue = subscribeKey(
		globalStore.shortcut.quickPaste,
		"value",
		() => {
			if (globalStore.shortcut.quickPaste.enable) {
				debouncedRegister();
			}
		},
	);
	const unsubPastePlain = subscribeKey(
		globalStore.shortcut,
		"pastePlain",
		debouncedRegister,
	);

	return () => {
		unsubClipboard();
		unsubPreference();
		unsubQuickPasteEnable();
		unsubQuickPasteValue();
		unsubPastePlain();
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
	};
};
