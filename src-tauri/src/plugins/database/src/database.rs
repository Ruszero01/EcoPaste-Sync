//! 数据库管理器
//! 提供 SQLite 数据库的统一访问接口

use crate::models::{HistoryItem, QueryOptions, SyncDataItem};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// 数据库管理器
pub struct DatabaseManager {
    /// 数据库路径
    db_path: Option<PathBuf>,
    /// 是否已初始化
    initialized: bool,
}

impl DatabaseManager {
    /// 创建新的数据库管理器
    pub fn new() -> Self {
        Self {
            db_path: None,
            initialized: false,
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

        // 创建 history 表
        conn.execute_batch(r#"
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
                isCloudData INTEGER DEFAULT 0,
                codeLanguage TEXT,
                isCode INTEGER DEFAULT 0,
                lastModified INTEGER,
                sourceAppName TEXT,
                sourceAppIcon TEXT,
                position INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_history_deleted ON history(deleted);
            CREATE INDEX IF NOT EXISTS idx_history_favorite ON history(favorite);
            CREATE INDEX IF NOT EXISTS idx_history_createTime ON history(createTime);
            CREATE INDEX IF NOT EXISTS idx_history_syncStatus ON history(syncStatus);
            CREATE INDEX IF NOT EXISTS idx_history_isCloudData ON history(isCloudData);
        "#).map_err(|e| format!("创建数据库表失败: {}", e))?;

        self.db_path = Some(db_path);
        self.initialized = true;
        log::info!("数据库管理器已初始化: {:?}", self.db_path);
        Ok(())
    }

    /// 获取数据库连接
    fn get_connection(&self) -> Result<Connection, String> {
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
            sql.push_str(" ORDER BY createTime DESC");
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
                create_time: row.get(9).unwrap_or_default(),
                note: row.get(10).ok(),
                subtype: row.get(11).ok(),
                lazy_download: row.get(12).ok(),
                file_size: row.get(13).ok(),
                file_type: row.get(14).ok(),
                deleted: row.get(15).ok(),
                sync_status: row.get(16).ok(),
                is_cloud_data: row.get(17).ok(),
                code_language: row.get::<_, Option<String>>(18).ok().flatten(),
                is_code: row.get::<_, Option<i32>>(19).ok().flatten(),
                last_modified: row.get::<_, Option<i64>>(20).ok().flatten(),
                source_app_name: row.get::<_, Option<String>>(21).ok().flatten(),
                source_app_icon: row.get::<_, Option<String>>(22).ok().flatten(),
                position: row.get::<_, Option<i32>>(23).ok().flatten(),
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
            order_by: Some("createTime DESC".to_string()),
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

        let create_time = chrono::DateTime::from_timestamp_millis(item.last_modified)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

        if exists {
            // 更新
            conn.execute(
                "UPDATE history SET
                    type = ?1, value = ?2, favorite = ?3, note = ?4,
                    syncStatus = ?5, deleted = ?6, lastModified = ?7, isCloudData = 1
                WHERE id = ?8",
                params![
                    item.item_type,
                    item.value,
                    if item.favorite { 1 } else { 0 },
                    item.note,
                    "synced",
                    0, // 🧹 云端数据不包含 deleted 字段，从云端同步的项目都是活跃的
                    item.last_modified,
                    item.id,
                ],
            ).map_err(|e| format!("更新云端数据失败: {}", e))?;
        } else {
            // 插入
            conn.execute(
                "INSERT INTO history (id, type, value, favorite, note, createTime, syncStatus, deleted, lastModified, isCloudData)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)",
                params![
                    item.id,
                    item.item_type,
                    item.value,
                    if item.favorite { 1 } else { 0 },
                    item.note,
                    create_time,
                    "synced",
                    0, // 🧹 云端数据不包含 deleted 字段，从云端同步的项目都是活跃的
                    item.last_modified,
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

/// 数据库统计信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DatabaseStatistics {
    pub total_items: usize,
    pub active_items: usize,
    pub synced_items: usize,
    pub favorite_items: usize,
}

/// 创建共享的数据库管理器
pub fn create_shared_manager() -> Arc<Mutex<DatabaseManager>> {
    Arc::new(Mutex::new(DatabaseManager::new()))
}
