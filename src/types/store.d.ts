import type { Platform } from "@tauri-apps/plugin-os";

export type Theme = "auto" | "light" | "dark";

export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE];

export interface Store {
	globalStore: GlobalStore;
	clipboardStore: ClipboardStore;
}

export type WindowBehaviorMode = "lightweight" | "resident" | "auto_recycle";

export interface GlobalStore {
	// 应用设置
	app: {
		autoStart: boolean;
		showMenubarIcon: boolean;
		showTaskbarIcon: boolean;
		windowBehavior: {
			mode: WindowBehaviorMode;
			recycleDelaySeconds: number; // 仅 auto_recycle 模式使用
		};
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
		lastSyncTime: number;
		isSyncing: boolean;
		// WebDAV服务器配置
		serverConfig: {
			url: string;
			username: string;
			password: string;
			path: string;
			timeout: number;
		};
		// 自动同步配置
		autoSyncSettings: {
			enabled: boolean;
			intervalHours: number;
		};
		// 同步模式配置
		syncModeConfig: {
			settings: {
				includeText: boolean;
				includeHtml: boolean;
				includeRtf: boolean;
				includeMarkdown: boolean;
				includeImages: boolean;
				includeFiles: boolean;
				onlyFavorites: boolean;
			};
		};
		// 文件同步设置
		fileSync: {
			enabled: boolean;
			maxFileSize: number;
			supportedTypes: {
				images: boolean;
				documents: boolean;
				text: boolean;
			};
		};
	};
}

export type ClickFeedback = "none" | "copy" | "paste";

export type OperationButton =
	| "copy"
	| "pastePlain"
	| "edit"
	| "note"
	| "star"
	| "delete"
	| "showInExplorer"
	| "previewImage"
	| "openInBrowser"
	| "sendEmail";

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
		codeDetection: boolean; // 新增：代码检测开关
		showSourceApp: boolean; // 新增：显示来源应用开关
		colorDetection: boolean; // 新增：颜色识别开关
	};

	// 历史记录
	history: {
		duration: number;
		unit: number;
		maxCount: number;
	};

	// 多选状态
	multiSelect: {
		isMultiSelecting: boolean;
		selectedIds: Set<string>;
		lastSelectedId: string | null;
		// 记录选择顺序的数组，用于保持用户选择的顺序
		selectedOrder: string[];
		// 记录Shift选择的方向：'up'（从下往上）或'down'（从上往下）或null
		shiftSelectDirection: "up" | "down" | null;
	};

	// 批量拖拽信息
	batchDragInfo: {
		items: HistoryTablePayload[];
		isDragging: boolean;
	};

	// 批量操作进行中标志
	batchOperationInProgress: boolean;

	// 图片预览配置
	imagePreview: {
		enabled: boolean;
	};
}
