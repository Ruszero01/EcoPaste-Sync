//! ID 生成模块
//! 提供全局唯一 ID 生成功能

/// 生成唯一 ID（基于时间戳的纳秒级哈希）
#[inline]
pub fn generate_id() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp)
}
