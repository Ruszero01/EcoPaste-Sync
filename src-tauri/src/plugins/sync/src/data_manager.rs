//! 数据管理器模块
//! 负责本地和云端数据的缓存和筛选
//! 注意：同步状态管理已统一到 database/src/change_tracker.rs
//! 此模块不再维护同步状态，只做数据缓存

use crate::sync_core::SyncDataItem;
use std::sync::Arc;
use tokio::sync::Mutex;

/// 数据管理器
/// 负责本地和云端数据的缓存
pub struct DataManager {
    /// 本地数据缓存
    local_data: Vec<SyncDataItem>,
    /// 云端数据缓存
    cloud_data: Vec<SyncDataItem>,
}

impl DataManager {
    /// 创建新的数据管理器实例
    pub fn new() -> Self {
        Self {
            local_data: vec![],
            cloud_data: vec![],
        }
    }

    /// 加载本地数据
    /// # Arguments
    /// * `data` - 本地数据
    pub async fn load_local_data(&mut self, data: Vec<SyncDataItem>) {
        self.local_data = data;
    }

    /// 加载云端数据
    /// # Arguments
    /// * `data` - 云端数据
    pub async fn load_cloud_data(&mut self, data: Vec<SyncDataItem>) {
        self.cloud_data = data;
    }

    /// 获取本地数据
    pub fn get_local_data(&self) -> &[SyncDataItem] {
        &self.local_data
    }

    /// 获取云端数据
    pub fn get_cloud_data(&self) -> &[SyncDataItem] {
        &self.cloud_data
    }

    /// 从缓存中移除已删除的项目
    pub fn remove_deleted_items(&mut self, item_ids: &[String]) {
        for item_id in item_ids {
            self.local_data.retain(|item| item.id != *item_id);
        }
    }
}

/// 创建共享的数据管理器实例
pub fn create_shared_manager() -> Arc<Mutex<DataManager>> {
    Arc::new(Mutex::new(DataManager::new()))
}
