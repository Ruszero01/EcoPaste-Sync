import type {
	HistoryTablePayload,
	TableName,
	TablePayload,
} from "@/types/database";
import { dayjs } from "@/utils/dayjs";
import {} from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";
import { entries, isBoolean, isNil, map, omitBy, some } from "lodash-es";

let db: Database | null = null;

/**
 * 初始化数据库
 */
export const initDatabase = async () => {
	if (db) return;

	const path = await getSaveDatabasePath();

	db = await Database.load(`sqlite:${path}`);

	// 创建 `history` 表
	await executeSQL(`
        CREATE TABLE IF NOT EXISTS history (
			id TEXT PRIMARY KEY,
			type TEXT,
			[group] TEXT,
			value TEXT,
			search TEXT,
			count INTEGER,
			width INTEGER,
			height INTEGER,
			favorite INTEGER DEFAULT 0,
			createTime TEXT,
			note TEXT,
			subtype TEXT,
			lazyDownload INTEGER DEFAULT 0,
			fileSize INTEGER,
			fileType TEXT,
			deleted INTEGER DEFAULT 0,
			syncStatus TEXT DEFAULT 'none',
			isCloudData INTEGER DEFAULT 0
		);
        `);

	// 检查并添加新字段（用于向后兼容）
	try {
		await executeSQL(
			"ALTER TABLE history ADD COLUMN syncStatus TEXT DEFAULT 'none'",
		);
	} catch (_error) {
		// 字段已存在，忽略错误
	}

	// 添加代码检测相关字段
	try {
		await executeSQL("ALTER TABLE history ADD COLUMN codeLanguage TEXT");
	} catch (_error) {
		// 字段已存在，忽略错误
	}

	try {
		await executeSQL("ALTER TABLE history ADD COLUMN isCode INTEGER DEFAULT 0");
	} catch (_error) {
		// 字段已存在，忽略错误
	}

	try {
		await executeSQL(
			"ALTER TABLE history ADD COLUMN isCloudData INTEGER DEFAULT 0",
		);
	} catch (_error) {
		// 字段已存在，忽略错误
	}

	try {
		await executeSQL("ALTER TABLE history ADD COLUMN lastModified INTEGER");
	} catch (_error) {
		// 字段已存在，忽略错误
	}

	// 添加来源应用相关字段
	try {
		await executeSQL("ALTER TABLE history ADD COLUMN sourceAppName TEXT");
	} catch (_error) {
		// 字段已存在，忽略错误
	}

	try {
		await executeSQL("ALTER TABLE history ADD COLUMN sourceAppIcon TEXT");
	} catch (_error) {
		// 字段已存在，忽略错误
	}
};

/**
 * 处理参数
 * @param payload 数据
 */
const handlePayload = (payload: TablePayload) => {
	const omitPayload = omitBy(payload, isNil);

	const keys = [];
	const values = [];

	for (const [key, value] of entries(omitPayload)) {
		keys.push(key === "group" ? "[group]" : key);

		const nextValue = isBoolean(value) ? Number(value) : value;

		values.push(nextValue);
	}

	return {
		keys,
		values,
	};
};

/**
 * 通用 WHERE 条件构建器
 * @param conditions 查询条件对象
 * @returns 包含 WHERE 子句和参数值的对象
 */
export const buildWhere = (conditions: Record<string, any>) => {
	const where: string[] = [];
	const values: any[] = [];

	for (const key in conditions) {
		const value = conditions[key];
		if (value === undefined || value === null) continue;

		// 处理特殊字段名（如 group 需要转为 [group]）
		const fieldName = key === "group" ? "[group]" : key;

		if (typeof value === "string" && value.includes("%")) {
			where.push(`${fieldName} LIKE ?`);
			values.push(value);
		} else if (typeof value === "object" && value !== null) {
			// 处理复杂条件对象，如 { operator: "IN", values: [...] }
			if (value.operator === "IN" && Array.isArray(value.values)) {
				const placeholders = value.values.map(() => "?").join(",");
				where.push(`${fieldName} IN (${placeholders})`);
				values.push(...value.values);
			} else if (
				value.operator === "BETWEEN" &&
				Array.isArray(value.values) &&
				value.values.length === 2
			) {
				where.push(`${fieldName} BETWEEN ? AND ?`);
				values.push(...value.values);
			}
		} else {
			where.push(`${fieldName} = ?`);
			values.push(value);
		}
	}

	return {
		whereSQL: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
		values,
	};
};

/**
 * 通用 SELECT 查询函数
 * @param tableName 表名
 * @param where 查询条件
 * @param orderBy 排序方式
 * @param limit 限制数量
 * @returns 查询结果
 */
export const dbSelect = async <T = any>(
	tableName: TableName,
	where: Record<string, any> = {},
	orderBy = "ORDER BY createTime DESC",
	limit?: number,
) => {
	const { whereSQL, values } = buildWhere(where);
	let sql = `SELECT * FROM ${tableName} ${whereSQL} ${orderBy}`;
	if (limit) sql += ` LIMIT ${limit}`;

	const result = await executeSQL(sql, values);

	// 转换integer字段为boolean，确保UI组件能正确处理
	const processedList = (Array.isArray(result) ? result : []).map(
		(item: any) => ({
			...item,
			favorite: Boolean(item.favorite),
			deleted: Boolean(item.deleted),
			lazyDownload: Boolean(item.lazyDownload),
			isCloudData: Boolean(item.isCloudData),
			isCode: Boolean(item.isCode),
			// 确保同步状态的有效性，只允许有效的状态值
			syncStatus:
				item.syncStatus === "synced" ||
				item.syncStatus === "syncing" ||
				item.syncStatus === "error"
					? item.syncStatus
					: "none",
		}),
	);

	return processedList as T[];
};

/**
 * 通用 UPDATE 更新函数
 * @param tableName 表名
 * @param where 查询条件
 * @param update 更新数据
 * @returns 更新结果
 */
export const dbUpdate = async (
	tableName: TableName,
	where: Record<string, any>,
	update: Record<string, any>,
) => {
	const updateKeys = Object.keys(update).filter(
		(key) => update[key] !== undefined,
	);
	if (updateKeys.length === 0) {
		return { rowsAffected: 0 };
	}

	const setSQL = updateKeys
		.map((key) => `${key === "group" ? "[group]" : key} = ?`)
		.join(", ");

	const setValues = updateKeys.map((key) => {
		const value = update[key];
		return isBoolean(value) ? Number(value) : value;
	});

	const { whereSQL, values: whereValues } = buildWhere(where);

	const sql = `UPDATE ${tableName} SET ${setSQL} ${whereSQL}`;
	const result = await executeSQL(sql, [...setValues, ...whereValues]);

	return { rowsAffected: result as any };
};

/**
 * 通用 DELETE 删除函数
 * @param tableName 表名
 * @param where 查询条件
 * @returns 删除结果
 */
export const dbDelete = async (
	tableName: TableName,
	where: Record<string, any>,
) => {
	const { whereSQL, values } = buildWhere(where);
	const sql = `DELETE FROM ${tableName} ${whereSQL}`;

	const result = await executeSQL(sql, values);
	return { rowsAffected: result as any };
};

/**
 * 统一的插入或更新逻辑（基于去重检测）
 * @param tableName 表名
 * @param payload 插入的数据
 * @param isSync 是否为同步操作
 * @returns 操作结果
 */
export const insertOrUpdate = async (
	tableName: TableName,
	payload: TablePayload,
	_isSync = false, // 保留参数以保持API兼容性，但暂时不使用
): Promise<{ insertId?: string; rowsAffected: number; isUpdate?: boolean }> => {
	const { id, type, value, group } = payload as HistoryTablePayload;
	const currentTime = dayjs().format("YYYY-MM-DD HH:mm:ss");

	// 如果提供了ID，优先使用ID进行去重
	if (id) {
		const existingRecords = await dbSelect(tableName, { id, deleted: 0 });

		if (existingRecords.length > 0) {
			// 更新现有记录
			const updateData: Partial<HistoryTablePayload> = {
				createTime: currentTime,
				lastModified: Date.now(),
				// 保留原始来源应用信息
				sourceAppName: existingRecords[0].sourceAppName,
				sourceAppIcon: existingRecords[0].sourceAppIcon,
				// 更新其他字段
				...payload,
				// 确保不覆盖ID
				id: existingRecords[0].id,
			};

			await dbUpdate(tableName, { id }, updateData);

			return {
				insertId: existingRecords[0].id,
				rowsAffected: 1,
				isUpdate: true,
			};
		}
	}

	// 基于内容进行去重检测
	const whereConditions: Record<string, any> = { deleted: 0 };

	if (type !== undefined) {
		whereConditions.type = type;
	}

	// 对于HTML、RTF和Markdown类型，使用search字段进行比较
	if (type === "html" || type === "rtf" || type === "markdown") {
		const searchValue = (payload as HistoryTablePayload).search;
		if (searchValue) {
			whereConditions.search = searchValue;
		}
	} else if (value !== undefined) {
		whereConditions.value = value;
	}

	if (group !== undefined) {
		whereConditions.group = group;
	}

	// 对于文件和图片类型，进行特殊处理
	if (type === "image" || (type === "files" && value !== undefined)) {
		let filePath = value;

		// 如果是files类型，尝试从JSON中提取文件路径
		if (type === "files" && value.startsWith("[")) {
			try {
				const filePaths = JSON.parse(value);
				filePath = filePaths[0];
			} catch {
				// 解析失败，使用原值
			}
		}

		// 标准化路径格式
		const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/");

		// 查找相同文件路径的记录（跨类型）
		const existingRecords = await dbSelect(
			tableName,
			{
				type: { operator: "IN", values: ["files", "image"] },
				value: `%${normalizedPath}%`,
				deleted: 0,
			},
			"ORDER BY createTime DESC",
			1,
		);

		if (existingRecords.length > 0) {
			const existing = existingRecords[0];

			// 更新现有记录
			const updateData: Partial<HistoryTablePayload> = {
				createTime: currentTime,
				lastModified: Date.now(),
				// 保留原始来源应用信息
				sourceAppName: existing.sourceAppName,
				sourceAppIcon: existing.sourceAppIcon,
				// 更新其他字段
				...payload,
				// 确保不覆盖ID
				id: existing.id,
			};

			await dbUpdate(tableName, { id: existing.id }, updateData);

			return {
				insertId: existing.id,
				rowsAffected: 1,
				isUpdate: true,
			};
		}
	} else {
		// 对于其他类型，使用常规去重逻辑
		const existingRecords = await dbSelect(
			tableName,
			whereConditions,
			"ORDER BY createTime DESC",
			1,
		);

		if (existingRecords.length > 0) {
			const existing = existingRecords[0];

			// 更新现有记录
			const updateData: Partial<HistoryTablePayload> = {
				createTime: currentTime,
				lastModified: Date.now(),
				// 保留原始来源应用信息
				sourceAppName: existing.sourceAppName,
				sourceAppIcon: existing.sourceAppIcon,
				// 更新其他字段
				...payload,
				// 确保不覆盖ID
				id: existing.id,
			};

			await dbUpdate(tableName, { id: existing.id }, updateData);

			return {
				insertId: existing.id,
				rowsAffected: 1,
				isUpdate: true,
			};
		}
	}

	// 没有找到重复记录，插入新记录
	const { keys, values } = handlePayload(payload);
	const refs = map(values, () => "?");

	await executeSQL(
		`INSERT INTO ${tableName} (${keys}) VALUES (${refs});`,
		values,
	);

	return {
		rowsAffected: 1,
		isUpdate: false,
	};
};

/**
 * 执行 sql 语句
 * @param sql sql 语句
 */
export const executeSQL = async (query: string, values?: unknown[]) => {
	await initDatabase();

	if (query.startsWith("SELECT") || query.startsWith("PRAGMA")) {
		return await db!.select(query, values);
	}

	await db!.execute(query, values);
};

/**
 * 查找的 sql 语句
 * @param tableName 表名称
 * @param payload 查询参数
 * @param orderBy 排序方式，默认按时间降序
 * @returns
 */
export const selectSQL = async <List,>(
	tableName: TableName,
	payload: TablePayload = {},
	orderBy = "ORDER BY createTime DESC",
) => {
	const { keys, values } = handlePayload(payload);

	const clause = map(keys, (key, index) => {
		if (key === "search") {
			const value = `%${payload.search}%`;

			values[index] = value;
			values.splice(index + 1, 0, value);

			return "(search LIKE ? OR note LIKE ?)";
		}

		if (key === "isCode") {
			const value = payload.isCode;
			if (value === false) {
				// 查询非代码：isCode = 0 OR isCode IS NULL
				values.push(0); // 添加 false 值
				return "(isCode = ? OR isCode IS NULL)";
			}
			return "isCode = ?";
		}

		return `${key} = ?`;
	}).join(" AND ");

	const whereClause = clause ? `WHERE ${clause}` : "";

	const list = await executeSQL(
		`SELECT * FROM ${tableName} ${whereClause} ${orderBy};`,
		values,
	);

	// 转换integer字段为boolean，确保UI组件能正确处理
	const processedList = (Array.isArray(list) ? list : []).map((item: any) => ({
		...item,
		favorite: Boolean(item.favorite),
		deleted: Boolean(item.deleted),
		lazyDownload: Boolean(item.lazyDownload),
		isCloudData: Boolean(item.isCloudData),
		isCode: Boolean(item.isCode),
		// 确保同步状态的有效性，只允许有效的状态值
		syncStatus:
			item.syncStatus === "synced" ||
			item.syncStatus === "syncing" ||
			item.syncStatus === "error"
				? item.syncStatus
				: "none",
	}));

	return processedList as List;
};

/**
 * 添加的 sql 语句
 * @param tableName 表名称
 * @param payload 添加的数据
 */
export const insertSQL = (tableName: TableName, payload: TablePayload) => {
	const { keys, values } = handlePayload(payload);

	const refs = map(values, () => "?");

	return executeSQL(
		`INSERT INTO ${tableName} (${keys}) VALUES (${refs});`,
		values,
	);
};

/**
 * 同步专用的去重插入函数（重构为使用通用函数）
 * @param tableName 表名称
 * @param payload 插入的数据
 */
export const insertWithDeduplicationForSync = async (
	tableName: TableName,
	payload: TablePayload,
): Promise<{ insertId?: string; rowsAffected: number; isUpdate?: boolean }> => {
	const { id } = payload;

	if (!id) {
		// 如果没有ID，使用统一的去重逻辑
		return await insertOrUpdate(tableName, payload, true);
	}

	try {
		// 检查是否已存在相同ID的记录
		const existingRecords = await dbSelect(tableName, { id });

		if (existingRecords.length > 0) {
			const existing = existingRecords[0];

			if (existing.deleted) {
				return {
					rowsAffected: 0,
					isUpdate: false,
				};
			}

			// 如果记录存在且未被删除，则更新它
			// 保留原始的来源应用信息
			let updatePayload = { ...payload };

			// 如果是history表，保留原始来源应用信息
			if (tableName === "history") {
				const { sourceAppName, sourceAppIcon, ...rest } = payload;
				updatePayload = {
					...rest,
					sourceAppName: existing.sourceAppName,
					sourceAppIcon: existing.sourceAppIcon,
				};
			}

			await dbUpdate(tableName, { id }, updatePayload);
			return {
				insertId: id,
				rowsAffected: 1,
				isUpdate: true,
			};
		}

		// 如果记录不存在，则插入新记录
		const { keys, values } = handlePayload(payload);
		const refs = map(values, () => "?");

		await executeSQL(
			`INSERT INTO ${tableName} (${keys}) VALUES (${refs});`,
			values,
		);
		return {
			insertId: id,
			rowsAffected: 1,
			isUpdate: false,
		};
	} catch (error) {
		console.error(`❌ 同步插入失败: ${id}`, error);
		throw error;
	}
};

/**
 * 去重插入的 sql 语句（重构为使用通用函数）
 * @param tableName 表名称
 * @param payload 插入的数据
 * @param identifier 去重标识（默认使用 type + value）
 */
export const insertWithDeduplication = async (
	tableName: TableName,
	payload: TablePayload,
	_identifier = "default",
): Promise<{ insertId?: string; rowsAffected: number; isUpdate?: boolean }> => {
	// 直接使用新的统一插入或更新逻辑
	return await insertOrUpdate(tableName, payload, false);
};

/**
 * 更新的 sql 语句（重构为使用通用函数）
 * @param tableName 表名称
 * @param payload 修改的数据
 */
export const updateSQL = async (
	tableName: TableName,
	payload: TablePayload,
) => {
	const { id, ...rest } = payload;

	if (!id) {
		console.warn("更新操作缺少ID");
		return;
	}

	// 使用通用UPDATE函数
	const result = await dbUpdate(tableName, { id }, rest);
	return result.rowsAffected;
};

/**
 * 删除的 sql 语句（使用统一的删除管理器）
 * @param tableName 表名称
 * @param item 删除的数据项
 */
export const deleteSQL = async (_tableName: TableName, item: TablePayload) => {
	const { id, type, value } = item;

	if (!id) {
		throw new Error("删除操作缺少ID");
	}

	try {
		// 导入删除管理器
		const { deleteManager } = await import("@/utils/deleteManager");

		// 使用删除管理器执行删除
		const result = await deleteManager.deleteItem(id);

		if (!result.success) {
			throw new Error(result.errors?.join("; ") ?? "删除失败");
		}

		// 只删除数据库记录和云端数据，保留本地文件系统中的原始文件
		if (type === "image" && value) {
			console.info(`📝 保留本地图片文件: ${value}`);
		}
	} catch (error) {
		console.error(`❌ 删除项目失败: ${id}`, error);
		throw error;
	}
};

/**
 * 清理重复记录（基于文件路径的智能去重）
 */
export const cleanupDuplicateRecords = async () => {
	try {
		// 获取所有files和image类型的记录
		const fileRecords = (await executeSQL(
			`SELECT * FROM history WHERE type = "files" OR type = "image" ORDER BY createTime DESC`,
		)) as any[];

		const processedPaths = new Set<string>();
		let deletedCount = 0;

		for (const record of fileRecords) {
			let filePath = record.value;

			// 处理files类型，提取文件路径
			if (record.type === "files" && record.value?.startsWith("[")) {
				try {
					const filePaths = JSON.parse(record.value);
					filePath = filePaths[0];
				} catch {
					// 解析失败，使用原值
				}
			}

			// 如果这个文件路径已经处理过，删除当前记录
			if (processedPaths.has(filePath)) {
				await executeSQL("DELETE FROM history WHERE id = ?", [record.id]);
				deletedCount++;
			} else {
				processedPaths.add(filePath);
			}
		}
		return deletedCount;
	} catch (error) {
		console.error("❌ 清理重复记录失败:", error);
		return 0;
	}
};

/**
 * 重置整个数据库（强制清空并删除重建）
 */
export const resetDatabase = async () => {
	try {
		// 1. 先尝试清空数据
		try {
			await executeSQL("DELETE FROM history;");
			await executeSQL("VACUUM;");
		} catch (error) {
			console.warn("清空数据库表失败，继续删除文件:", error);
		}

		// 2. 关闭数据库连接
		if (db) {
			try {
				await db.close();
			} catch (error) {
				console.warn("关闭数据库连接失败:", error);
			}
			db = null;
		}

		// 3. 删除数据库文件
		const dbPath = await getSaveDatabasePath();
		const { exists, remove } = await import("@tauri-apps/plugin-fs");

		try {
			if (await exists(dbPath)) {
				await remove(dbPath);
			}
		} catch (error) {
			console.warn("删除数据库文件失败:", error);
		}

		// 4. 重新初始化数据库
		await initDatabase();
		return true;
	} catch (error) {
		console.error("❌ 重置数据库失败:", error);
		return false;
	}
};

/**
 * 更新单个记录的同步状态
 * @param id 记录ID
 * @param syncStatus 同步状态
 * @param isCloudData 是否为云端数据
 */
export const updateSyncStatus = async (
	id: string,
	syncStatus: "none" | "synced" | "syncing",
	isCloudData?: boolean,
) => {
	try {
		const updates: any = { id, syncStatus };

		if (isCloudData !== undefined) {
			updates.isCloudData = Number(isCloudData);
		}

		await updateSQL("history", updates);
		return true;
	} catch (error) {
		console.error(`❌ 更新同步状态失败: ${id}`, error);
		return false;
	}
};

/**
 * 批量更新同步状态
 * @param ids 记录ID数组
 * @param syncStatus 同步状态
 * @param isCloudData 是否为云端数据
 */
export const batchUpdateSyncStatus = async (
	ids: string[],
	syncStatus: "none" | "synced" | "syncing",
	isCloudData?: boolean,
) => {
	try {
		const updateData: any = { syncStatus };

		if (isCloudData !== undefined) {
			updateData.isCloudData = Number(isCloudData);
		}

		// 使用通用UPDATE函数的IN操作
		const placeholders = ids.map(() => "?").join(",");
		const whereSQL = `WHERE id IN (${placeholders})`;

		const updateKeys = Object.keys(updateData);
		const setSQL = updateKeys.map((key) => `${key} = ?`).join(", ");

		const setValues = updateKeys.map((key) => updateData[key]);

		await executeSQL(`UPDATE history SET ${setSQL} ${whereSQL}`, [
			...setValues,
			...ids,
		]);
		return true;
	} catch (error) {
		console.error("❌ 批量更新同步状态失败:", error);
		return false;
	}
};

/**
 * 获取待同步的记录
 * @param limit 限制数量
 */
export const getPendingSyncRecords = async (limit?: number) => {
	try {
		// 使用通用SELECT函数
		const records = await dbSelect(
			"history",
			{ syncStatus: "none" },
			"ORDER BY createTime DESC",
			limit,
		);

		return records;
	} catch (error) {
		console.error("❌ 获取待同步记录失败:", error);
		return [];
	}
};

/**
 * 批量删除剪贴板条目（使用统一的删除管理器）
 * @param ids 要删除的条目ID数组
 */
export const batchDeleteItems = async (ids: string[]) => {
	if (!ids || ids.length === 0) return { success: true, deletedCount: 0 };

	try {
		// 导入删除管理器
		const { deleteManager } = await import("@/utils/deleteManager");

		// 先获取要删除的条目信息，以便找出所有相关重复条目
		const itemsToDelete = (await executeSQL(
			`SELECT * FROM history WHERE id IN (${ids.map(() => "?").join(",")})`,
			ids,
		)) as any[];

		// 找出所有需要删除的ID（包括重复条目）
		const allIdsToDelete = new Set<string>();

		for (const item of itemsToDelete) {
			allIdsToDelete.add(item.id);

			// 对于文件和图片类型，删除所有相同路径的条目（不管类型）
			if (item.type === "files" || item.type === "image") {
				let filePath = item.value;

				// 如果是files类型，尝试从JSON中提取文件路径
				if (item.type === "files" && item.value?.startsWith("[")) {
					try {
						const filePaths = JSON.parse(item.value);
						filePath = filePaths[0];
					} catch {
						// 解析失败，使用原值
					}
				}

				// 查找所有相同文件路径的条目
				const duplicateItems = (await executeSQL(
					`SELECT id FROM history WHERE (type = "files" OR type = "image") AND deleted = 0 AND (
						value = ? OR
						value LIKE ? OR
						? LIKE value
					)`,
					[
						filePath,
						`%"${filePath.replace(/\\/g, "/")}%`,
						`${filePath.replace(/\\/g, "/")}%`,
					],
				)) as any[];

				// 将所有重复条目也加入删除列表
				for (const duplicate of duplicateItems) {
					allIdsToDelete.add(duplicate.id);
				}
			}
		}

		// 使用删除管理器执行批量删除
		const result = await deleteManager.deleteItems(Array.from(allIdsToDelete));

		// 转换结果格式以保持向后兼容
		if (!result.success) {
			return {
				success: false,
				deletedCount: result.deletedCount,
				error: result.errors?.join("; ") ?? "删除失败",
			};
		}

		return {
			success: true,
			deletedCount: result.deletedCount,
		};
	} catch (error) {
		console.error("❌ 批量删除失败:", error);
		return { success: false, deletedCount: 0, error };
	}
};

/**
 * 批量收藏/取消收藏剪贴板条目
 * @param ids 要操作的条目ID数组
 * @param favorite 是否收藏，true为收藏，false为取消收藏
 * @param updateSyncStatus 是否更新同步状态，默认为true
 */
export const batchUpdateFavorite = async (
	ids: string[],
	favorite: boolean,
	updateSyncStatus = true,
) => {
	if (!ids || ids.length === 0) return { success: true, updatedCount: 0 };

	try {
		const favoriteValue = favorite ? 1 : 0;

		// 使用通用UPDATE函数进行批量更新
		const placeholders = ids.map(() => "?").join(",");
		const whereSQL = `WHERE id IN (${placeholders})`;

		// 根据参数决定是否更新同步状态，但不更新时间戳
		const syncStatusPart = updateSyncStatus ? ", syncStatus = 'pending'" : "";
		const sql = `UPDATE history SET favorite = ?${syncStatusPart} ${whereSQL}`;

		await executeSQL(sql, [favoriteValue, ...ids]);

		// 验证更新是否成功
		const verifyResult = await dbSelect("history", {
			id: { operator: "IN", values: ids },
			favorite: favoriteValue,
		});

		const updatedCount = verifyResult.length;

		if (updatedCount !== ids.length) {
			console.error("❌ 批量更新收藏状态部分失败", {
				expected: ids.length,
				actual: updatedCount,
			});
			return { success: false, updatedCount, error: "部分条目更新失败" };
		}

		return { success: true, updatedCount };
	} catch (error) {
		console.error("❌ 批量更新收藏状态失败:", error);
		return { success: false, updatedCount: 0, error };
	}
};

/**
 * 关闭数据库连接池
 */
export const closeDatabase = async () => {
	if (!db) return;

	await db.close();

	db = null;
};

/**
 * 获取全部字段
 * @param tableName 表名
 */
const getFields = async (tableName: TableName) => {
	const fields = await executeSQL(`PRAGMA table_info(${tableName})`);

	return fields as { name: string; type: string }[];
};

/**
 * 获取所有历史数据（过滤已删除项）
 */
export const getHistoryData = async (includeDeleted = false) => {
	// 使用通用SELECT函数
	const whereConditions = includeDeleted ? {} : { deleted: 0 };
	const result = await dbSelect(
		"history",
		whereConditions,
		"ORDER BY createTime DESC",
	);

	// 同时检查数据库中的总数据状态
	const totalCount = (await executeSQL(
		"SELECT COUNT(*) as total FROM history;",
	)) as any[];
	const activeCount = (await executeSQL(
		"SELECT COUNT(*) as active FROM history WHERE deleted = 0;",
	)) as any[];

	// 如果数据量异常，进行详细检查
	if (totalCount[0]?.total > 50 || result.length !== activeCount[0]?.active) {
		const duplicateCheck = (await executeSQL(
			"SELECT id, COUNT(*) as count FROM history GROUP BY id HAVING COUNT(*) > 1;",
		)) as any[];
		if (duplicateCheck.length > 0) {
			console.warn("⚠️ 发现重复记录", duplicateCheck);
		}
	}

	return result;
};

// 导入日志回调函数
let importLogCallback: ((message: string, data?: any) => void) | null = null;

export const setImportLogCallback = (
	callback: (message: string, data?: any) => void,
) => {
	importLogCallback = callback;
};

const addImportLog = (message: string, data?: any) => {
	if (importLogCallback) {
		importLogCallback(message, data);
	}
};

/**
 * 设置历史数据（用于同步）
 */
export const setHistoryData = async (data: any[]) => {
	addImportLog(`开始同步导入 ${data.length} 条数据（带去重）`);
	addImportLog("导入数据样本", { sample: data.slice(0, 2) });

	// 确保数据库已初始化
	await initDatabase();

	if (!db) {
		addImportLog("❌ 数据库初始化失败");
		throw new Error("数据库初始化失败");
	}

	// 检查数据库是否被锁定，如果是，等待一段时间
	let retryCount = 0;
	const maxRetries = 3;
	const retryDelay = 1000;

	while (retryCount < maxRetries) {
		try {
			// 尝试一个简单的查询来测试数据库是否被锁定
			await db!.execute("SELECT 1");
			addImportLog("✅ 数据库连接正常");
			break;
		} catch (error) {
			retryCount++;
			addImportLog(`⚠️ 数据库可能被锁定，重试 ${retryCount}/${maxRetries}`);
			if (retryCount >= maxRetries) {
				addImportLog("❌ 数据库锁定重试次数已达上限");
				throw new Error(
					`数据库被锁定: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}

	// 使用事务确保数据一致性
	try {
		// 开始事务
		await db!.execute("BEGIN TRANSACTION;");

		// 清空现有数据
		await executeSQL("DELETE FROM history;");
		addImportLog("已清空现有数据");

		// 批量插入新数据 - 使用去重插入确保数据源级别去重
		let successCount = 0;
		let failCount = 0;
		const duplicateCount =
			data.length -
			new Set(data.map((item) => `${item.type}:${item.value}`)).size;

		if (duplicateCount > 0) {
			addImportLog(
				`📊 检测到 ${duplicateCount} 个重复项，将在数据库层面进行去重`,
			);
		}

		for (let i = 0; i < data.length; i++) {
			const item = data[i];
			let itemRetryCount = 0;
			const maxItemRetries = 3;

			while (itemRetryCount < maxItemRetries) {
				try {
					// 使用去重插入函数，确保相同 type 和 value 的内容只保存一条
					await insertWithDeduplication("history", item);
					successCount++;
					break; // 成功插入，跳出重试循环
				} catch (itemError) {
					itemRetryCount++;

					// 检查是否是数据库锁定错误
					const errorMessage =
						itemError instanceof Error ? itemError.message : String(itemError);
					const isDatabaseLocked =
						errorMessage.includes("database is locked") ||
						errorMessage.includes("database is locked");

					if (isDatabaseLocked && itemRetryCount < maxItemRetries) {
						addImportLog(
							`⚠️ 第 ${i + 1} 条数据插入时数据库锁定，重试 ${itemRetryCount}/${maxItemRetries}`,
						);
						await new Promise((resolve) => setTimeout(resolve, 200)); // 短暂延迟后重试
					} else {
						// 非锁定错误或重试次数已达上限
						failCount++;
						addImportLog(`❌ 插入第 ${i + 1} 条数据失败`, {
							error: errorMessage,
							item: `${JSON.stringify(item).substring(0, 100)}...`,
							retries: itemRetryCount,
						});
						break;
					}
				}
			}

			// 每10条记录打印一次进度
			if ((i + 1) % 10 === 0 || i === data.length - 1) {
				addImportLog(
					`插入进度: ${i + 1}/${data.length} 条数据 (成功: ${successCount}, 失败: ${failCount})`,
				);
			}
		}

		// 提交事务
		await db!.execute("COMMIT;");
		addImportLog("✅ 事务提交成功（已去重）", {
			success: successCount,
			failed: failCount,
			total: data.length,
			duplicatesRemoved: duplicateCount,
		});

		// 验证导入结果
		const verifyResult = await executeSQL(
			"SELECT COUNT(*) as count FROM history;",
		);
		addImportLog("验证数据库记录数", {
			actual: (verifyResult as any[])[0]?.count,
			expected: data.length - duplicateCount,
			duplicatesRemoved: duplicateCount,
		});
	} catch (error) {
		// 出错时回滚
		await db!.execute("ROLLBACK;");
		addImportLog("❌ 导入数据失败，事务已回滚", {
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
};

/**
 * 重命名字段
 * @param tableName 表名
 * @param field 字段名称
 * @param rename 重命名
 * @returns
 */
export const renameField = async (
	tableName: TableName,
	field: string,
	rename: string,
) => {
	const fields = await getFields(tableName);

	if (some(fields, { name: rename })) return;

	return executeSQL(
		`ALTER TABLE ${tableName} RENAME COLUMN ${field} TO ${rename};`,
	);
};

/**
 * 新增字段
 * @param tableName 表名
 * @param field 字段
 * @param type 类型
 */
export const addField = async (
	tableName: TableName,
	field: string,
	type: string,
) => {
	const fields = await getFields(tableName);

	if (some(fields, { name: field })) return;

	return executeSQL(`ALTER TABLE ${tableName} ADD COLUMN ${field} ${type};`);
};

/**
 * 清理数据库中的无效数据
 */
export const cleanupInvalidData = async () => {
	try {
		// 1. 检查并清理重复记录（保留最新的）
		const duplicates = (await executeSQL(
			"SELECT id, COUNT(*) as count FROM history GROUP BY id HAVING COUNT(*) > 1;",
		)) as any[];

		for (const duplicate of duplicates) {
			// 获取该ID的所有记录，按时间排序，保留最新的
			const records = (await executeSQL(
				"SELECT rowid, * FROM history WHERE id = ? ORDER BY createTime DESC, rowid DESC;",
				[duplicate.id],
			)) as any[];

			// 删除除第一条外的所有重复记录
			for (let i = 1; i < records.length; i++) {
				await executeSQL("DELETE FROM history WHERE rowid = ?;", [
					records[i].rowid,
				]);
			}
		}

		// 2. 清理空值记录
		const emptyRecords = (await executeSQL(
			`SELECT id FROM history WHERE (value IS NULL OR value = '') AND (search IS NULL OR search = '');`,
		)) as any[];

		for (const record of emptyRecords) {
			await executeSQL("DELETE FROM history WHERE id = ?;", [record.id]);
		}

		return true;
	} catch (error) {
		console.error("❌ 数据库清理失败", error);
		return false;
	}
};

/**
 * 重置数据库（保留表结构，清空所有数据）
 */
export const resetAllData = async () => {
	try {
		await executeSQL("DELETE FROM history;");
		await executeSQL("VACUUM;");
		return true;
	} catch (error) {
		console.error("❌ 数据库重置失败", error);
		return false;
	}
};

/**
 * 从数据库中彻底删除记录（物理删除）
 * @param tableName 表名称
 * @param ids 要删除的记录ID数组
 */
export const deleteFromDatabase = async (
	tableName: TableName,
	ids: string[],
) => {
	if (ids.length === 0) {
		return { success: 0, failed: 0, errors: [] as string[] };
	}

	const results = { success: 0, failed: 0, errors: [] as string[] };

	// 简化实现：不使用事务，直接逐个删除
	// 这样可以避免事务嵌套和状态管理问题
	for (const id of ids) {
		try {
			// 先获取记录信息，仅用于日志记录
			const records = (await executeSQL(
				`SELECT * FROM ${tableName} WHERE id = ?;`,
				[id],
			)) as any[];

			if (records.length > 0) {
				const record = records[0];

				// 注意：我们不再删除本地文件系统中的原始文件
				// 因为剪切板是复制操作，删除源文件容易导致原本的数据丢失
				// 我们只删除数据库记录和云端数据，保留本地文件系统中的原始文件
				if (record.type === "image" && record.value) {
					// 记录保留本地文件的信息，但不删除文件
					// biome-ignore lint/suspicious/noConsoleLog: 允许在关键文件保留操作时使用日志
					console.log(`📝 保留本地图片文件: ${record.value}`);
				}

				// 从数据库中彻底删除记录
				await executeSQL(`DELETE FROM ${tableName} WHERE id = ?;`, [id]);
				results.success++;
			} else {
				results.failed++;
				results.errors.push(`记录不存在: ${id}`);
			}
		} catch (error) {
			results.failed++;
			results.errors.push(
				`删除记录失败 (ID: ${id}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return results;
};

/**
 * 获取数据库统计信息和关键数据
 */
export const getDatabaseInfo = async () => {
	try {
		// 使用通用SELECT函数获取统计信息
		const totalCount = (await executeSQL(
			"SELECT COUNT(*) as total FROM history;",
		)) as any[];
		const activeCount = (await executeSQL(
			"SELECT COUNT(*) as active FROM history WHERE deleted = 0;",
		)) as any[];
		const deletedCount = (await executeSQL(
			"SELECT COUNT(*) as deleted FROM history WHERE deleted = 1;",
		)) as any[];
		const favoriteCount = (await executeSQL(
			"SELECT COUNT(*) as favorite FROM history WHERE favorite = 1 AND deleted = 0;",
		)) as any[];

		// 获取各类型记录数
		const typeCountResult = (await executeSQL(
			"SELECT type, COUNT(*) as count FROM history WHERE deleted = 0 GROUP BY type;",
		)) as any[];
		const typeCounts = typeCountResult.reduce((acc, item) => {
			acc[item.type] = item.count;
			return acc;
		}, {});

		// 获取同步状态统计
		const syncStatusResult = (await executeSQL(
			"SELECT syncStatus, COUNT(*) as count FROM history WHERE deleted = 0 GROUP BY syncStatus;",
		)) as any[];
		const syncStatusCounts = syncStatusResult.reduce((acc, item) => {
			acc[item.syncStatus || "none"] = item.count;
			return acc;
		}, {});

		// 使用通用SELECT函数获取最近10条记录
		const recentRecords = await dbSelect(
			"history",
			{ deleted: 0 },
			"ORDER BY createTime DESC",
			10,
		);

		// 获取数据库文件大小（如果可能）
		let dbSize = "未知";
		try {
			const { getSaveDatabasePath } = await import("@/utils/path");
			const { exists } = await import("@tauri-apps/plugin-fs");
			const dbPath = await getSaveDatabasePath();
			if (await exists(dbPath)) {
				// 由于metadata方法不可用，我们暂时显示为已知大小
				dbSize = "数据库文件存在";
			}
		} catch (_error) {
			// 忽略获取文件大小的错误
		}

		return {
			totalCount: totalCount[0]?.total || 0,
			activeCount: activeCount[0]?.active || 0,
			deletedCount: deletedCount[0]?.deleted || 0,
			favoriteCount: favoriteCount[0]?.favorite || 0,
			typeCounts,
			syncStatusCounts,
			recentRecords,
			dbSize,
		};
	} catch (error) {
		console.error("❌ 获取数据库信息失败:", error);
		return null;
	}
};
