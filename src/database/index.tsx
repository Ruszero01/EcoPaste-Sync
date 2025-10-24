import type { TableName, TablePayload } from "@/types/database";
import { exists, remove } from "@tauri-apps/plugin-fs";
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
			subtype TEXT
		);
        `);
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

		return `${key} = ?`;
	}).join(" AND ");

	const whereClause = clause ? `WHERE ${clause}` : "";

	const list = await executeSQL(
		`SELECT * FROM ${tableName} ${whereClause} ${orderBy};`,
		values,
	);

	return (list ?? []) as List;
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
	// 如果是 history 表，进行基于 type 和 value 的去重
	if (tableName === "history") {
		const { type, value, group } = payload;

		// 删除相同 type 和 value 的记录
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
			const deleteSQL = `DELETE FROM ${tableName} WHERE ${deleteKeys.join(" AND ")};`;
			await executeSQL(deleteSQL, deleteValues);
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
 * 删除的 sql 语句
 * @param tableName 表名称
 * @param id 删除数据的 id
 */
export const deleteSQL = async (tableName: TableName, item: TablePayload) => {
	const { id, type, value } = item;

	await executeSQL(`DELETE FROM ${tableName} WHERE id = ?;`, [id]);

	if (type !== "image" || !value) return;

	const path = resolveImagePath(value);
	const existed = await exists(path);

	if (!existed) return;

	return remove(resolveImagePath(value));
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
 * 获取所有历史数据
 */
export const getHistoryData = async () => {
	return selectSQL("history");
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
			actual: verifyResult[0]?.count,
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
