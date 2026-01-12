//! 调试专用模块
//! 包含调试和开发时使用的命令，与生产环境隔离

use crate::DatabaseState;
use tauri::State;

/// 重置数据库（调试用）
#[tauri::command]
pub async fn reset_database(state: State<'_, DatabaseState>) -> Result<bool, String> {
    let db = state.lock().await;

    log::warn!("🔄 开始重置数据库（调试操作）");

    // 清空所有数据
    let conn = db.get_connection()?;
    conn.execute_batch("DELETE FROM history;")
        .map_err(|e| format!("清空数据失败: {}", e))?;

    // 压缩数据库文件
    conn.execute_batch("VACUUM;")
        .map_err(|e| format!("压缩数据库失败: {}", e))?;

    log::info!("✅ 数据库重置成功");

    Ok(true)
}
