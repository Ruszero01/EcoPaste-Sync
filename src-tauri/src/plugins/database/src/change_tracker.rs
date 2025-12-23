//! 数据库内部状态跟踪器
//! 自动跟踪6种类型的字段变更

use std::collections::HashSet;
use std::sync::Mutex;

/// 数据库内部状态跟踪器
/// 自动跟踪字段变更，支持以下6种变更类型：
/// - favorite: 收藏状态变更
/// - content: 内容变更
/// - type: 类型变更
/// - subtype: 子类型变更
/// - note: 备注变更
/// - file_hash: 文件哈希变更
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

    /// 标记项目为已变更
    pub fn mark_changed(&self, id: &str) {
        let mut items = self.changed_items.lock().unwrap();
        items.insert(id.to_string());
        log::debug!("🔔 状态跟踪器标记变更: {}", id);
    }

    /// 获取所有已变更的项目ID
    pub fn get_changed_items(&self) -> Vec<String> {
        let items = self.changed_items.lock().unwrap();
        items.iter().cloned().collect()
    }

    /// 清除指定项目的变更标记
    pub fn clear_changed(&self, id: &str) {
        let mut items = self.changed_items.lock().unwrap();
        items.remove(id);
    }

    /// 清空所有变更标记
    pub fn clear_all(&self) {
        let mut items = self.changed_items.lock().unwrap();
        items.clear();
    }

    /// 检查项目是否已变更
    pub fn is_changed(&self, id: &str) -> bool {
        let items = self.changed_items.lock().unwrap();
        items.contains(id)
    }

    /// 获取已变更项目数量
    pub fn count(&self) -> usize {
        let items = self.changed_items.lock().unwrap();
        items.len()
    }
}

impl Default for ChangeTracker {
    fn default() -> Self {
        Self::new()
    }
}
