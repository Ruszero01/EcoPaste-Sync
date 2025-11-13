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
		// 文件同步设置
		fileSync: {
			enabled: true, // 默认开启
			lightweightMode: true, // 默认轻量模式
			maxFileSize: 10, // 默认10MB
			supportedTypes: {
				images: true,
				documents: true,
				text: true,
			},
		},
		// 同步模式配置（原localStorage中的配置）
		syncModeConfig: {
			mode: "lightweight", // lightweight | full | favorites
			settings: {
				includeText: true,
				includeHtml: true,
				includeRtf: true,
				includeImages: false, // 默认关闭图片同步
				includeFiles: false, // 默认关闭文件同步
				onlyFavorites: false, // 默认关闭收藏模式
			},
		},
		// 自动同步配置（原localStorage中的配置）
		autoSyncSettings: {
			enabled: false,
			intervalHours: 1, // 默认1小时
		},
	},
});
