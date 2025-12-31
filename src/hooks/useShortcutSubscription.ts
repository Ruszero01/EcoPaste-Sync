import { generateQuickPasteShortcuts } from "@/constants";
import { registerAllShortcuts } from "@/plugins/hotkey";
import { useEffect } from "react";
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

	try {
		await registerAllShortcuts(
			clipboardShortcut,
			preferenceShortcut,
			quickPasteShortcuts,
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

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isRegistering) {
				isRegistering = true;
				registerAllShortcutsSync().finally(() => {
					isRegistering = false;
				});
			}
		}, 200);
		return () => clearTimeout(timer);
	}, []);

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

	return () => {
		unsubClipboard();
		unsubPreference();
		unsubQuickPasteEnable();
		unsubQuickPasteValue();
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
	};
};
