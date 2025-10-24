import type { GlobalStore } from "@/types/store";
import { proxy } from "valtio";

export const globalStore = proxy<GlobalStore>({
	app: {
		autoStart: false,
		silentStart: false,
		showMenubarIcon: true,
		showTaskbarIcon: false,
	},

	appearance: {
		theme: "auto",
		isDark: false,
	},

	update: {
		auto: false,
		beta: false,
	},

	shortcut: {
		clipboard: "Alt+C",
		preference: "Alt+X",
		quickPaste: {
			enable: false,
			value: "Command+Shift",
		},
		pastePlain: "",
	},

	env: {},

	cloudSync: {
		enabled: false,
		autoSync: false,
		syncInterval: 60000, // 1分钟
		lastSyncTime: 0,
		isSyncing: false,
		realtimeSync: {
			enabled: false,
			autoSyncDelay: 2000, // 2秒
			lastSyncTime: 0,
			isSyncing: false,
		},
	},
});
