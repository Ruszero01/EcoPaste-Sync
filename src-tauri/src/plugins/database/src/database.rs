//! 数据库管理器
//! 提供 SQLite 数据库的统一访问接口

use crate::config::{should_auto_sort, should_fetch_source_app};
use crate::filter::{BaseFilter, ContentTypeFilter, DataFilter, SyncModeFilter, SyncStatusFilter};
use crate::models::{
    DatabaseStatistics, HistoryItem, InsertItem, InsertResult, QueryOptions, SyncDataItem,
};
use crate::source_app::fetch_source_app_info_impl;
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
        let conn =
            Connection::open(&db_path_clone).map_err(|e| format!("打开数据库失败: {}", e))?;

        // 创建 history 表
        conn.execute_batch(
            r#"
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
                deleted INTEGER DEFAULT 0,
                syncStatus TEXT DEFAULT 'not_synced',
                sourceAppName TEXT,
                sourceAppIcon TEXT,
                position INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_history_deleted ON history(deleted);
            CREATE INDEX IF NOT EXISTS idx_history_favorite ON history(favorite);
            CREATE INDEX IF NOT EXISTS idx_history_syncStatus ON history(syncStatus);
            CREATE INDEX IF NOT EXISTS idx_history_time ON history(time);
        "#,
        )
        .map_err(|e| format!("创建数据库表失败: {}", e))?;

        self.db_path = Some(db_path.clone());
        self.initialized = true;

        log::info!("数据库管理器已初始化: {:?}", self.db_path);
        Ok(())
    }

    /// 获取数据库连接（公开方法，供外部使用）
    pub fn get_connection(&self) -> Result<Connection, String> {
        let path = self
            .db_path
            .as_ref()
            .ok_or_else(|| "数据库路径未设置".to_string())?;

        Connection::open(path).map_err(|e| format!("打开数据库失败: {}", e))
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
            // 默认使用 position 排序（后端根据 autoSort 设置决定是否更新 position）
            sql.push_str(" ORDER BY position DESC");
        }

        // 限制
        if let Some(limit) = options.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        // 偏移
        if let Some(offset) = options.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("准备查询失败: {}", e))?;

        // 构建查询参数
        let params: Vec<&str> = options
            .params
            .as_ref()
            .map(|p| p.iter().map(|s| s.as_str()).collect())
            .unwrap_or_default();

        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
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
                    deleted: row.get(12).ok(),
                    sync_status: row.get(13).ok(),
                    source_app_name: row.get(14).ok().flatten(),
                    source_app_icon: row.get(15).ok().flatten(),
                    position: row.get(16).ok().flatten(),
                })
            })
            .map_err(|e| format!("查询失败: {}", e))?;

        let mut items = Vec::new();
        for row in rows {
            match row {
                Ok(item) => items.push(item),
                Err(e) => log::warn!("解析行失败: {}", e),
            }
        }

        Ok(items)
    }

    /// 根据同步模式和数据状态筛选查询数据（供同步引擎内部使用）
    ///
    /// # Arguments
    /// * `only_favorites` - 是否仅同步收藏项
    /// * `include_images` - 是否包含图片
    /// * `include_files` - 是否包含文件
    /// * `content_types` - 内容类型筛选
    /// * `sync_status_filter` - 同步状态筛选（None=不过滤）
    pub fn query_for_sync(
        &self,
        only_favorites: bool,
        include_images: bool,
        include_files: bool,
        content_types: ContentTypeFilter,
        sync_status_filter: Option<SyncStatusFilter>,
    ) -> Result<Vec<SyncDataItem>, String> {
        // 构建筛选器
        let filter = DataFilter {
            base_filter: BaseFilter {
                only_favorites,
                exclude_deleted: false, // 同步需要包含已删除的项目
                content_types: content_types.clone(),
            },
            group_filter: None,
            search_filter: None,
            sync_filter: Some(SyncModeFilter {
                only_favorites,
                include_images,
                include_files,
                content_types,
            }),
            sync_status_filter,
        };

        let options = filter.to_query_options(None, None);
        log::info!(
            "🔍 查询SQL: where='{}'",
            options.where_clause.as_deref().unwrap_or("none")
        );
        let history_items = self.query_history(options)?;

        log::info!(
            "🔍 同步查询: only_favorites={}, include_images={}, include_files={}, 结果={}",
            only_favorites,
            include_images,
            include_files,
            history_items.len()
        );

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
        )
        .map_err(|e| format!("更新同步状态失败: {}", e))?;

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
        )
        .map_err(|e| format!("更新项目值失败: {}", e))?;

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
        conn.execute(&sql, params![value, id])
            .map_err(|e| format!("更新字段 {} 失败: {}", field, e))?;

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

        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
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

        let count = conn
            .execute(&sql, rusqlite::params_from_iter(params.iter()))
            .map_err(|e| format!("批量更新同步状态失败: {}", e))?;

        Ok(count)
    }

    /// 插入或更新历史记录（从云端同步下来的数据）
    ///
    /// # Arguments
    /// * `item` - 同步数据项
    pub fn upsert_from_cloud(&self, item: &SyncDataItem) -> Result<(), String> {
        let conn = self.get_connection()?;

        // 计算 count、width、height：从 JSON 提取 fileSize/width/height
        let (count, width, height) = match &item.value {
            Some(value) => {
                // 尝试解析 JSON 提取元数据
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                    if item.item_type == "image" {
                        // 图片类型：提取 fileSize、width、height
                        let count =
                            parsed.get("fileSize").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
                        let width =
                            parsed.get("width").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                        let height =
                            parsed.get("height").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                        (count, width, height)
                    } else if item.item_type == "files" {
                        // 文件类型：提取 fileSize 作为 count
                        let count =
                            parsed.get("fileSize").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
                        (count, 0, 0)
                    } else {
                        // 文本类型：计算字符数
                        (value.chars().count() as i32, 0, 0)
                    }
                } else {
                    // 非 JSON 格式，计算字符数
                    (value.chars().count() as i32, 0, 0)
                }
            }
            None => (1, 0, 0),
        };

        // 检查是否存在
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM history WHERE id = ?1",
                params![item.id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if exists {
            // 更新
            conn.execute(
                "UPDATE history SET
                    type = ?1, value = ?2, favorite = ?3, note = ?4,
                    syncStatus = ?5, deleted = ?6, time = ?7, count = ?8, subtype = ?9,
                    width = ?10, height = ?11
                WHERE id = ?12",
                params![
                    item.item_type,
                    item.value,
                    item.favorite,
                    item.note,
                    "synced",
                    0, // 🧹 云端数据不包含 deleted 字段，从云端同步的项目都是活跃的
                    item.time,
                    count,
                    item.subtype,
                    width,
                    height,
                    item.id,
                ],
            )
            .map_err(|e| format!("更新云端数据失败: {}", e))?;
        } else {
            // 插入
            conn.execute(
                "INSERT INTO history (id, type, value, favorite, note, time, syncStatus, deleted, count, subtype, width, height)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    item.id,
                    item.item_type,
                    item.value,
                    item.favorite,
                    item.note,
                    item.time,
                    "synced",
                    0, // 🧹 云端数据不包含 deleted 字段，从云端同步的项目都是活跃的
                    count,
                    item.subtype,
                    width,
                    height,
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

        conn.execute("UPDATE history SET deleted = 1 WHERE id = ?1", params![id])
            .map_err(|e| format!("标记删除失败: {}", e))?;

        Ok(())
    }

    /// 彻底删除项目（硬删除）
    /// 用于同步完成后清理本地删除标记
    ///
    /// # Arguments
    /// * `id` - 项目ID
    pub fn hard_delete(&self, id: &str) -> Result<(), String> {
        let conn = self.get_connection()?;

        conn.execute("DELETE FROM history WHERE id = ?1", params![id])
            .map_err(|e| format!("硬删除失败: {}", e))?;

        Ok(())
    }

    /// 获取统计信息
    pub fn get_statistics(&self) -> Result<DatabaseStatistics, String> {
        let conn = self.get_connection()?;

        let total: i32 = conn
            .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
            .unwrap_or(0);

        let active: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM history WHERE deleted IS NULL OR deleted = 0",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let synced: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM history WHERE syncStatus = 'synced'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

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
        let exists_by_id: bool = conn
            .query_row(
                "SELECT 1 FROM history WHERE id = ?1",
                params![item.id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if exists_by_id {
            // 如果ID已存在，判断是否为重复内容
            let existing_value: Option<String> = conn
                .query_row(
                    "SELECT value FROM history WHERE id = ?1",
                    params![item.id],
                    |row| row.get(0),
                )
                .unwrap_or(None);

            let is_duplicate =
                existing_value.as_ref() == Some(&item.value.clone().unwrap_or_default());

            if is_duplicate {
                // 如果内容和ID都相同，认为是重复操作，不执行任何操作
                return Ok(InsertResult {
                    is_update: false,
                    insert_id: None,
                });
            } else {
                // ID相同但内容不同，执行更新
                // 注意：codeLanguage 和 isCode 字段已移除，不再写入
                conn.execute(
                    "UPDATE history SET
                        type = ?1, value = ?2, search = ?3, count = ?4,
                        width = ?5, height = ?6, favorite = ?7,
                        time = ?8, note = ?9, subtype = ?10,
                        deleted = ?11, syncStatus = ?12,
                        sourceAppName = ?13, sourceAppIcon = ?14, position = ?15
                    WHERE id = ?16",
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
                        item.deleted.unwrap_or(0),
                        item.sync_status
                            .clone()
                            .unwrap_or_else(|| "not_synced".to_string()),
                        item.source_app_name,
                        item.source_app_icon,
                        item.position.unwrap_or(0),
                        item.id,
                    ],
                )
                .map_err(|e| format!("更新数据失败: {}", e))?;

                // 使用统一变更跟踪器
                let conn = self.get_connection()?;
                let _ = self
                    .change_tracker
                    .mark_item_changed(&conn, &item.id, "update");

                return Ok(InsertResult {
                    is_update: true,
                    insert_id: Some(item.id.clone()),
                });
            }
        }

        // 检查是否已存在相同内容
        // 统一使用 search 字段去重：
        // - 颜色类型：基于 RGB 向量容差去重（颜色转换可能有精度损失）
        // - 格式文本：使用 search（纯文本版本），粘贴纯文本时能识别相同内容
        // - 普通文本：search 等于 value，效果相同
        let item_type_str = item.item_type.as_deref().unwrap_or("text");
        let existing_id: Option<String> = if item.subtype.as_deref() == Some("color")
            && item.search.is_some()
        {
            // 颜色类型：基于 RGB 向量容差去重
            let new_search = item.search.as_deref().unwrap_or("");
            let mut stmt = conn.prepare(
                "SELECT id, search FROM history WHERE type = ?1 AND subtype = 'color' AND deleted = 0",
            ).map_err(|e| format!("查询颜色记录失败: {}", e))?;
            let mut rows = stmt
                .query(params![item_type_str])
                .map_err(|e| format!("查询颜色记录失败: {}", e))?;
            let mut color_records: Vec<(String, String)> = Vec::new();
            while let Some(row) = rows
                .next()
                .map_err(|e| format!("读取颜色记录失败: {}", e))?
            {
                if let (Ok(id), Ok(search)) = (row.get(0), row.get(1)) {
                    color_records.push((id, search));
                }
            }
            tauri_plugin_eco_detector::find_similar_color(new_search, &color_records)
        } else if item.search.is_some() {
            // 其他类型：基于 search 字段精确匹配
            conn.query_row(
                "SELECT id FROM history WHERE type = ?1 AND search = ?2 AND deleted = 0 LIMIT 1",
                params![item_type_str, item.search.as_deref().unwrap_or("")],
                |row| row.get(0),
            )
            .unwrap_or(None)
        } else {
            // Fallback: 基于 value 去重（兼容没有 search 字段的类型）
            conn.query_row(
                "SELECT id FROM history WHERE type = ?1 AND value = ?2 AND deleted = 0 LIMIT 1",
                params![item_type_str, item.value.as_deref().unwrap_or("")],
                |row| row.get(0),
            )
            .unwrap_or(None)
        };

        if let Some(existing_id) = existing_id {
            // 如果存在相同内容的记录，更新该记录
            // 使用后端当前时间，确保时间戳准确性
            let current_time = chrono::Utc::now().timestamp_millis();

            // 根据自动排序设置决定是否更新 position
            // 自动排序开启：更新 position 为新最大值（移动到顶部）
            // 自动排序关闭：保持原有 position 不变（不更新 position 字段）
            let auto_sort = should_auto_sort();

            if auto_sort {
                // 获取新的 max_position 并更新
                let max_position: i32 = conn
                    .query_row(
                        "SELECT COALESCE(MAX(position), 0) FROM history",
                        params![],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                conn.execute(
                    "UPDATE history SET time = ?1, position = ?2 WHERE id = ?3",
                    params![current_time, max_position + 1, existing_id],
                )
                .map_err(|e| format!("更新相同内容失败: {}", e))?;
            } else {
                // 只更新 time，position 保持不变（不更新该字段）
                conn.execute(
                    "UPDATE history SET time = ?1 WHERE id = ?2",
                    params![current_time, existing_id],
                )
                .map_err(|e| format!("更新相同内容失败: {}", e))?;
            }

            // 使用统一变更跟踪器
            let conn = self.get_connection()?;
            let _ = self
                .change_tracker
                .mark_item_changed(&conn, &existing_id, "dedup");

            return Ok(InsertResult {
                is_update: true,
                insert_id: Some(existing_id),
            });
        }

        // 获取最大position，用于手动排序模式
        let max_position: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), 0) FROM history",
                params![],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // 新记录，根据配置获取来源应用信息
        let source_info = if should_fetch_source_app() {
            match fetch_source_app_info_impl() {
                Ok(info) => Some(info),
                Err(e) => {
                    log::warn!("获取来源应用信息失败: {}", e);
                    None
                }
            }
        } else {
            None
        };

        conn.execute(
            "INSERT INTO history (
                id, type, [group], value, search, count,
                width, height, favorite, time, note, subtype,
                deleted,
                syncStatus,
                sourceAppName, sourceAppIcon, position
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11, ?12,
                ?13,
                ?14,
                ?15, ?16, ?17
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
                item.deleted.unwrap_or(0),
                item.sync_status
                    .clone()
                    .unwrap_or_else(|| "not_synced".to_string()),
                source_info.as_ref().map(|s| s.app_name.clone()),
                source_info.as_ref().and_then(|s| s.app_icon.clone()),
                max_position + 1,
            ],
        )
        .map_err(|e| format!("插入数据失败: {}", e))?;

        // 使用统一变更跟踪器
        let conn = self.get_connection()?;
        let _ = self
            .change_tracker
            .mark_item_changed(&conn, &item.id, "insert");

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
    pub fn set_database_path(
        &mut self,
        save_data_dir: String,
        app_name: String,
        is_dev: bool,
    ) -> Result<(), String> {
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
