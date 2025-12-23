// ================================
// 书签分组数据结构
// ================================

export interface BookmarkGroup {
	id: string;
	name: string;
	color: string;
	createTime: number;
	updateTime: number;
}

// ================================
// 同步模式配置（与后端对齐）
// ================================

export interface SyncModeConfig {
	/// 是否启用自动同步
	autoSync: boolean;
	/// 自动同步间隔（分钟）
	autoSyncIntervalMinutes: number;
	/// 是否仅同步收藏项目
	onlyFavorites: boolean;
	/// 是否包含图片
	includeImages: boolean;
	/// 是否包含文件
	includeFiles: boolean;
	/// 内容类型设置
	contentTypes: {
		includeText: boolean;
		includeHtml: boolean;
		includeRtf: boolean;
		includeMarkdown: boolean;
	};
	/// 冲突解决策略
	conflictResolution: "local" | "remote" | "merge" | "manual";
	/// 设备ID（用于标识数据来源）
	deviceId: string;
}
