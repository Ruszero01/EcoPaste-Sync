use tauri::command;

use super::active_window::ForegroundWindowInfo;

/// 获取当前前台窗口信息（排除 EcoPaste 自身）
#[command]
pub fn get_current_window_info() -> Result<ForegroundWindowInfo, String> {
    super::active_window::get_current_window_info()
}

/// 获取上一个有效窗口信息（过滤掉 EcoPaste 自身）
#[command]
pub fn get_last_window_info() -> Option<ForegroundWindowInfo> {
    super::active_window::get_last_valid_window_info()
}

/// 获取当前显示的窗口（如果当前是 EcoPaste 则返回上一个，否则返回当前）
#[command]
pub fn get_foreground_window_info() -> Result<ForegroundWindowInfo, String> {
    super::active_window::get_foreground_window_info()
}
