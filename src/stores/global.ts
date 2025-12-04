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
		rowHeight: 90,
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
		lastSyncTime: 0,
		isSyncing: false,
		// WebDAV服务器配置
		serverConfig: {
			url: "",
			username: "",
			password: "",
			path: "/EcoPaste-Sync",
			timeout: 60000, // 默认60秒超时
		},
		// 自动同步配置
		autoSyncSettings: {
			enabled: false,
			intervalHours: 1, // 默认1小时
		},
		// 同步模式配置
		syncModeConfig: {
			settings: {
				includeText: true, // 总是启用
				includeHtml: true, // 总是启用
				includeRtf: true, // 总是启用
				includeMarkdown: true, // 总是启用
				includeImages: false, // 文件模式开关，默认关闭
				includeFiles: false, // 文件模式开关，默认关闭
				onlyFavorites: false, // 收藏模式开关，默认关闭
			},
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
	},
});
