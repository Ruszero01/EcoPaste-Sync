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
			this.lastModified = parsedData.lastModified || Date.now();
		} catch {
			// 文件不存在或解析失败，使用默认值
			this.groups = [];
			this.lastModified = Date.now();
		}
	}

	// 保存数据到本地存储
	private async saveToStorage(): Promise<void> {
		try {
			const appDir = await appDataDir();
			const filePath = await join(appDir, this.STORAGE_KEY);

			const data: BookmarkStorageData = {
				lastModified: Date.now(),
				groups: this.groups,
			};

			await writeTextFile(filePath, JSON.stringify(data, null, 2));
			this.lastModified = data.lastModified;
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

		return newGroup;
	}

	// 更新书签分组
	public async updateGroup(
		id: string,
		updates: Partial<Omit<BookmarkGroup, "id" | "createTime">>,
	): Promise<BookmarkGroup | null> {
		const groupIndex = this.groups.findIndex((group) => group.id === id);
		if (groupIndex === -1) return null;

		this.groups[groupIndex] = {
			...this.groups[groupIndex],
			...updates,
			updateTime: Date.now(),
		};

		await this.saveToStorage();
		return this.groups[groupIndex];
	}

	// 删除书签分组
	public async deleteGroup(id: string): Promise<boolean> {
		const groupIndex = this.groups.findIndex((group) => group.id === id);
		if (groupIndex === -1) return false;

		this.groups.splice(groupIndex, 1);
		await this.saveToStorage();
		return true;
	}

	// 清空所有书签分组
	public async clearAllGroups(): Promise<void> {
		this.groups = [];
		await this.saveToStorage();
	}

	// 获取用于同步的数据
	public async getSyncData(): Promise<BookmarkGroup[]> {
		// 确保数据已加载
		if (this.groups.length === 0 && this.lastModified === 0) {
			await this.loadFromStorage();
		}
		return [...this.groups];
	}

	// 设置数据（用于从云端同步）
	public async setData(groups: BookmarkGroup[]): Promise<void> {
		this.groups = groups || [];
		// 保持当前的时间戳，这样下次同步时本地不会认为自己的数据更新了
		const originalLastModified = this.lastModified;
		await this.saveToStorage();
		this.lastModified = originalLastModified;
	}

	// 强制设置数据（云端数据强制覆盖时使用）
	public async forceSetData(groups: BookmarkGroup[]): Promise<void> {
		this.groups = groups || [];
		await this.saveToStorage();
	}
}

export const bookmarkManager = BookmarkManager.getInstance();
