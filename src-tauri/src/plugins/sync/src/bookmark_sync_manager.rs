//! 书签同步管理器
//! 使用统一时间戳进行书签同步

use crate::webdav::WebDAVClientState;
use serde::{Deserialize, Serialize};
use tauri_plugin_eco_common::paths::get_data_path;

/// 书签分组
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkGroup {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// 书签同步数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkSyncData {
    pub groups: Vec<BookmarkGroup>,
    pub time: i64,
}

/// 书签同步结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkSyncResult {
    pub success: bool,
    pub need_upload: bool,
    pub need_download: bool,
    pub message: String,
}

/// 书签同步管理器
/// 使用统一时间戳进行书签同步
pub struct BookmarkSyncManager {
    /// WebDAV客户端
    webdav_client: WebDAVClientState,
    /// 本地书签数据
    local_data: Option<BookmarkSyncData>,
}

impl BookmarkSyncManager {
    /// 创建新的书签同步管理器
    pub fn new(webdav_client: WebDAVClientState, _device_id: String) -> Self {
        Self {
            webdav_client,
            local_data: None,
        }
    }

    /// 设置本地书签数据
    pub fn set_local_data(&mut self, data: BookmarkSyncData) {
        self.local_data = Some(data);
    }

    /// 获取本地书签数据
    pub fn get_local_data(&self) -> Option<&BookmarkSyncData> {
        self.local_data.as_ref()
    }

    /// 获取本地时间戳
    pub fn get_local_time(&self) -> i64 {
        self.local_data.as_ref().map(|d| d.time).unwrap_or(0)
    }

    /// 执行书签同步逻辑
    pub async fn sync_bookmarks(&self) -> Result<BookmarkSyncResult, String> {
        log::info!("[Bookmark] 开始同步...");

        // 获取本地书签数据
        let local_data = match &self.local_data {
            Some(data) => data.clone(),
            None => {
                log::info!("[Bookmark] 本地无数据，跳过同步");
                return Ok(BookmarkSyncResult {
                    success: true,
                    need_upload: false,
                    need_download: false,
                    message: "本地无书签数据".to_string(),
                });
            }
        };

        log::info!(
            "[Bookmark] 分析: 本地分组数={}, 时间戳={}",
            local_data.groups.len(),
            local_data.time
        );

        // 从云端下载书签数据
        let client = self.webdav_client.lock().await;
        let download_result = match client.download_sync_data("bookmark-sync.json").await {
            Ok(result) => result,
            Err(e) => {
                log::error!("[Bookmark] 下载失败: {}", e);
                return Ok(BookmarkSyncResult {
                    success: false,
                    need_upload: false,
                    need_download: false,
                    message: format!("下载失败: {}", e),
                });
            }
        };

        // 如果云端没有书签数据
        if !download_result.success || download_result.data.is_none() {
            log::info!("[Bookmark] 云端无数据，上传本地书签");
            drop(client); // 释放锁，避免与 upload_bookmarks 死锁

            let upload_result = self.upload_bookmarks(&local_data).await?;
            if upload_result.success {
                return Ok(BookmarkSyncResult {
                    success: true,
                    need_upload: true,
                    need_download: false,
                    message: "已上传本地书签到云端".to_string(),
                });
            } else {
                return Ok(BookmarkSyncResult {
                    success: false,
                    need_upload: false,
                    need_download: false,
                    message: "上传失败".to_string(),
                });
            }
        }

        // 解析云端书签数据
        let cloud_data: BookmarkSyncData =
            match serde_json::from_str(&download_result.data.unwrap_or_else(|| "{}".to_string())) {
                Ok(data) => data,
                Err(e) => {
                    log::error!("[Bookmark] 解析云端数据失败: {}", e);
                    return Ok(BookmarkSyncResult {
                        success: false,
                        need_upload: false,
                        need_download: false,
                        message: format!("解析失败: {}", e),
                    });
                }
            };

        log::info!(
            "[Bookmark] 分析: 云端分组数={}, 时间戳={}",
            cloud_data.groups.len(),
            cloud_data.time
        );

        // 核心同步逻辑：只比较时间戳，最新的数据胜出
        if local_data.time > cloud_data.time {
            log::info!("[Bookmark] 本地更新，上传云端");
            drop(client); // 释放锁，避免与 upload_bookmarks 死锁
            let upload_result = self.upload_bookmarks(&local_data).await?;
            return Ok(BookmarkSyncResult {
                success: upload_result.success,
                need_upload: true,
                need_download: false,
                message: "本地数据更新，已上传到云端".to_string(),
            });
        }

        if cloud_data.time > local_data.time {
            log::info!("[Bookmark] 云端更新，下载本地");
            // 实际下载并保存数据
            drop(client); // 释放锁，避免与下载死锁
            match self.download_bookmarks().await {
                Ok(Some(cloud_data)) => {
                    if let Err(e) = self.save_bookmark_data_to_file(&cloud_data).await {
                        log::error!("[Bookmark] 保存本地文件失败: {}", e);
                        return Ok(BookmarkSyncResult {
                            success: false,
                            need_upload: false,
                            need_download: false,
                            message: format!("保存失败: {}", e),
                        });
                    }
                }
                Ok(None) => {
                    log::warn!("[Bookmark] 云端无书签数据");
                }
                Err(e) => {
                    log::error!("[Bookmark] 下载失败: {}", e);
                    return Ok(BookmarkSyncResult {
                        success: false,
                        need_upload: false,
                        need_download: false,
                        message: format!("下载失败: {}", e),
                    });
                }
            }
            return Ok(BookmarkSyncResult {
                success: true,
                need_upload: false,
                need_download: true,
                message: "已下载并保存书签数据".to_string(),
            });
        }

        // 时间戳相同，检查内容是否一致
        let local_hash = self.calculate_bookmark_hash(&local_data);
        let cloud_hash = self.calculate_bookmark_hash(&cloud_data);

        if local_hash != cloud_hash {
            // 时间戳相同但内容不同：以云端为准（云端数据通常更可靠）
            log::warn!("[Bookmark] 时间戳相同但内容不同，以云端为准");
            // 实际下载并保存数据
            drop(client); // 释放锁，避免与下载死锁
            match self.download_bookmarks().await {
                Ok(Some(cloud_data)) => {
                    if let Err(e) = self.save_bookmark_data_to_file(&cloud_data).await {
                        log::error!("[Bookmark] 保存本地文件失败: {}", e);
                        return Ok(BookmarkSyncResult {
                            success: false,
                            need_upload: false,
                            need_download: false,
                            message: format!("保存失败: {}", e),
                        });
                    }
                }
                Ok(None) => {
                    log::warn!("[Bookmark] 云端无书签数据");
                }
                Err(e) => {
                    log::error!("[Bookmark] 下载失败: {}", e);
                    return Ok(BookmarkSyncResult {
                        success: false,
                        need_upload: false,
                        need_download: false,
                        message: format!("下载失败: {}", e),
                    });
                }
            }
            return Ok(BookmarkSyncResult {
                success: true,
                need_upload: false,
                need_download: true,
                message: "时间戳相同但内容不同，已下载云端数据".to_string(),
            });
        }

        // 内容一致，无需同步
        log::info!("[Bookmark] 数据已同步，无需操作");
        Ok(BookmarkSyncResult {
            success: true,
            need_upload: false,
            need_download: false,
            message: "书签数据已同步".to_string(),
        })
    }

    /// 上传书签数据到云端
    async fn upload_bookmarks(
        &self,
        data: &BookmarkSyncData,
    ) -> Result<BookmarkSyncResult, String> {
        let client = self.webdav_client.lock().await;
        let json_data =
            serde_json::to_string(data).map_err(|e| format!("序列化书签数据失败: {}", e))?;

        match client
            .upload_sync_data("bookmark-sync.json", &json_data)
            .await
        {
            Ok(_) => {
                log::info!("[Bookmark] 上传成功");
                Ok(BookmarkSyncResult {
                    success: true,
                    need_upload: true,
                    need_download: false,
                    message: "书签数据上传成功".to_string(),
                })
            }
            Err(e) => {
                log::error!("[Bookmark] 上传失败: {}", e);
                Ok(BookmarkSyncResult {
                    success: false,
                    need_upload: false,
                    need_download: false,
                    message: format!("上传失败: {}", e),
                })
            }
        }
    }

    /// 下载云端书签数据
    pub async fn download_bookmarks(&self) -> Result<Option<BookmarkSyncData>, String> {
        let client = self.webdav_client.lock().await;
        let download_result = client.download_sync_data("bookmark-sync.json").await?;

        if !download_result.success || download_result.data.is_none() {
            return Ok(None);
        }

        let data: BookmarkSyncData = serde_json::from_str(&download_result.data.unwrap())
            .map_err(|e| format!("解析书签数据失败: {}", e))?;

        Ok(Some(data))
    }

    /// 保存书签数据到本地文件
    async fn save_bookmark_data_to_file(
        &self,
        data: &BookmarkSyncData,
    ) -> Result<(), String> {
        let data_dir = get_data_path().ok_or_else(|| "无法获取数据目录".to_string())?;
        let bookmark_path = data_dir.join("bookmark-data.json");

        // 确保目录存在
        if let Some(parent) = bookmark_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败: {}", e))?;
            }
        }

        // 转换为与 load_bookmark_data_local 兼容的格式保存
        // 使用 last_modified 字段
        #[derive(Debug, Clone, Serialize)]
        struct LocalBookmarkData {
            last_modified: i64,
            groups: Vec<BookmarkGroup>,
        }

        let local_data = LocalBookmarkData {
            last_modified: data.time,
            groups: data.groups.clone(),
        };

        let json = serde_json::to_string_pretty(&local_data)
            .map_err(|e| format!("序列化失败: {}", e))?;
        std::fs::write(&bookmark_path, json).map_err(|e| format!("写入失败: {}", e))?;

        log::info!(
            "[Bookmark] 已保存本地文件 ({} 个分组)",
            local_data.groups.len()
        );

        Ok(())
    }

    /// 计算书签数据的哈希值，用于内容比较
    fn calculate_bookmark_hash(&self, data: &BookmarkSyncData) -> String {
        // 创建数据字符串
        let mut data_string = String::new();

        // 添加分组信息
        let mut groups = data.groups.clone();
        groups.sort_by(|a, b| a.id.cmp(&b.id));
        for group in groups {
            data_string.push_str(&format!("{}:{}:{};", group.id, group.name, group.color));
        }

        // 简单的哈希函数
        let mut hash: i64 = 0;
        for byte in data_string.as_bytes() {
            hash = (hash << 5).wrapping_sub(hash).wrapping_add(*byte as i64);
        }
        // 使用标准的哈希值，不做额外的位运算
        hash.to_string()
    }

    /// 检查是否有书签数据需要同步
    pub fn has_bookmark_data(&self) -> bool {
        self.local_data
            .as_ref()
            .map(|d| !d.groups.is_empty())
            .unwrap_or(false)
    }

    /// 提取书签数据（用于合并到云端同步数据中）
    pub fn extract_bookmark_data(&self) -> Option<BookmarkSyncData> {
        self.local_data.clone()
    }

    /// 合并书签数据到云端同步数据中
    pub fn merge_bookmark_data_to_cloud(
        &self,
        cloud_data: &mut serde_json::Value,
        bookmark_data: &BookmarkSyncData,
    ) -> Result<(), String> {
        // 将书签数据转换为JSON
        let bookmark_json = serde_json::to_value(bookmark_data)
            .map_err(|e| format!("序列化书签数据失败: {}", e))?;

        // 合并到云端数据中
        if let Some(obj) = cloud_data.as_object_mut() {
            obj.insert("bookmarkGroups".to_string(), bookmark_json);
        }

        Ok(())
    }
}
