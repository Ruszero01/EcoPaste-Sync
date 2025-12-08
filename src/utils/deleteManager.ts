import { deleteFromDatabase, executeSQL } from "@/database";

/**
 * 删除策略枚举
 */
export enum DeleteStrategy {
	SOFT_DELETE = "soft", // 软删除（标记为已删除，等待同步）
	HARD_DELETE = "hard", // 硬删除（直接从数据库删除）
}

/**
 * 删除结果接口
 */
export interface DeleteResult {
	success: boolean;
	deletedCount: number;
	errors: string[];
	softDeletedIds?: string[]; // 软删除的项目ID
	hardDeletedIds?: string[]; // 硬删除的项目ID
}

/**
 * 删除项目信息接口
 */
export interface ItemDeleteInfo {
	id: string;
	syncStatus: string;
	type?: string;
	value?: string;
	isCloudData?: boolean; // 是否来自云端
}

/**
 * 统一的删除管理器
 *
 * 职责：
 * - 统一处理单个和批量删除逻辑
 * - 根据同步状态决定删除策略
 * - 提供统一的错误处理和日志记录
 * - 优化数据库操作，减少重复代码
 */
export class DeleteManager {
	/**
	 * 获取项目的删除信息
	 * @param itemIds 项目ID列表
	 * @returns 项目删除信息列表
	 */
	private async getItemsDeleteInfo(
		itemIds: string[],
	): Promise<ItemDeleteInfo[]> {
		if (itemIds.length === 0) return [];

		try {
			const placeholders = itemIds.map(() => "?").join(",");
			const items = (await executeSQL(
				`SELECT id, syncStatus, type, value, isCloudData FROM history WHERE id IN (${placeholders})`,
				itemIds,
			)) as any[];

			return items.map((item) => ({
				id: item.id,
				syncStatus: item.syncStatus || "none",
				type: item.type,
				value: item.value,
				isCloudData: !!item.isCloudData,
			}));
		} catch (error) {
			console.error("获取项目删除信息失败:", error);
			throw error;
		}
	}

	/**
	 * 确定项目的删除策略
	 * @param item 项目信息
	 * @returns 删除策略
	 */
	private determineDeleteStrategy(item: ItemDeleteInfo): DeleteStrategy {
		// 已同步的项目或来自云端的项目使用软删除，未同步且非云端的项目使用硬删除
		// 这样确保曾经同步过的数据在删除时都会在云端标记为删除，避免云端数据残留
		return item.syncStatus === "synced" || item.isCloudData
			? DeleteStrategy.SOFT_DELETE
			: DeleteStrategy.HARD_DELETE;
	}

	/**
	 * 执行软删除
	 * @param itemIds 要软删除的项目ID列表
	 * @returns 软删除结果
	 */
	private async performSoftDelete(
		itemIds: string[],
	): Promise<{ success: string[]; failed: string[] }> {
		const result = { success: [] as string[], failed: [] as string[] };

		if (itemIds.length === 0) return result;

		try {
			const currentTime = Date.now();
			const placeholders = itemIds.map(() => "?").join(",");

			await executeSQL(
				`UPDATE history SET deleted = 1, syncStatus = 'pending', lastModified = ? WHERE id IN (${placeholders})`,
				[currentTime, ...itemIds],
			);

			// 验证软删除是否成功
			const verifyResult = (await executeSQL(
				`SELECT id FROM history WHERE id IN (${placeholders}) AND deleted = 1`,
				itemIds,
			)) as any[];

			result.success = verifyResult.map((item) => item.id);
			result.failed = itemIds.filter((id) => !result.success.includes(id));

			console.info(
				`🗑️ 软删除结果: 成功 ${result.success.length} 个，失败 ${result.failed.length} 个`,
			);
		} catch (error) {
			console.error("软删除操作失败:", error);
			result.failed = [...itemIds];
		}

		return result;
	}

	/**
	 * 执行硬删除
	 * @param itemIds 要硬删除的项目ID列表
	 * @returns 硬删除结果
	 */
	private async performHardDelete(
		itemIds: string[],
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const result = { success: 0, failed: 0, errors: [] as string[] };

		if (itemIds.length === 0) return result;

		try {
			const deleteResult = await deleteFromDatabase("history", itemIds);
			result.success = deleteResult.success;
			result.failed = deleteResult.failed;

			if (deleteResult.errors && deleteResult.errors.length > 0) {
				result.errors = deleteResult.errors;
			}

			console.info(
				`🗑️ 硬删除结果: 成功 ${result.success} 个，失败 ${result.failed} 个`,
			);
		} catch (error) {
			console.error("硬删除操作失败:", error);
			result.failed = itemIds.length;
			result.errors.push(
				`硬删除失败: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		return result;
	}

	/**
	 * 删除单个项目
	 * @param itemId 项目ID
	 * @returns 删除结果
	 */
	async deleteItem(itemId: string): Promise<DeleteResult> {
		return this.deleteItems([itemId]);
	}

	/**
	 * 批量删除项目
	 * @param itemIds 项目ID列表
	 * @returns 删除结果
	 */
	async deleteItems(itemIds: string[]): Promise<DeleteResult> {
		const result: DeleteResult = {
			success: true,
			deletedCount: 0,
			errors: [],
			softDeletedIds: [],
			hardDeletedIds: [],
		};

		if (itemIds.length === 0) {
			return result;
		}

		try {
			// 1. 获取项目信息
			const itemsInfo = await this.getItemsDeleteInfo(itemIds);

			if (itemsInfo.length === 0) {
				result.errors.push("未找到要删除的项目");
				result.success = false;
				return result;
			}

			// 2. 按删除策略分组
			const softDeleteItems: string[] = [];
			const hardDeleteItems: string[] = [];

			for (const item of itemsInfo) {
				const strategy = this.determineDeleteStrategy(item);
				if (strategy === DeleteStrategy.SOFT_DELETE) {
					softDeleteItems.push(item.id);
				} else {
					hardDeleteItems.push(item.id);
				}
			}

			// 3. 执行软删除
			if (softDeleteItems.length > 0) {
				const softResult = await this.performSoftDelete(softDeleteItems);
				result.softDeletedIds = softResult.success;
				result.deletedCount += softResult.success.length;

				if (softResult.failed.length > 0) {
					result.errors.push(`软删除失败: ${softResult.failed.join(", ")}`);
				}
			}

			// 4. 执行硬删除
			if (hardDeleteItems.length > 0) {
				const hardResult = await this.performHardDelete(hardDeleteItems);
				result.hardDeletedIds = hardResult.failed === 0 ? hardDeleteItems : [];
				result.deletedCount += hardResult.success;

				if (hardResult.failed > 0) {
					result.errors.push(`硬删除失败: ${hardResult.failed} 个项目`);
					result.errors.push(...hardResult.errors);
				}
			}

			// 5. 确定整体成功状态
			result.success = result.errors.length === 0;

			console.info(
				`🗑️ 批量删除完成: 总计 ${result.deletedCount} 个项目，软删除 ${result.softDeletedIds?.length || 0} 个，硬删除 ${result.hardDeletedIds?.length || 0} 个`,
			);
		} catch (error) {
			result.success = false;
			result.errors.push(
				`删除操作异常: ${error instanceof Error ? error.message : String(error)}`,
			);
			console.error("❌ 批量删除失败:", error);
		}

		return result;
	}

	/**
	 * 标记项目为已删除（软删除）
	 * @param itemId 项目ID
	 * @returns 操作结果
	 */
	async markItemAsDeleted(itemId: string): Promise<boolean> {
		try {
			const itemsInfo = await this.getItemsDeleteInfo([itemId]);

			if (itemsInfo.length === 0) {
				console.warn(`要删除的项目不存在: ${itemId}`);
				return false;
			}

			const item = itemsInfo[0];
			const strategy = this.determineDeleteStrategy(item);

			if (strategy === DeleteStrategy.SOFT_DELETE) {
				const result = await this.performSoftDelete([itemId]);
				return result.failed.length === 0;
			}

			// 未同步的项目直接硬删除
			const result = await this.performHardDelete([itemId]);
			return result.failed === 0;
		} catch (error) {
			console.error(`标记项目删除失败 (${itemId}):`, error);
			return false;
		}
	}

	/**
	 * 清理已软删除的项目（在同步完成后调用）
	 * @param itemIds 已在云端删除的项目ID列表
	 * @returns 清理结果
	 */
	async cleanupDeletedItems(itemIds: string[]): Promise<DeleteResult> {
		const result: DeleteResult = {
			success: true,
			deletedCount: 0,
			errors: [],
		};

		if (itemIds.length === 0) {
			return result;
		}

		try {
			// 从数据库彻底删除这些项目
			const deleteResult = await deleteFromDatabase("history", itemIds);
			result.deletedCount = deleteResult.success;

			if (deleteResult.failed > 0) {
				result.success = false;
				result.errors.push(`清理失败: ${deleteResult.failed} 个项目`);
				if (deleteResult.errors && deleteResult.errors.length > 0) {
					result.errors.push(...deleteResult.errors);
				}
			}

			console.info(
				`🗑️ 清理已删除项目: 成功 ${result.deletedCount} 个，失败 ${deleteResult.failed} 个`,
			);
		} catch (error) {
			result.success = false;
			result.errors.push(
				`清理操作异常: ${error instanceof Error ? error.message : String(error)}`,
			);
			console.error("❌ 清理已删除项目失败:", error);
		}

		return result;
	}
}

// 导出单例实例
export const deleteManager = new DeleteManager();
