//! 活动窗口管理模块
//! 提供统一的窗口信息获取和监听功能

use once_cell::sync::Lazy;
use serde::Serialize;
use std::ptr;
use std::sync::Mutex;

// EcoPaste 主窗口标题常量（用于过滤自身窗口）
const MAIN_WINDOW_TITLE: &str = "EcoPaste-Sync";

// ==================== 类型定义 ====================

/// 活动窗口信息
#[derive(Debug, Clone, Serialize)]
pub struct ForegroundWindowInfo {
    pub hwnd: isize,
    pub process_name: String,
    pub window_title: String,
}

// ==================== Windows 实现 ====================

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::shared::minwindef::DWORD;
    use winapi::shared::windef::{HWINEVENTHOOK, HWND};
    use winapi::um::winuser::SetForegroundWindow;
    use winapi::um::winuser::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
        SetWinEventHook, EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// 记录上一个有效窗口
    static LAST_VALID_WINDOW: Lazy<Mutex<Option<isize>>> = Lazy::new(|| Mutex::new(None));

    /// 获取窗口标题（winapi）
    fn get_window_title(hwnd: HWND) -> String {
        unsafe {
            let length = GetWindowTextLengthW(hwnd);
            if length == 0 {
                return String::new();
            }
            let mut buffer: Vec<u16> = vec![0; (length + 1) as usize];
            GetWindowTextW(hwnd, buffer.as_mut_ptr(), length + 1);
            OsString::from_wide(&buffer[..length as usize])
                .to_string_lossy()
                .into_owned()
        }
    }

    /// 根据 HWND 获取进程 PID（windows crate）
    fn get_window_pid(hwnd: HWND) -> Result<u32, String> {
        unsafe {
            let mut process_id: u32 = 0;
            winapi::um::winuser::GetWindowThreadProcessId(hwnd, &mut process_id as *mut u32);
            if process_id == 0 {
                return Err("Failed to get window PID".to_string());
            }
            Ok(process_id)
        }
    }

    /// 根据 PID 获取进程名（windows crate）
    fn get_process_name_by_pid(pid: u32) -> Result<String, String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .map_err(|e| format!("Failed to open process {}: {}", pid, e))?;
            let mut buffer = vec![0u16; 260];
            let mut size = buffer.len() as u32;
            let success = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buffer.as_mut_ptr()),
                &mut size,
            );
            if success.is_ok() {
                let path = String::from_utf16_lossy(&buffer[..size as usize]);
                Ok(std::path::Path::new(&path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string())
            } else {
                Err("Failed to query process image name".to_string())
            }
        }
    }

    /// EnumWindows 回调（winapi）
    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: isize) -> i32 {
        let windows = &mut *(lparam as *mut Vec<super::ForegroundWindowInfo>);

        // 过滤不可见窗口
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        // 过滤无标题栏窗口
        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return 1;
        }

        // 获取窗口信息
        if let Ok(info) = get_window_info_by_hwnd(hwnd) {
            windows.push(info);
        }

        1
    }

    /// 根据 HWND 获取窗口信息
    fn get_window_info_by_hwnd(hwnd: HWND) -> Result<super::ForegroundWindowInfo, String> {
        let pid = get_window_pid(hwnd)?;
        let process_name = get_process_name_by_pid(pid)?;
        let window_title = get_window_title(hwnd);

        Ok(super::ForegroundWindowInfo {
            hwnd: hwnd as isize,
            process_name,
            window_title,
        })
    }

    /// 事件钩子回调（winapi）
    unsafe extern "system" fn event_hook_callback(
        _h_win_event_hook: HWINEVENTHOOK,
        event: DWORD,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _dw_event_thread: DWORD,
        _dwms_event_time: DWORD,
    ) {
        if event == EVENT_SYSTEM_FOREGROUND {
            let window_title = get_window_title(hwnd);
            if window_title.is_empty() {
                return;
            }

            // 通过进程名判断是否是自己的窗口
            if let Ok(info) = get_window_info_by_hwnd(hwnd) {
                if info.process_name.contains("eco-paste") || info.process_name.contains("EcoPaste")
                {
                    return;
                }

                // 记录窗口
                let mut last_window = LAST_VALID_WINDOW.lock().unwrap();
                let _ = last_window.insert(hwnd as isize);
                log::debug!(
                    "[ActiveWindow] 记录: {} - {}",
                    info.process_name,
                    window_title
                );
            }
        }
    }

    /// 获取当前活动窗口信息
    pub fn get_current_window_info() -> Result<super::ForegroundWindowInfo, String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return Err("No foreground window found".to_string());
            }
            get_window_info_by_hwnd(hwnd)
        }
    }

    /// 启动前台窗口监听（winapi）
    pub fn start_foreground_listener() {
        // 首次获取当前窗口并记录（排除 EcoPaste 自身）
        if let Ok(info) = get_current_window_info() {
            if !info.process_name.contains("eco-paste") && !info.process_name.contains("EcoPaste") {
                let mut last_window = LAST_VALID_WINDOW.lock().unwrap();
                let _ = last_window.insert(info.hwnd);
                log::debug!(
                    "[ActiveWindow] 初始化记录窗口: {} - {}",
                    info.process_name,
                    info.window_title
                );
            }
        }

        unsafe {
            let hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                ptr::null_mut(),
                Some(event_hook_callback),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook.is_null() {
                log::error!("[ActiveWindow] 设置事件钩子失败");
                return;
            }
            log::info!("[ActiveWindow] 已启动前台窗口监听");
        }
    }

    /// 获取上一个有效窗口
    pub fn get_last_valid_window_info() -> Option<super::ForegroundWindowInfo> {
        let guard = LAST_VALID_WINDOW.lock().unwrap();
        let hwnd = match *guard {
            Some(h) => h,
            None => return None,
        };
        drop(guard);
        get_window_info_by_hwnd(hwnd as HWND).ok()
    }

    /// 恢复焦点到指定窗口
    pub fn restore_focus_to_window(hwnd: isize) -> bool {
        unsafe {
            let result = SetForegroundWindow(hwnd as HWND);
            result != 0
        }
    }

    /// 获取所有窗口信息
    pub fn get_all_windows_info() -> Vec<super::ForegroundWindowInfo> {
        let mut windows: Vec<super::ForegroundWindowInfo> = Vec::new();
        unsafe {
            let _ = winapi::um::winuser::EnumWindows(
                Some(enum_windows_callback),
                &mut windows as *mut _ as isize,
            );
        }
        windows
    }
}

// ==================== macOS 实现 ====================

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::*;

    pub fn get_current_window_info() -> Result<super::ForegroundWindowInfo, String> {
        use cocoa::appkit::NSRunningApplication;
        use cocoa::base::{id, nil};
        use cocoa::foundation::{NSAutoreleasePool, NSString};
        use objc::{class, msg_send, sel, sel_impl};

        unsafe {
            let pool = NSAutoreleasePool::new(nil);

            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            let front_app: id = msg_send![workspace, frontmostApplication];

            if front_app == nil {
                return Err("No frontmost application found".to_string());
            }

            let bundle_id_ns: id = msg_send![front_app, bundleIdentifier];
            let process_name = if bundle_id_ns != nil {
                let c_str: *const i8 = msg_send![bundle_id_ns, UTF8String];
                std::ffi::CStr::from_ptr(c_str)
                    .to_string_lossy()
                    .to_string()
            } else {
                "Unknown".to_string()
            };

            let _ = pool;

            Ok(super::ForegroundWindowInfo {
                hwnd: 0,
                process_name,
                window_title: String::new(),
            })
        }
    }

    pub fn start_foreground_listener() {
        log::warn!("[ActiveWindow] macOS 平台暂不支持前台窗口监听");
    }

    pub fn get_last_valid_window_info() -> Option<super::ForegroundWindowInfo> {
        None
    }

    pub fn restore_focus_to_window(_hwnd: isize) -> bool {
        false
    }

    pub fn get_all_windows_info() -> Vec<super::ForegroundWindowInfo> {
        Vec::new()
    }
}

// ==================== Linux 实现 ====================

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::*;
    use std::process::Command;

    pub fn get_current_window_info() -> Result<super::ForegroundWindowInfo, String> {
        let pid_output = Command::new("xdotool")
            .args(&["getactivewindow", "getwindowpid"])
            .output()
            .map_err(|e| format!("Failed to execute xdotool: {}", e))?;

        if !pid_output.status.success() {
            return Err("Failed to get active window pid".to_string());
        }

        let pid = String::from_utf8_lossy(&pid_output.stdout)
            .trim()
            .to_string();

        let ps_output = Command::new("ps")
            .args(&["-p", &pid, "-o", "comm="])
            .output()
            .map_err(|e| format!("Failed to execute ps: {}", e))?;

        let process_name = if ps_output.status.success() {
            String::from_utf8_lossy(&ps_output.stdout)
                .trim()
                .to_string()
        } else {
            "Unknown".to_string()
        };

        Ok(super::ForegroundWindowInfo {
            hwnd: 0,
            process_name,
            window_title: String::new(),
        })
    }

    pub fn start_foreground_listener() {
        log::warn!("[ActiveWindow] Linux 平台暂不支持前台窗口监听");
    }

    pub fn get_last_valid_window_info() -> Option<super::ForegroundWindowInfo> {
        None
    }

    pub fn restore_focus_to_window(_hwnd: isize) -> bool {
        false
    }

    pub fn get_all_windows_info() -> Vec<super::ForegroundWindowInfo> {
        Vec::new()
    }
}

// ==================== 跨平台公共 API ====================

/// 获取当前活动窗口信息
pub fn get_current_window_info() -> Result<ForegroundWindowInfo, String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::get_current_window_info()
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::get_current_window_info()
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::get_current_window_info()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}

/// 启动前台窗口监听
pub fn start_foreground_listener() {
    #[cfg(target_os = "windows")]
    {
        windows_impl::start_foreground_listener()
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::start_foreground_listener()
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::start_foreground_listener()
    }
}

/// 获取上一个有效窗口信息（用于恢复焦点）
pub fn get_last_valid_window_info() -> Option<ForegroundWindowInfo> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::get_last_valid_window_info()
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::get_last_valid_window_info()
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::get_last_valid_window_info()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// 恢复焦点到指定窗口
pub fn restore_focus_to_window(hwnd: isize) -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_impl::restore_focus_to_window(hwnd)
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::restore_focus_to_window(hwnd)
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::restore_focus_to_window(hwnd)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

/// 获取所有窗口信息
pub fn get_all_windows_info() -> Vec<ForegroundWindowInfo> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::get_all_windows_info()
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::get_all_windows_info()
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::get_all_windows_info()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Vec::new()
    }
}

/// 获取当前显示的窗口（如果当前是 EcoPaste 则返回上一个，否则返回当前）
pub fn get_foreground_window_info() -> Result<ForegroundWindowInfo, String> {
    match get_current_window_info() {
        Ok(info) => {
            // 如果是 EcoPaste 自身，返回上一个
            if info.window_title.contains("EcoPaste") {
                if let Some(last_info) = get_last_valid_window_info() {
                    log::debug!(
                        "[ActiveWindow] 返回上一个: {} - {}",
                        last_info.process_name,
                        last_info.window_title
                    );
                    return Ok(last_info);
                }
            }
            Ok(info)
        }
        Err(e) => {
            log::debug!("[ActiveWindow] 获取当前窗口失败: {}", e);
            get_last_valid_window_info().ok_or_else(|| "No foreground window found".to_string())
        }
    }
}
