//! 删除管理器模块
//!
//! 提供统一的删除逻辑，根据同步状态决定删除策略：
//! - 已同步 (sync_status == "synced")：软删除，标记 deleted=1，等待云端同步时删除
//! - 未同步 (sync_status != "synced")：硬删除，直接从数据库删除

use crate::DatabaseManager;
use serde::{Deserialize, Serialize};

/// 删除结果结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub success: bool,
    pub deleted_count: usize,
    #[serde(default)]
    pub soft_deleted_ids: Vec<String>,
    #[serde(default)]
    pub hard_deleted_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<String>,
}

impl DeleteResult {
    /// 创建成功结果
    pub fn success(soft_count: usize, hard_count: usize) -> Self {
        Self {
            success: true,
            deleted_count: soft_count + hard_count,
            soft_deleted_ids: Vec::new(),
            hard_deleted_ids: Vec::new(),
            errors: Vec::new(),
        }
    }

    /// 检查是否成功
    pub fn is_success(&self) -> bool {
        self.errors.is_empty()
    }
}

/// 删除策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteStrategy {
    /// 根据同步状态自动判断
    Auto,
    /// 强制软删除
    Soft,
    /// 强制硬删除
    Hard,
}

impl DeleteStrategy {
    /// 从选项转换为策略
    pub fn from_option(hard_delete: Option<bool>) -> Self {
        match hard_delete {
            Some(true) => Self::Hard,
            Some(false) => Self::Soft,
            None => Self::Auto,
        }
    }
}

/// 删除管理器
pub struct DeleteManager;

impl DeleteManager {
    /// 删除项目（支持单个或批量）
    ///
    /// # Arguments
    /// * `db` - 数据库管理器
    /// * `ids` - 要删除的项目ID列表
    /// * `strategy` - 删除策略
    ///
    /// # Returns
    /// 删除结果
    pub fn delete_items(
        db: &mut DatabaseManager,
        ids: &[String],
        strategy: DeleteStrategy,
    ) -> Result<DeleteResult, String> {
        if ids.is_empty() {
            return Ok(DeleteResult {
                success: true,
                deleted_count: 0,
                soft_deleted_ids: Vec::new(),
                hard_deleted_ids: Vec::new(),
                errors: Vec::new(),
            });
        }

        let conn = db.get_connection()?;
        let current_time = chrono::Utc::now().timestamp_millis();

        let mut soft_deleted_ids = Vec::<String>::new();
        let mut hard_deleted_ids = Vec::<String>::new();
        let mut errors = Vec::<String>::new();

        // 查询每个项目的同步状态
        let placeholders: String = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "SELECT id, syncStatus FROM history WHERE id IN ({})",
            placeholders
        );
        log::debug!("批量删除查询SQL: {}, 参数数量: {}", query, ids.len());

        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

        // 将 Vec<String> 转换为 Vec<&str> 以正确绑定参数
        let params: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| e.to_string())?;

        // 构建 ID 到同步状态的映射
        let mut sync_status_map: std::collections::HashMap<String, Option<String>> =
            std::collections::HashMap::new();
        for row in rows {
            match row {
                Ok((id, status)) => {
                    sync_status_map.insert(id, status);
                }
                Err(e) => {
                    log::warn!("查询同步状态失败: {}", e);
                }
            }
        }

        // 根据策略决定每个项目的删除方式
        for id in ids {
            match Self::delete_single_item(db, &conn, id, &sync_status_map, strategy, current_time)
            {
                Ok(DeleteType::Soft) => soft_deleted_ids.push(id.clone()),
                Ok(DeleteType::Hard) => hard_deleted_ids.push(id.clone()),
                Err(e) => errors.push(format!("删除 {} 失败: {}", id, e)),
            }
        }

        Ok(DeleteResult {
            success: errors.is_empty(),
            deleted_count: soft_deleted_ids.len() + hard_deleted_ids.len(),
            soft_deleted_ids,
            hard_deleted_ids,
            errors,
        })
    }

    /// 删除单个项目
    fn delete_single_item(
        db: &mut DatabaseManager,
        conn: &rusqlite::Connection,
        id: &str,
        sync_status_map: &std::collections::HashMap<String, Option<String>>,
        strategy: DeleteStrategy,
        current_time: i64,
    ) -> Result<DeleteType, String> {
        // 根据策略确定删除类型
        let delete_type = match strategy {
            DeleteStrategy::Hard => DeleteType::Hard,
            DeleteStrategy::Soft => DeleteType::Soft,
            DeleteStrategy::Auto => {
                let sync_status = sync_status_map
                    .get(id)
                    .and_then(|s| s.as_deref())
                    .unwrap_or("not_synced");

                if sync_status == "synced" {
                    DeleteType::Soft
                } else {
                    DeleteType::Hard
                }
            }
        };

        // 执行删除
        match delete_type {
            DeleteType::Soft => {
                // 软删除：标记 deleted = 1，更新时间，标记变更跟踪
                db.update_field(id, "deleted", "1")?;
                db.update_field(id, "time", &current_time.to_string())?;
                db.get_change_tracker()
                    .mark_item_changed(&conn, id, "delete")?;
                Ok(DeleteType::Soft)
            }
            DeleteType::Hard => {
                // 硬删除：直接从数据库删除
                db.hard_delete(id)?;
                Ok(DeleteType::Hard)
            }
        }
    }

    /// 批量软删除（仅更新 deleted 字段和时间戳）
    pub fn batch_soft_delete(db: &mut DatabaseManager, ids: &[String]) -> Result<usize, String> {
        if ids.is_empty() {
            return Ok(0);
        }

        let conn = db.get_connection()?;
        let current_time = chrono::Utc::now().timestamp_millis();

        let placeholders: String = ids.iter().map(|_| "?").collect();
        let query = format!(
            "UPDATE history SET deleted = 1, time = ? WHERE id IN ({})",
            placeholders
        );

        // 构建参数：时间戳 + 所有ID
        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&current_time];
        for id in ids {
            params.push(id);
        }

        let count = conn
            .execute(&query, rusqlite::params_from_iter(params))
            .map_err(|e| format!("批量软删除失败: {}", e))?;

        // 标记变更跟踪器
        for id in ids {
            if let Err(e) = db
                .get_change_tracker()
                .mark_item_changed(&conn, id, "delete")
            {
                log::warn!("标记变更跟踪失败: {}", e);
            }
        }

        Ok(count)
    }

    /// 批量硬删除（直接从数据库删除）
    pub fn batch_hard_delete(db: &mut DatabaseManager, ids: &[String]) -> Result<usize, String> {
        if ids.is_empty() {
            return Ok(0);
        }

        let conn = db.get_connection()?;

        // 使用 push_str 构建占位符，避免 collect 的特殊处理
        let mut placeholders = String::new();
        for _ in ids {
            placeholders.push_str("?,");
        }
        if !placeholders.is_empty() {
            placeholders.pop(); // 移除最后一个逗号
        }

        let query = format!("DELETE FROM history WHERE id IN ({})", placeholders);

        // 将 String slice 转换为 &dyn ToSql
        let params: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let count = conn
            .execute(&query, rusqlite::params_from_iter(params.iter().copied()))
            .map_err(|e| format!("批量硬删除失败: {}", e))?;

        Ok(count)
    }
}

/// 删除类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeleteType {
    Soft,
    Hard,
}
