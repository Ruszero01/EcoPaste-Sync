//! 数据筛选模块
//! 统一处理所有数据库数据筛选操作
//! 包括用户操作（切换分组、搜索等）和同步模式筛选

use crate::models::{HistoryItem, QueryOptions};
use serde::{Deserialize, Serialize};

/// 数据筛选器
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataFilter {
    /// 基础筛选条件
    pub base_filter: BaseFilter,
    /// 分组筛选
    pub group_filter: Option<GroupFilter>,
    /// 搜索筛选
    pub search_filter: Option<SearchFilter>,
    /// 同步模式筛选
    pub sync_filter: Option<SyncModeFilter>,
}

/// 基础筛选条件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseFilter {
    /// 仅显示收藏项目
    pub only_favorites: bool,
    /// 排除已删除项目
    pub exclude_deleted: bool,
    /// 内容类型筛选
    pub content_types: ContentTypeFilter,
}

/// 内容类型筛选
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentTypeFilter {
    pub include_text: bool,
    pub include_html: bool,
    pub include_rtf: bool,
    pub include_images: bool,
    pub include_files: bool,
}

/// 分组筛选
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupFilter {
    /// 分组名称，None表示显示所有分组
    pub group_name: Option<String>,
}

/// 搜索筛选
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFilter {
    /// 搜索关键词
    pub keyword: String,
    /// 搜索字段
    pub search_fields: Vec<SearchField>,
}

/// 搜索字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SearchField {
    /// 搜索内容值
    Value,
    /// 搜索备注
    Note,
    /// 搜索分组
    Group,
    /// 搜索所有字段
    All,
}

/// 同步模式筛选
/// 用于同步引擎根据当前同步模式筛选数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncModeFilter {
    /// 是否仅同步收藏项目
    pub only_favorites: bool,
    /// 是否包含图片
    pub include_images: bool,
    /// 是否包含文件
    pub include_files: bool,
    /// 内容类型配置
    pub content_types: ContentTypeFilter,
}

/// 分页信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    /// 限制数量
    pub limit: Option<i32>,
    /// 偏移量
    pub offset: Option<i32>,
}

/// 排序信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortInfo {
    /// 排序字段
    pub field: SortField,
    /// 排序方向
    pub order: SortOrder,
}

/// 排序字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SortField {
    /// 按时间排序
    Time,
    /// 按类型排序
    Type,
    /// 按分组排序
    Group,
    /// 按收藏状态排序
    Favorite,
}

/// 排序方向
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SortOrder {
    /// 升序
    Asc,
    /// 降序
    Desc,
}

/// 筛选结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterResult<T> {
    /// 筛选后的数据
    pub data: Vec<T>,
    /// 总数量（用于分页）
    pub total: usize,
    /// 是否还有更多数据（用于分页）
    pub has_more: bool,
}

impl DataFilter {
    /// 创建默认筛选器
    pub fn default() -> Self {
        Self {
            base_filter: BaseFilter {
                only_favorites: false,
                exclude_deleted: true,
                content_types: ContentTypeFilter {
                    include_text: true,
                    include_html: true,
                    include_rtf: true,
                    include_images: true,
                    include_files: true,
                },
            },
            group_filter: None,
            search_filter: None,
            sync_filter: None,
        }
    }

    /// 创建仅收藏项的筛选器
    pub fn favorites_only() -> Self {
        let mut filter = Self::default();
        filter.base_filter.only_favorites = true;
        filter
    }

    /// 创建搜索筛选器
    pub fn with_search(keyword: String) -> Self {
        let mut filter = Self::default();
        filter.search_filter = Some(SearchFilter {
            keyword,
            search_fields: vec![SearchField::All],
        });
        filter
    }

    /// 创建分组筛选器
    pub fn with_group(group_name: String) -> Self {
        let mut filter = Self::default();
        filter.group_filter = Some(GroupFilter {
            group_name: Some(group_name),
        });
        filter
    }

    /// 创建同步模式筛选器
    pub fn with_sync_mode(sync_filter: SyncModeFilter) -> Self {
        let mut filter = Self::default();
        filter.sync_filter = Some(sync_filter);
        filter
    }

    /// 转换为数据库查询选项
    pub fn to_query_options(&self, pagination: Option<Pagination>, sort: Option<SortInfo>) -> QueryOptions {
        let mut options = QueryOptions::default();

        // 基础筛选
        options.only_favorites = self.base_filter.only_favorites;
        options.exclude_deleted = self.base_filter.exclude_deleted;

        // 分组筛选
        if let Some(group_filter) = &self.group_filter {
            if let Some(group_name) = &group_filter.group_name {
                let where_clause = format!("[group] = '{}'", group_name);
                options.where_clause = Some(where_clause);
            }
        }

        // 搜索筛选
        if let Some(search_filter) = &self.search_filter {
            let search_conditions = self.build_search_conditions(&search_filter);
            if let Some(existing_where) = &options.where_clause {
                options.where_clause = Some(format!("{} AND {}", existing_where, search_conditions));
            } else {
                options.where_clause = Some(search_conditions);
            }
        }

        // 排序
        let sort_clause = self.build_sort_clause(sort);
        options.order_by = sort_clause;

        // 分页
        if let Some(pagination) = pagination {
            options.limit = pagination.limit;
            options.offset = pagination.offset;
        }

        options
    }

    /// 构建搜索条件
    fn build_search_conditions(&self, search_filter: &SearchFilter) -> String {
        let keyword = &search_filter.keyword;
        let keyword_escaped = keyword.replace("'", "''"); // 转义单引号

        let mut conditions = Vec::new();

        for field in &search_filter.search_fields {
            let condition = match field {
                SearchField::Value => {
                    format!("(value LIKE '%{}%' OR search LIKE '%{}%')", keyword_escaped, keyword_escaped)
                }
                SearchField::Note => {
                    format!("note LIKE '%{}%'", keyword_escaped)
                }
                SearchField::Group => {
                    format!("[group] LIKE '%{}%'", keyword_escaped)
                }
                SearchField::All => {
                    format!(
                        "(value LIKE '%{}%' OR search LIKE '%{}%' OR note LIKE '%{}%' OR [group] LIKE '%{}%')",
                        keyword_escaped, keyword_escaped, keyword_escaped, keyword_escaped
                    )
                }
            };
            conditions.push(condition);
        }

        conditions.join(" OR ")
    }

    /// 构建排序条件
    fn build_sort_clause(&self, sort: Option<SortInfo>) -> Option<String> {
        if let Some(sort_info) = sort {
            let field = match sort_info.field {
                SortField::Time => "time",
                SortField::Type => "type",
                SortField::Group => "[group]",
                SortField::Favorite => "favorite",
            };

            let order = match sort_info.order {
                SortOrder::Asc => "ASC",
                SortOrder::Desc => "DESC",
            };

            Some(format!("{} {}", field, order))
        } else {
            Some("time DESC".to_string()) // 默认按时间降序
        }
    }

    /// 检查项目是否匹配筛选条件
    pub fn matches(&self, item: &HistoryItem) -> bool {
        // 基础筛选
        if self.base_filter.only_favorites && item.favorite == 0 {
            return false;
        }

        if self.base_filter.exclude_deleted && item.deleted.unwrap_or(0) != 0 {
            return false;
        }

        // 内容类型筛选
        if !self.matches_content_type(item) {
            return false;
        }

        // 分组筛选
        if let Some(group_filter) = &self.group_filter {
            if let Some(group_name) = &group_filter.group_name {
                if item.group.as_ref() != Some(group_name) {
                    return false;
                }
            }
        }

        // 搜索筛选
        if let Some(search_filter) = &self.search_filter {
            if !self.matches_search(item, search_filter) {
                return false;
            }
        }

        // 同步模式筛选
        if let Some(sync_filter) = &self.sync_filter {
            if !self.matches_sync_mode(item, sync_filter) {
                return false;
            }
        }

        true
    }

    /// 检查内容类型匹配
    fn matches_content_type(&self, item: &HistoryItem) -> bool {
        let item_type = item.item_type.as_deref().unwrap_or("text");

        match item_type {
            "text" => self.base_filter.content_types.include_text,
            "formatted" => {
                // 格式文本匹配：需要对应的子类型开关开启
                match item.subtype.as_deref() {
                    Some("html") => self.base_filter.content_types.include_html,
                    Some("rtf") => self.base_filter.content_types.include_rtf,
                    _ => self.base_filter.content_types.include_html
                        || self.base_filter.content_types.include_rtf,
                }
            }
            "image" => self.base_filter.content_types.include_images,
            "file" | "files" => self.base_filter.content_types.include_files,
            _ => true,
        }
    }

    /// 检查搜索匹配
    fn matches_search(&self, item: &HistoryItem, search_filter: &SearchFilter) -> bool {
        let keyword = &search_filter.keyword;

        for field in &search_filter.search_fields {
            let matches = match field {
                SearchField::Value => {
                    item.value.as_ref().map_or(false, |v| v.contains(keyword))
                        || item.search.as_ref().map_or(false, |s| s.contains(keyword))
                }
                SearchField::Note => {
                    item.note.as_ref().map_or(false, |n| n.contains(keyword))
                }
                SearchField::Group => {
                    item.group.as_ref().map_or(false, |g| g.contains(keyword))
                }
                SearchField::All => {
                    item.value.as_ref().map_or(false, |v| v.contains(keyword))
                        || item.search.as_ref().map_or(false, |s| s.contains(keyword))
                        || item.note.as_ref().map_or(false, |n| n.contains(keyword))
                        || item.group.as_ref().map_or(false, |g| g.contains(keyword))
                }
            };

            if matches {
                return true;
            }
        }

        false
    }

    /// 检查同步模式匹配
    fn matches_sync_mode(&self, item: &HistoryItem, sync_filter: &SyncModeFilter) -> bool {
        // 仅收藏项目检查
        if sync_filter.only_favorites && item.favorite == 0 {
            return false;
        }

        // 内容类型检查
        let item_type = item.item_type.as_deref().unwrap_or("text");

        let matches_type = match item_type {
            "text" => sync_filter.content_types.include_text,
            "formatted" => {
                // 格式文本匹配：需要对应的子类型开关开启
                match item.subtype.as_deref() {
                    Some("html") => sync_filter.content_types.include_html,
                    Some("rtf") => sync_filter.content_types.include_rtf,
                    _ => sync_filter.content_types.include_html
                        || sync_filter.content_types.include_rtf,
                }
            }
            "image" => sync_filter.include_images,
            "file" | "files" => sync_filter.include_files,
            _ => true,
        };

        matches_type
    }
}

impl Default for BaseFilter {
    fn default() -> Self {
        Self {
            only_favorites: false,
            exclude_deleted: true,
            content_types: ContentTypeFilter::default(),
        }
    }
}

impl Default for ContentTypeFilter {
    fn default() -> Self {
        Self {
            include_text: true,
            include_html: true,
            include_rtf: true,
            include_images: true,
            include_files: true,
        }
    }
}
