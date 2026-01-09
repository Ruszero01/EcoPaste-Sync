//! 同步工具模块
//! 提供通用的工具函数

use std::time::Instant;

/// 计算已流逝的毫秒数
pub fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis() as u64
}

/// 计算已流逝的秒数
pub fn elapsed_secs(start: Instant) -> u64 {
    start.elapsed().as_secs() as u64
}

/// 获取当前时间的 Instant（用于后续计算耗时）
pub fn now() -> Instant {
    Instant::now()
}

/// 创建一个带时间戳的进度消息
pub fn progress_message(current: u64, total: u64, message: &str) -> String {
    let percentage = if total > 0 {
        (current * 100 / total) as f64
    } else {
        0.0
    };
    format!("{} [{}/{}, {:.1}%]", message, current, total, percentage)
}
