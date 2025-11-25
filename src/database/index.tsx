import type { TableName, TablePayload } from "@/types/database";
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
		// 如果没有syncStatus，默认为'none'
		syncStatus: item.syncStatus || "none",
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
 * 同步专用的去重插入函数（基于ID的智能去重）
 * @param tableName 表名称
 * @param payload 插入的数据
 */
export const insertWithDeduplicationForSync = async (
	tableName: TableName,
	payload: TablePayload,
) => {
	const { id } = payload;

	if (!id) {
		// 如果没有ID，使用原有的去重逻辑
		return await insertWithDeduplication(tableName, payload, "sync");
	}

	try {
		// 检查是否已存在相同ID的记录
		const existingRecords = (await executeSQL(
			`SELECT id, deleted FROM ${tableName} WHERE id = ?;`,
			[id],
		)) as any[];

		if (existingRecords.length > 0) {
			const existing = existingRecords[0];

			if (existing.deleted === 1) {
				return;
			}
			// 如果记录存在且未被删除，则更新它
			const { updateSQL } = await import("@/database");
			await updateSQL(tableName, payload);
			return;
		}
		// 如果记录不存在，则插入新记录
		const { keys, values } = handlePayload(payload);
		const refs = map(values, () => "?");

		await executeSQL(
			`INSERT INTO ${tableName} (${keys}) VALUES (${refs});`,
			values,
		);
		return;
	} catch (error) {
		console.error(`❌ 同步插入失败: ${id}`, error);
		throw error;
	}
};

/**
 * 去重插入的 sql 语句（先删除相同内容的记录，再插入新记录）
 * @param tableName 表名称
 * @param payload 插入的数据
 * @param identifier 去重标识（默认使用 type + value）
 */
export const insertWithDeduplication = async (
	tableName: TableName,
	payload: TablePayload,
	_identifier = "default",
) => {
	// 如果是 history 表，进行基于 value 的去重（智能处理文件类型变化）
	if (tableName === "history") {
		const { type, value, group } = payload;

		// 对于图片和文件类型，基于文件路径进行智能去重（支持跨类型去重）
		if (type === "image" || type === "files") {
			if (value !== undefined) {
				let filePath = value;

				// 如果是files类型，尝试从JSON中提取文件路径
				if (type === "files" && value.startsWith("[")) {
					try {
						const filePaths = JSON.parse(value);
						filePath = filePaths[0]; // 使用第一个文件路径
					} catch {
						// 解析失败，使用原值
					}
				}

				// 标准化路径格式，确保一致的比较
				const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/");
				const normalizedValue = value.toLowerCase().replace(/\\/g, "/");

				// 查找所有相同文件路径的记录（使用LIKE匹配以处理路径格式差异）
				const pathPattern1 = `%${normalizedPath}%`;
				const pathPattern2 = `%${normalizedValue}%`;

				// 删除所有相同文件路径的记录（不管是files还是image类型），但只删除未删除的记录
				const deleteSQL1 = `DELETE FROM ${tableName} WHERE LOWER(REPLACE(value, '\\', '/')) LIKE ? AND type = "files" AND deleted = 0;`;
				const deleteSQL2 = `DELETE FROM ${tableName} WHERE LOWER(REPLACE(value, '\\', '/')) LIKE ? AND type = "image" AND deleted = 0;`;

				await executeSQL(deleteSQL1, [pathPattern1]);
				await executeSQL(deleteSQL2, [pathPattern1]);

				// 对于files类型，如果原始value与提取的路径不同，也要匹配原始value
				if (type === "files" && normalizedValue !== normalizedPath) {
					await executeSQL(deleteSQL1, [pathPattern2]);
					await executeSQL(deleteSQL2, [pathPattern2]);
				}

				// 也检查是否有text类型记录包含相同文件路径，但只删除未删除的记录
				const textRecords = (await executeSQL(
					`SELECT id FROM ${tableName} WHERE type = "text" AND LOWER(REPLACE(value, '\\', '/')) LIKE ? AND deleted = 0;`,
					[`%${normalizedPath}%`],
				)) as any[];

				if (textRecords.length > 0) {
					const deleteSQL3 = `DELETE FROM ${tableName} WHERE type = "text" AND LOWER(REPLACE(value, '\\', '/')) LIKE ? AND deleted = 0;`;
					await executeSQL(deleteSQL3, [`%${normalizedPath}%`]);
				}
			}
		} else {
			// 对于其他类型，使用原有的 type + value + group 去重逻辑
			const deleteKeys = [];
			const deleteValues = [];

			if (type !== undefined) {
				deleteKeys.push("type = ?");
				deleteValues.push(type);
			}
			if (value !== undefined) {
				deleteKeys.push("value = ?");
				deleteValues.push(value);
			}
			if (group !== undefined) {
				deleteKeys.push("[group] = ?");
				deleteValues.push(group);
			}

			if (deleteKeys.length > 0) {
				// 只删除未删除的记录，保留软删除的记录
				const deleteSQL = `DELETE FROM ${tableName} WHERE ${deleteKeys.join(" AND ")} AND deleted = 0;`;
				await executeSQL(deleteSQL, deleteValues);
			}
		}
	}

	// 插入新记录
	const { keys, values } = handlePayload(payload);
	const refs = map(values, () => "?");

	// 使用 INSERT OR REPLACE 确保原子性操作，避免UNIQUE约束冲突
	return executeSQL(
		`INSERT OR REPLACE INTO ${tableName} (${keys}) VALUES (${refs});`,
		values,
	);
};

/**
 * 更新的 sql 语句
 * @param tableName 表名称
 * @param payload 修改的数据
 */
export const updateSQL = (tableName: TableName, payload: TablePayload) => {
	const { id, ...rest } = payload;

	const { keys, values } = handlePayload(rest);

	if (keys.length === 0) return;

	const setClause = map(keys, (item) => `${item} = ?`);

	return executeSQL(
		`UPDATE ${tableName} SET ${setClause} WHERE id = ?;`,
		values.concat(id!),
	);
};

/**
 * 删除的 sql 语句（软删除）
 * @param tableName 表名称
 * @param item 删除的数据项
 */
export const deleteSQL = async (tableName: TableName, item: TablePayload) => {
	const { id, type, value } = item;

	// 使用软删除：更新 deleted 标记而不是真正删除
	await executeSQL(`UPDATE ${tableName} SET deleted = 1 WHERE id = ?;`, [id]);

	// 验证软删除是否成功
	const verifyResult = (await executeSQL(
		`SELECT COUNT(*) as count FROM ${tableName} WHERE id = ? AND deleted = 1;`,
		[id],
	)) as any[];

	// 检查软删除是否真的成功
	if (verifyResult.length > 0 && verifyResult[0].count === 0) {
		console.error("❌ 软删除失败", { id, verifyResult });
		throw new Error(`Failed to soft delete record with id: ${id}`);
	}

	// 注意：我们不再删除本地文件系统中的原始文件
	// 因为剪切板是复制操作，删除源文件容易导致原本的数据丢失
	// 我们只删除数据库记录和云端数据，保留本地文件系统中的原始文件
	if (type === "image" && value) {
		// biome-ignore lint/suspicious/noConsoleLog: 允许在关键文件保留操作时使用日志
		console.log(`📝 保留本地图片文件: ${value}`);
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
 * 清空历史记录表
 */
export const clearHistoryTable = async () => {
	try {
		await executeSQL("DELETE FROM history;");
		// 重置自增ID（如果有的话）
		await executeSQL("VACUUM;");
		return true;
	} catch (error) {
		console.error("❌ 清空历史记录表失败:", error);
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
		const placeholders = ids.map(() => "?").join(",");
		const updates = [`syncStatus = '${syncStatus}'`];

		if (isCloudData !== undefined) {
			updates.push(`isCloudData = ${Number(isCloudData)}`);
		}

		await executeSQL(
			`UPDATE history SET ${updates.join(", ")} WHERE id IN (${placeholders})`,
			ids,
		);
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
		const limitClause = limit ? `LIMIT ${limit}` : "";

		const records = (await executeSQL(
			`SELECT * FROM history WHERE syncStatus = 'none' ORDER BY createTime DESC ${limitClause}`,
		)) as any[];

		return records.map((item: any) => ({
			...item,
			favorite: Boolean(item.favorite),
			deleted: Boolean(item.deleted),
			lazyDownload: Boolean(item.lazyDownload),
			isCloudData: Boolean(item.isCloudData),
			isCode: Boolean(item.isCode),
			syncStatus: item.syncStatus || "none",
		}));
	} catch (error) {
		console.error("❌ 获取待同步记录失败:", error);
		return [];
	}
};

/**
 * 重置整个数据库（删除并重新创建）
 */
export const resetDatabase = async () => {
	try {
		// 关闭当前数据库连接
		if (db) {
			await db.close();
			db = null;
		}

		// 删除数据库文件
		const dbPath = await getSaveDatabasePath();
		const { exists, remove } = await import("@tauri-apps/plugin-fs");

		if (await exists(dbPath)) {
			await remove(dbPath);
		}

		// 重新初始化数据库
		await initDatabase();
		return true;
	} catch (error) {
		console.error("❌ 重置数据库失败:", error);
		return false;
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
	// 根据参数决定是否包含已删除项
	let result: any[];

	if (includeDeleted) {
		// 获取所有数据，包括已删除项
		const rawData = (await executeSQL(
			"SELECT * FROM history ORDER BY createTime DESC;",
		)) as any[];

		// 转换integer字段为boolean
		result = rawData.map((item: any) => ({
			...item,
			favorite: Boolean(item.favorite),
			deleted: Boolean(item.deleted),
			lazyDownload: Boolean(item.lazyDownload),
			isCloudData: Boolean(item.isCloudData),
			isCode: Boolean(item.isCode),
			syncStatus: item.syncStatus || "none", // 确保有默认值
		}));
	} else {
		// 只获取未删除项
		const rawData = (await executeSQL(
			"SELECT * FROM history WHERE deleted = 0 ORDER BY createTime DESC;",
		)) as any[];

		// 转换integer字段为boolean
		result = rawData.map((item: any) => ({
			...item,
			favorite: Boolean(item.favorite),
			deleted: Boolean(item.deleted),
			lazyDownload: Boolean(item.lazyDownload),
			isCloudData: Boolean(item.isCloudData),
			isCode: Boolean(item.isCode),
			syncStatus: item.syncStatus || "none", // 确保有默认值
		}));
	}

	// 同时检查数据库中的总数据状态
	const totalResult = (await executeSQL(
		`SELECT COUNT(*) as total FROM ${"history"};`,
	)) as any[];
	const activeResult = (await executeSQL(
		`SELECT COUNT(*) as active FROM ${"history"} WHERE deleted = 0;`,
	)) as any[];

	// 如果数据量异常，进行详细检查
	if (totalResult[0]?.total > 50 || result.length !== activeResult[0]?.active) {
		const duplicateCheck = (await executeSQL(
			`SELECT id, COUNT(*) as count FROM ${"history"} GROUP BY id HAVING COUNT(*) > 1;`,
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

	try {
		// 使用事务确保删除操作的原子性
		await executeSQL("BEGIN TRANSACTION;");

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

		// 提交事务
		await executeSQL("COMMIT;");
	} catch (error) {
		// 出错时回滚
		await executeSQL("ROLLBACK;");
		results.failed = ids.length;
		results.errors = [
			`事务执行失败: ${error instanceof Error ? error.message : String(error)}`,
		];
	}

	return results;
};
