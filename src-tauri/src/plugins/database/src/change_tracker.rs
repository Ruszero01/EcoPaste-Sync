//! 数据库内部状态跟踪器
//! 统一管理所有项目的变更跟踪和同步状态

use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;

/// 变更信息（用于事件通知）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeInfo {
    pub item_id: String,
    pub old_status: String,
    pub new_status: String,
    pub change_type: String,
}

/// 数据库内部状态跟踪器
/// 统一管理所有项目的变更跟踪和同步状态
/// 当数据发生任何变更时（内容、类型、收藏、备注等），统一更新状态和时间戳
#[derive(Debug)]
pub struct ChangeTracker {
    /// 存储已变更的项目ID
    changed_items: Mutex<HashSet<String>>,
}

impl ChangeTracker {
    /// 创建新的变更跟踪器
    pub fn new() -> Self {
        Self {
            changed_items: Mutex::new(HashSet::new()),
        }
    }

    /// 获取项目的当前同步状态
    fn get_current_sync_status(&self, conn: &Connection, item_id: &str) -> Result<String, String> {
        let status: String = conn
            .query_row(
                "SELECT syncStatus FROM history WHERE id = ?1",
                params![item_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "not_synced".to_string());

        Ok(status)
    }

    /// 统一的变更跟踪方法
    /// 当数据发生任何变更时，统一处理：
    /// 1. 更新时间戳
    /// 2. 如果当前状态是已同步，则更新为已更改
    /// 3. 记录变更
    /// 4. 返回变更信息供前端通知
    ///
    /// # Arguments
    /// * `conn` - 数据库连接
    /// * `item_id` - 项目ID
    /// * `change_type` - 变更类型（content, type, favorite, note等，用于日志记录）
    ///
    /// # Returns
    /// * `Ok(Some(ChangeInfo))` - 总是返回变更信息（因为任何变更都应该通知前端）
    /// * `Err(String)` - 数据库操作失败
    pub fn mark_item_changed(
        &self,
        conn: &Connection,
        item_id: &str,
        change_type: &str,
    ) -> Result<Option<ChangeInfo>, String> {
        let current_time = chrono::Utc::now().timestamp_millis();

        // 获取当前同步状态
        let current_status = self.get_current_sync_status(conn, item_id)?;

        // 更新数据库：先更新时间戳
        conn.execute(
            "UPDATE history SET time = ?1 WHERE id = ?2",
            params![current_time, item_id],
        )
        .map_err(|e| format!("更新时间戳失败: {}", e))?;

        // 如果当前状态是已同步，则更新为已更改
        let new_status = if current_status == "synced" {
            conn.execute(
                "UPDATE history SET syncStatus = ?1 WHERE id = ?2",
                params!["changed", item_id],
            )
            .map_err(|e| format!("更新同步状态失败: {}", e))?;

            log::info!("🔔 [{}] 项目已同步→已更改: {}", change_type, item_id);
            "changed".to_string()
        } else {
            log::debug!(
                "🔔 [{}] 项目状态: {}, 已更新戳",
                change_type,
                current_status
            );
            current_status.clone()
        };

        // 标记为已变更
        let mut items = self.changed_items.lock().unwrap();
        items.insert(item_id.to_string());

        // 总是返回变更信息（任何字段变更都应该通知前端）
        Ok(Some(ChangeInfo {
            item_id: item_id.to_string(),
            old_status: current_status,
            new_status,
            change_type: change_type.to_string(),
        }))
    }

    /// 标记项目为已同步（同步成功后调用）
    pub fn mark_item_synced(&self, conn: &Connection, item_id: &str) -> Result<(), String> {
        conn.execute(
            "UPDATE history SET syncStatus = ?1 WHERE id = ?2",
            params!["synced", item_id],
        )
        .map_err(|e| format!("标记已同步失败: {}", e))?;

        // 从变更列表中移除
        let mut items = self.changed_items.lock().unwrap();
        items.remove(item_id);

        log::info!("🔔 项目已同步: {}", item_id);

        Ok(())
    }

    /// 批量标记项目为已同步
    pub fn mark_items_synced(&self, conn: &Connection, item_ids: &[String]) -> Result<(), String> {
        for item_id in item_ids {
            self.mark_item_synced(conn, item_id)?;
        }
        Ok(())
    }

    /// 获取已变更项目的数量
    pub fn count(&self) -> usize {
        self.changed_items.lock().unwrap().len()
    }

    /// 获取所有已变更的项目ID
    pub fn get_changed_items(&self) -> Vec<String> {
        let items = self.changed_items.lock().unwrap();
        items.iter().cloned().collect()
    }

    /// 清空所有变更记录
    pub fn clear(&self) {
        let mut items = self.changed_items.lock().unwrap();
        items.clear();
    }

    /// 检查项目是否已变更
    pub fn is_changed(&self, item_id: &str) -> bool {
        let items = self.changed_items.lock().unwrap();
        items.contains(item_id)
    }
}
