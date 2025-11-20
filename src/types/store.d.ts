import type { Platform } from "@tauri-apps/plugin-os";

export type Theme = "auto" | "light" | "dark";

export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE];

export interface Store {
	globalStore: GlobalStore;
	clipboardStore: ClipboardStore;
}

export interface GlobalStore {
	// 应用设置
	app: {
		autoStart: boolean;
		silentStart: boolean;
		showMenubarIcon: boolean;
		showTaskbarIcon: boolean;
	};

	// 外观设置
	appearance: {
		theme: Theme;
		isDark: boolean;
		language?: Language;
		rowHeight: number;
	};

	update: {
		auto: boolean;
		beta: boolean;
	};

	// 快捷键设置
	shortcut: {
		clipboard: string;
		preference?: string;
		quickPaste: {
			enable: boolean;
			value: string;
		};
		pastePlain: string;
	};

	// 只在当前系统环境使用
	env: {
		platform?: Platform;
		appName?: string;
		appVersion?: string;
		saveDataDir?: string;
	};

	// 云同步设置
	cloudSync: {
		enabled: boolean;
		autoSync: boolean;
		syncInterval: number;
		lastSyncTime: number;
		isSyncing: boolean;
		realtimeSync: {
			enabled: boolean;
			autoSyncDelay: number;
			lastSyncTime: number;
			isSyncing: boolean;
		};
		// 文件同步设置
		fileSync: {
			enabled: boolean;
			lightweightMode: boolean;
			maxFileSize: number;
			supportedTypes: {
				images: boolean;
				documents: boolean;
				text: boolean;
			};
		};
		// 同步模式配置（双开关模式）
		syncModeConfig: {
			settings: {
				includeText: boolean;
				includeHtml: boolean;
				includeRtf: boolean;
				includeImages: boolean;
				includeFiles: boolean;
				onlyFavorites: boolean;
			};
		};
		// 自动同步配置（原localStorage中的配置）
		autoSyncSettings: {
			enabled: boolean;
			intervalHours: number;
		};
	};
}

export type ClickFeedback = "none" | "copy" | "paste";

export type OperationButton =
	| "copy"
	| "pastePlain"
	| "note"
	| "star"
	| "delete";

export interface ClipboardStore {
	// 窗口设置
	window: {
		style: "float" | "dock";
		position: "remember" | "follow" | "center";
		backTop: boolean;
		showAll: boolean;
	};

	// 音效设置
	audio: {
		copy: boolean;
	};

	// 搜索框设置
	search: {
		position: "top" | "bottom";
		defaultFocus: boolean;
		autoClear: boolean;
	};

	// 剪贴板内容设置
	content: {
		autoPaste: "single" | "double";
		ocr: boolean;
		copyPlain: boolean;
		pastePlain: boolean;
		operationButtons: OperationButton[];
		autoFavorite: boolean;
		deleteConfirm: boolean;
		autoSort: boolean;
		showOriginalContent: boolean;
	};

	// 历史记录
	history: {
		duration: number;
		unit: number;
		maxCount: number;
	};

	// 内部复制操作标志
	internalCopy: {
		isCopying: boolean;
		itemId: string | null;
	};
}
