import type { BookmarkGroup } from "@/types/sync";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export interface BookmarkStorageData {
	lastModified: number;
	groups: BookmarkGroup[];
}

/**
 * 简化的书签管理器 - 使用统一时间戳进行同步
 */
class BookmarkManager {
	private static instance: BookmarkManager;
	private readonly STORAGE_KEY = "bookmark-data.json";
	private groups: BookmarkGroup[] = [];
	private lastModified = 0;

	private constructor() {
		this.initializeAsync();
	}

	private async initializeAsync(): Promise<void> {
		await this.loadFromStorage();
	}

	public static getInstance(): BookmarkManager {
		if (!BookmarkManager.instance) {
			BookmarkManager.instance = new BookmarkManager();
		}
		return BookmarkManager.instance;
	}

	// 从本地存储加载数据
	private async loadFromStorage(): Promise<void> {
		try {
			const appDir = await appDataDir();
			const filePath = await join(appDir, this.STORAGE_KEY);

			const data = await readTextFile(filePath);
			const parsedData: BookmarkStorageData = JSON.parse(data);

			this.groups = parsedData.groups || [];
			this.lastModified = parsedData.lastModified || 0;
		} catch {
			// 文件不存在或解析失败，使用默认值
			// 新设备：没有数据，时间戳设为0，表示需要从云端同步
			this.groups = [];
			this.lastModified = 0;
		}
	}

	// 保存数据到本地存储
	private async saveToStorage(updateTimestamp = true): Promise<void> {
		try {
			const appDir = await appDataDir();
			const filePath = await join(appDir, this.STORAGE_KEY);

			const data: BookmarkStorageData = {
				lastModified: updateTimestamp ? Date.now() : this.lastModified,
				groups: this.groups,
			};

			await writeTextFile(filePath, JSON.stringify(data, null, 2));
			if (updateTimestamp) {
				this.lastModified = data.lastModified;
			}
		} catch (error) {
			console.error("Failed to save bookmark data:", error);
		}
	}

	// 获取所有书签分组
	public async getGroups(): Promise<BookmarkGroup[]> {
		// 确保数据已加载
		if (this.groups.length === 0 && this.lastModified === 0) {
			await this.loadFromStorage();
		}
		return [...this.groups];
	}

	// 获取最后修改时间
	public getLastModified(): number {
		return this.lastModified;
	}

	// 设置最后修改时间（用于同步）
	public setLastModified(timestamp: number): void {
		this.lastModified = timestamp;
	}

	// 添加书签分组
	public async addGroup(
		name: string,
		color: string,
	): Promise<BookmarkGroup | null> {
		// 检查是否已存在同名分组
		const existingGroup = this.groups.find(
			(group) => group.name === name.trim(),
		);
		if (existingGroup) {
			console.info(`➕ 书签分组已存在，跳过创建: ${name.trim()}`);
			return null; // 返回null表示已存在
		}

		const newGroup: BookmarkGroup = {
			id: `custom_${Date.now()}`,
			name: name.trim(),
			color,
			createTime: Date.now(),
			updateTime: Date.now(),
		};

		this.groups.push(newGroup);
		await this.saveToStorage();

		// 移除手动触发同步 - 书签同步应该通过整体的同步流程处理
		// await this.triggerSync(); // 删除这行

		return newGroup;
	}

	// 更新书签分组
	public async updateGroup(
		id: string,
		updates: Partial<Omit<BookmarkGroup, "id" | "createTime">>,
	): Promise<BookmarkGroup | null> {
		const groupIndex = this.groups.findIndex((group) => group.id === id);
		if (groupIndex === -1) return null;

		const oldName = this.groups[groupIndex].name;
		this.groups[groupIndex] = {
			...this.groups[groupIndex],
			...updates,
			updateTime: Date.now(),
		};

		console.info(`✏️ 更新书签分组: ${oldName} -> ${updates.name || oldName}`);
		await this.saveToStorage();
		console.info(
			`✏️ 更新书签分组完成: ${this.groups[groupIndex].name}, 新时间戳: ${this.lastModified}`,
		);

		// 移除手动触发同步 - 书签同步应该通过整体的同步流程处理
		// await this.triggerSync(); // 删除这行

		return this.groups[groupIndex];
	}

	// 删除书签分组
	public async deleteGroup(id: string): Promise<boolean> {
		const groupIndex = this.groups.findIndex((group) => group.id === id);
		if (groupIndex === -1) return false;

		console.info(`🗑️ 删除书签分组: ${id}, 删除前时间戳: ${this.lastModified}`);
		this.groups.splice(groupIndex, 1);
		await this.saveToStorage();
		console.info(
			`🗑️ 删除书签分组完成: ${id}, 删除后时间戳: ${this.lastModified}, 剩余分组数: ${this.groups.length}`,
		);

		// 移除手动触发同步 - 书签同步应该通过整体的同步流程处理
		// await this.triggerSync(); // 删除这行

		return true;
	}

	// 清空所有书签分组
	public async clearAllGroups(): Promise<void> {
		console.info(
			`🗑️ 清空所有书签分组, 清空前时间戳: ${this.lastModified}, 分组数: ${this.groups.length}`,
		);
		this.groups = [];
		// 确保更新时间戳，以便同步到云端
		await this.saveToStorage(true);
		console.info(`🗑️ 清空所有书签分组完成, 清空后时间戳: ${this.lastModified}`);

		// 移除手动触发同步 - 书签同步应该通过整体的同步流程处理
		// await this.triggerSync(); // 删除这行
	}

	// 获取用于同步的数据
	public async getSyncData(): Promise<BookmarkGroup[]> {
		// 重要：同步时强制从磁盘重新加载，确保获取最新数据
		// 避免内存数据与磁盘数据不一致导致的同步延迟问题
		await this.loadFromStorage();

		console.info(
			`📖 获取同步数据: 分组数=${this.groups.length}, 时间戳=${this.lastModified}`,
		);
		return [...this.groups];
	}

	// 设置数据（用于从云端同步）
	public async setData(
		groups: BookmarkGroup[],
		lastModified?: number,
	): Promise<void> {
		this.groups = groups || [];
		// 使用提供的时间戳，如果没有提供则保持当前时间戳
		const targetLastModified =
			lastModified !== undefined ? lastModified : this.lastModified;
		await this.saveToStorage(false);
		this.lastModified = targetLastModified;
		console.info(
			`📥 设置云端数据: 分组数=${this.groups.length}, 时间戳=${this.lastModified}`,
		);
	}

	// 强制设置数据（云端数据强制覆盖时使用）
	public async forceSetData(
		groups: BookmarkGroup[],
		lastModified?: number,
	): Promise<void> {
		this.groups = groups || [];
		// 不更新时间戳，使用调用方提供的时间戳
		await this.saveToStorage(false);
		if (lastModified !== undefined) {
			this.lastModified = lastModified;
		}
		console.info(
			`🔒 强制设置云端数据: 分组数=${this.groups.length}, 时间戳=${this.lastModified}`,
		);
	}

	// 重新排序书签分组
	public async reorderGroups(groups: BookmarkGroup[]): Promise<void> {
		console.info(`🔄 重新排序书签分组: ${groups.length}个分组`);
		this.groups = groups;
		await this.saveToStorage(true);
		console.info(`✅ 书签分组排序完成，新时间戳: ${this.lastModified}`);
	}

	// 开发模式：清空所有书签数据并重置时间戳为0，模拟新设备状态
	public async clearForNewDevice(): Promise<void> {
		console.warn("🧪 开发模式：清空书签数据，模拟新设备状态");
		this.groups = [];
		this.lastModified = 0;
		// 注意：不调用triggerSync()，避免立即触发同步导致覆盖本地新增的数据
		await this.saveToStorage(false);
		console.info(
			`🧪 新设备状态已设置: 分组数=${this.groups.length}, 时间戳=${this.lastModified}`,
		);
		console.warn("⚠️ 手动触发同步以测试新设备同步逻辑");
	}
}

export const bookmarkManager = BookmarkManager.getInstance();
