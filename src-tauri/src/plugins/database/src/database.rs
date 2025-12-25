//! 数据库管理器
//! 提供 SQLite 数据库的统一访问接口

use crate::models::{HistoryItem, QueryOptions, SyncDataItem, InsertItem, InsertResult, DatabaseStatistics};
use crate::ChangeTracker;
use rusqlite::{params, Connection};
use std::path::PathBuf;

/// 数据库管理器
pub struct DatabaseManager {
    /// 数据库路径
    db_path: Option<PathBuf>,
    /// 是否已初始化
    initialized: bool,
    /// 内部状态跟踪器
    change_tracker: ChangeTracker,
}

impl DatabaseManager {
    /// 创建新的数据库管理器
    pub fn new() -> Self {
        Self {
            db_path: None,
            initialized: false,
            change_tracker: ChangeTracker::new(),
        }
    }

    /// 初始化数据库连接
    ///
    /// # Arguments
    /// * `db_path` - 数据库文件路径
    pub fn init(&mut self, db_path: PathBuf) -> Result<(), String> {
        // 先克隆路径用于创建连接
        let db_path_clone = db_path.clone();

        // 创建数据库连接并初始化表结构
        let conn = Connection::open(&db_path_clone)
            .map_err(|e| format!("打开数据库失败: {}", e))?;

        // 创建 history 表（包含所有字段）
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                type TEXT,
                [group] TEXT,
                value TEXT,
                search TEXT,
                count INTEGER DEFAULT 1,
                width INTEGER,
                height INTEGER,
                favorite INTEGER DEFAULT 0,
                time INTEGER DEFAULT 0,
                note TEXT,
                subtype TEXT,
                fileSize INTEGER,
                deleted INTEGER DEFAULT 0,
                syncStatus TEXT DEFAULT 'none',
                isCloudData INTEGER DEFAULT 0,
                codeLanguage TEXT,
                isCode INTEGER DEFAULT 0,
                sourceAppName TEXT,
                sourceAppIcon TEXT,
                position INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_history_deleted ON history(deleted);
            CREATE INDEX IF NOT EXISTS idx_history_favorite ON history(favorite);
            CREATE INDEX IF NOT EXISTS idx_history_syncStatus ON history(syncStatus);
            CREATE INDEX IF NOT EXISTS idx_history_isCloudData ON history(isCloudData);
            CREATE INDEX IF NOT EXISTS idx_history_time ON history(time);
        "#).map_err(|e| format!("创建数据库表失败: {}", e))?;

        // 检查并添加缺失的字段（向后兼容旧数据库）
        let mut stmt = conn.prepare("PRAGMA table_info(history)")
            .map_err(|e| format!("查询表结构失败: {}", e))?;

        let mut existing_columns = std::collections::HashSet::new();
        let mut rows = stmt.query([]).map_err(|e| format!("查询表结构失败: {}", e))?;
        while let Some(row) = rows.next().map_err(|e| format!("读取表结构失败: {}", e))? {
            let name: String = row.get(1).map_err(|e| format!("获取字段名失败: {}", e))?;
            existing_columns.insert(name);
        }

        // 需要迁移的字段列表
        let fields_to_migrate = [
            ("time", "INTEGER DEFAULT 0"),
            ("sourceAppName", "TEXT"),
            ("sourceAppIcon", "TEXT"),
            ("position", "INTEGER DEFAULT 0"),
        ];

        for (field_name, field_type) in fields_to_migrate {
            if !existing_columns.contains(field_name) {
                let sql = format!("ALTER TABLE history ADD COLUMN {} {}", field_name, field_type);
                conn.execute_batch(&sql)
                    .map_err(|e| format!("添加 {} 字段失败: {}", field_name, e))?;
            }
        }

        self.db_path = Some(db_path.clone());
        self.initialized = true;

        log::info!("数据库管理器已初始化: {:?}", self.db_path);
        Ok(())
    }

    /// 获取数据库连接（公开方法，供外部使用）
    pub fn get_connection(&self) -> Result<Connection, String> {
        let path = self.db_path.as_ref()
            .ok_or_else(|| "数据库路径未设置".to_string())?;

        Connection::open(path)
            .map_err(|e| format!("打开数据库失败: {}", e))
    }

    /// 检查是否已初始化
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// 获取数据库路径
    pub fn get_db_path(&self) -> Option<&PathBuf> {
        self.db_path.as_ref()
    }

    /// 获取内部状态跟踪器
    /// sync引擎通过此方法查询已变更的数据
    pub fn get_change_tracker(&self) -> &ChangeTracker {
        &self.change_tracker
    }

    /// 查询历史记录
    ///
    /// # Arguments
    /// * `options` - 查询选项
    pub fn query_history(&self, options: QueryOptions) -> Result<Vec<HistoryItem>, String> {
        let conn = self.get_connection()?;

        let mut sql = String::from("SELECT * FROM history WHERE 1=1");

        // 排除已删除
        if options.exclude_deleted {
            sql.push_str(" AND (deleted IS NULL OR deleted = 0)");
        }

        // 仅收藏
        if options.only_favorites {
            sql.push_str(" AND favorite = 1");
        }

        // 自定义条件
        if let Some(where_clause) = &options.where_clause {
            sql.push_str(&format!(" AND {}", where_clause));
        }

        // 排序
        if let Some(order_by) = &options.order_by {
            sql.push_str(&format!(" ORDER BY {}", order_by));
        } else {
            sql.push_str(" ORDER BY time DESC");
        }

        // 限制
        if let Some(limit) = options.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        // 偏移
        if let Some(offset) = options.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let mut stmt = conn.prepare(&sql)
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                item_type: row.get(1).ok(),
                group: row.get(2).ok(),
                value: row.get(3).ok(),
                search: row.get(4).ok(),
                count: row.get(5).ok(),
                width: row.get(6).ok(),
                height: row.get(7).ok(),
                favorite: row.get(8).unwrap_or(0),
                time: row.get(9).unwrap_or(0),
                note: row.get(10).ok(),
                subtype: row.get(11).ok(),
                file_size: row.get(12).ok(),
                deleted: row.get(13).ok(),
                sync_status: row.get(14).ok(),
                is_cloud_data: row.get(15).ok(),
                code_language: row.get::<_, Option<String>>(16).ok().flatten(),
                is_code: row.get::<_, Option<i32>>(17).ok().flatten(),
                source_app_name: row.get::<_, Option<String>>(18).ok().flatten(),
                source_app_icon: row.get::<_, Option<String>>(19).ok().flatten(),
                position: row.get::<_, Option<i32>>(20).ok().flatten(),
            })
        }).map_err(|e| format!("查询失败: {}", e))?;

        let mut items = Vec::new();
        for row in rows {
            match row {
                Ok(item) => items.push(item),
                Err(e) => log::warn!("解析行失败: {}", e),
            }
        }

        Ok(items)
    }

    /// 查询用于同步的数据
    ///
    /// # Arguments
    /// * `only_favorites` - 是否仅同步收藏项
    /// * `limit` - 限制数量
    pub fn query_sync_data(&self, only_favorites: bool, limit: Option<i32>) -> Result<Vec<SyncDataItem>, String> {
        let options = QueryOptions {
            only_favorites,
            exclude_deleted: false, // 同步需要包含已删除的项目
            limit,
            order_by: Some("time DESC".to_string()),
            ..Default::default()
        };

        let history_items = self.query_history(options)?;

        log::info!("查询到 {} 条历史记录 (only_favorites={})", history_items.len(), only_favorites);

        Ok(history_items.into_iter().map(SyncDataItem::from).collect())
    }

    /// 更新同步状态
    ///
    /// # Arguments
    /// * `id` - 项目ID
    /// * `status` - 新状态
    pub fn update_sync_status(&self, id: &str, status: &str) -> Result<(), String> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE history SET syncStatus = ?1 WHERE id = ?2",
            params![status, id],
        ).map_err(|e| format!("更新同步状态失败: {}", e))?;

        Ok(())
    }

    /// 更新项目的 value 字段
    ///
    /// # Arguments
    /// * `id` - 项目ID
    /// * `value` - 新的 value 值
    pub fn update_item_value(&self, id: &str, value: &str) -> Result<(), String> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE history SET value = ?1 WHERE id = ?2",
            params![value, id],
        ).map_err(|e| format!("更新项目值失败: {}", e))?;

        Ok(())
    }

    /// 通用更新字段方法
    ///
    /// # Arguments
    /// * `id` - 项目ID
    /// * `field` - 字段名
    /// * `value` - 字段值
    pub fn update_field(&self, id: &str, field: &str, value: &str) -> Result<(), String> {
        let conn = self.get_connection()?;

        let sql = format!("UPDATE history SET {} = ?1 WHERE id = ?2", field);
        conn.execute(
            &sql,
            params![value, id],
        ).map_err(|e| format!("更新字段 {} 失败: {}", field, e))?;

        Ok(())
    }

    /// 批量更新同步状态
    ///
    /// # Arguments
    /// * `ids` - 项目ID列表
    /// * `status` - 新状态
    pub fn batch_update_sync_status(&self, ids: &[String], status: &str) -> Result<usize, String> {
        if ids.is_empty() {
            return Ok(0);
        }

        let conn = self.get_connection()?;

        let placeholders: Vec<String> = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect();

        let sql = format!(
            "UPDATE history SET syncStatus = ?1 WHERE id IN ({})",
            placeholders.join(", ")
        );

        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&status];
        for id in ids {
            params.push(id);
        }

        let count = conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
            .map_err(|e| format!("批量更新同步状态失败: {}", e))?;

        Ok(count)
    }

    /// 插入或更新历史记录（从云端同步下来的数据）
    ///
    /// # Arguments
    /// * `item` - 同步数据项
    pub fn upsert_from_cloud(&self, item: &SyncDataItem) -> Result<(), String> {
        let conn = self.get_connection()?;

        // 检查是否存在
        let exists: bool = conn.query_row(
            "SELECT 1 FROM history WHERE id = ?1",
            params![item.id],
            |_| Ok(true),
        ).unwrap_or(false);

        if exists {
            // 更新
            conn.execute(
                "UPDATE history SET
                    type = ?1, value = ?2, favorite = ?3, note = ?4,
                    syncStatus = ?5, deleted = ?6, time = ?7, isCloudData = 1
                WHERE id = ?8",
                params![
                    item.item_type,
                    item.value,
                    item.favorite,
                    item.note,
                    "synced",
                    0, // 🧹 云端数据不包含 deleted 字段，从云端同步的项目都是活跃的
                    item.time,
                    item.id,
                ],
            ).map_err(|e| format!("更新云端数据失败: {}", e))?;
        } else {
            // 插入
            conn.execute(
                "INSERT INTO history (id, type, value, favorite, note, time, syncStatus, deleted, isCloudData)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
                params![
                    item.id,
                    item.item_type,
                    item.value,
                    item.favorite,
                    item.note,
                    item.time,
                    "synced",
                    0, // 🧹 云端数据不包含 deleted 字段，从云端同步的项目都是活跃的
                ],
            ).map_err(|e| format!("插入云端数据失败: {}", e))?;
        }

        Ok(())
    }

    /// 标记项目为已删除（软删除）
    ///
    /// # Arguments
    /// * `id` - 项目ID
    pub fn mark_deleted(&self, id: &str) -> Result<(), String> {
        let conn = self.get_connection()?;

        conn.execute(
            "UPDATE history SET deleted = 1 WHERE id = ?1",
            params![id],
        ).map_err(|e| format!("标记删除失败: {}", e))?;

        Ok(())
    }

    /// 彻底删除项目（硬删除）
    /// 用于同步完成后清理本地删除标记
    ///
    /// # Arguments
    /// * `id` - 项目ID
    pub fn hard_delete(&self, id: &str) -> Result<(), String> {
        let conn = self.get_connection()?;

        conn.execute(
            "DELETE FROM history WHERE id = ?1",
            params![id],
        ).map_err(|e| format!("硬删除失败: {}", e))?;

        Ok(())
    }

    /// 批量硬删除项目
    ///
    /// # Arguments
    /// * `ids` - 项目ID列表
    pub fn batch_hard_delete(&self, ids: &[String]) -> Result<usize, String> {
        if ids.is_empty() {
            return Ok(0);
        }

        let conn = self.get_connection().map_err(|e| e.to_string())?;

        let placeholders: String = ids.iter().map(|_| "?").collect();
        let query = format!("DELETE FROM history WHERE id IN ({})", placeholders);

        let mut statement = conn.prepare(&query).map_err(|e| e.to_string())?;
        let mut count = 0;

        for (i, id) in ids.iter().enumerate() {
            statement.execute(rusqlite::params![i as u32, id]).map_err(|e| e.to_string())?;
            count += 1;
        }

        Ok(count)
    }

    /// 获取统计信息
    pub fn get_statistics(&self) -> Result<DatabaseStatistics, String> {
        let conn = self.get_connection()?;

        let total: i32 = conn.query_row(
            "SELECT COUNT(*) FROM history",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let active: i32 = conn.query_row(
            "SELECT COUNT(*) FROM history WHERE deleted IS NULL OR deleted = 0",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let synced: i32 = conn.query_row(
            "SELECT COUNT(*) FROM history WHERE syncStatus = 'synced'",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let favorites: i32 = conn.query_row(
            "SELECT COUNT(*) FROM history WHERE favorite = 1 AND (deleted IS NULL OR deleted = 0)",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        Ok(DatabaseStatistics {
            total_items: total as usize,
            active_items: active as usize,
            synced_items: synced as usize,
            favorite_items: favorites as usize,
        })
    }

    /// 插入数据（带去重功能）
    ///
    /// # Arguments
    /// * `item` - 要插入的数据项
    pub fn insert_with_deduplication(&self, item: &InsertItem) -> Result<InsertResult, String> {
        let conn = self.get_connection()?;

        // 检查是否已存在（优先使用ID去重）
        let exists_by_id: bool = conn.query_row(
            "SELECT 1 FROM history WHERE id = ?1",
            params![item.id],
            |_| Ok(true),
        ).unwrap_or(false);

        if exists_by_id {
            // 如果ID已存在，判断是否为重复内容
            let existing_value: Option<String> = conn.query_row(
                "SELECT value FROM history WHERE id = ?1",
                params![item.id],
                |row| row.get(0),
            ).unwrap_or(None);

            let is_duplicate = existing_value.as_ref() == Some(&item.value.clone().unwrap_or_default());

            if is_duplicate {
                // 如果内容和ID都相同，认为是重复操作，不执行任何操作
                return Ok(InsertResult {
                    is_update: false,
                    insert_id: None,
                });
            } else {
                // ID相同但内容不同，执行更新
                conn.execute(
                    "UPDATE history SET
                        type = ?1, value = ?2, search = ?3, count = ?4,
                        width = ?5, height = ?6, favorite = ?7,
                        time = ?8, note = ?9, subtype = ?10,
                        fileSize = ?11,
                        deleted = ?12, syncStatus = ?13, isCloudData = ?14,
                        codeLanguage = ?15, isCode = ?16,
                        sourceAppName = ?17, sourceAppIcon = ?18, position = ?19
                    WHERE id = ?20",
                    params![
                        item.item_type,
                        item.value,
                        item.search,
                        item.count.unwrap_or(1),
                        item.width,
                        item.height,
                        item.favorite,
                        item.time,
                        item.note,
                        item.subtype,
                        item.file_size,
                        item.deleted.unwrap_or(0),
                        item.sync_status.clone().unwrap_or_else(|| "not_synced".to_string()),
                        item.is_cloud_data.unwrap_or(0),
                        item.code_language,
                        item.is_code.unwrap_or(0),
                        item.source_app_name,
                        item.source_app_icon,
                        item.position.unwrap_or(0),
                        item.id,
                    ],
                ).map_err(|e| format!("更新数据失败: {}", e))?;

                // 使用统一变更跟踪器
                let conn = self.get_connection()?;
                let _ = self.change_tracker.mark_item_changed(&conn, &item.id, "update");

                return Ok(InsertResult {
                    is_update: true,
                    insert_id: Some(item.id.clone()),
                });
            }
        }

        // 检查是否已存在相同内容（基于type + value组合）
        let existing_id: Option<String> = conn.query_row(
            "SELECT id FROM history WHERE type = ?1 AND value = ?2 AND deleted = 0 LIMIT 1",
            params![item.item_type, item.value],
            |row| row.get(0),
        ).unwrap_or(None);

        if let Some(existing_id) = existing_id {
            // 如果存在相同内容的记录，更新该记录
            conn.execute(
                "UPDATE history SET
                    [group] = ?1, search = ?2, count = ?3,
                    width = ?4, height = ?5, favorite = ?6,
                    time = ?7, note = ?8, subtype = ?9,
                    fileSize = ?10,
                    deleted = ?11, syncStatus = ?12, isCloudData = ?13,
                    codeLanguage = ?14, isCode = ?15,
                    sourceAppName = ?16, sourceAppIcon = ?17, position = ?18
                WHERE id = ?19",
                params![
                    item.group,
                    item.search,
                    item.count.unwrap_or(1),
                    item.width,
                    item.height,
                    item.favorite,
                    item.time,
                    item.note,
                    item.subtype,
                    item.file_size,
                    item.deleted.unwrap_or(0),
                    item.sync_status.clone().unwrap_or_else(|| "not_synced".to_string()),
                    item.is_cloud_data.unwrap_or(0),
                    item.code_language,
                    item.is_code.unwrap_or(0),
                    item.source_app_name,
                    item.source_app_icon,
                    item.position.unwrap_or(0),
                    existing_id,
                ],
            ).map_err(|e| format!("更新相同内容失败: {}", e))?;

            // 使用统一变更跟踪器
            let conn = self.get_connection()?;
            let _ = self.change_tracker.mark_item_changed(&conn, &existing_id, "dedup");

            return Ok(InsertResult {
                is_update: true,
                insert_id: Some(existing_id),
            });
        }

        // 获取最大position，用于手动排序模式
        let max_position: i32 = conn.query_row(
            "SELECT COALESCE(MAX(position), 0) FROM history",
            params![],
            |row| row.get(0),
        ).unwrap_or(0);

        // 插入新记录
        conn.execute(
            "INSERT INTO history (
                id, type, [group], value, search, count,
                width, height, favorite, time, note, subtype,
                fileSize, deleted,
                syncStatus, isCloudData, codeLanguage, isCode,
                sourceAppName, sourceAppIcon, position
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14,
                ?15, ?16, ?17, ?18,
                ?19, ?20, ?21
            )",
            params![
                item.id,
                item.item_type,
                item.group,
                item.value,
                item.search,
                item.count.unwrap_or(1),
                item.width,
                item.height,
                item.favorite,
                item.time,
                item.note,
                item.subtype,
                item.file_size,
                item.deleted.unwrap_or(0),
                item.sync_status.clone().unwrap_or_else(|| "not_synced".to_string()),
                item.is_cloud_data.unwrap_or(0),
                item.code_language,
                item.is_code.unwrap_or(0),
                item.source_app_name,
                item.source_app_icon,
                max_position + 1,
            ],
        ).map_err(|e| format!("插入数据失败: {}", e))?;

        // 使用统一变更跟踪器
        let conn = self.get_connection()?;
        let _ = self.change_tracker.mark_item_changed(&conn, &item.id, "insert");

        Ok(InsertResult {
            is_update: false,
            insert_id: Some(item.id.clone()),
        })
    }

    /// 设置数据库路径并初始化
    ///
    /// # Arguments
    /// * `save_data_dir` - 数据存储目录
    /// * `app_name` - 应用名称
    /// * `is_dev` - 是否为开发模式
    pub fn set_database_path(&mut self, save_data_dir: String, app_name: String, is_dev: bool) -> Result<(), String> {
        use std::path::Path;

        // 构建数据库文件名
        let db_extension = if is_dev { "dev.db" } else { "db" };
        let db_filename = format!("{}.{}", app_name, db_extension);

        // 构建完整路径
        let db_path = Path::new(&save_data_dir).join(db_filename);
        let db_path_buf = PathBuf::from(db_path);

        log::info!("设置数据库路径: {:?}", db_path_buf);

        self.init(db_path_buf)
    }
}

impl Default for DatabaseManager {
    fn default() -> Self {
        Self::new()
    }
}
