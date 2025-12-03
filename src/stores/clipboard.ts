import type { ClipboardStore } from "@/types/store";
import { proxy } from "valtio";

export const clipboardStore = proxy<ClipboardStore>({
	window: {
		style: "float",
		position: "remember",
		backTop: false,
		showAll: false,
	},

	audio: {
		copy: false,
	},

	search: {
		position: "top",
		defaultFocus: false,
		autoClear: false,
	},

	content: {
		autoPaste: "double",
		ocr: true,
		copyPlain: false,
		pastePlain: false,
		operationButtons: ["copy", "star", "delete"],
		autoFavorite: false,
		deleteConfirm: true,
		autoSort: false,
		showOriginalContent: false,
		codeDetection: true, // 新增：代码检测开关
		showSourceApp: true, // 新增：显示来源应用开关
	},

	history: {
		duration: 0,
		unit: 1,
		maxCount: 0,
	},

	// 添加复制操作标志
	internalCopy: {
		isCopying: false,
		itemId: null,
	},

	// 多选状态
	multiSelect: {
		isMultiSelecting: false,
		selectedIds: new Set(),
		lastSelectedId: null,
	},

	// 批量拖拽信息
	batchDragInfo: {
		items: [],
		isDragging: false,
	},
});
