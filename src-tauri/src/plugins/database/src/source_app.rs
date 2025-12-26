//! 来源应用信息获取模块
//! 提供统一的来源应用信息获取接口

use serde::{Deserialize, Serialize};
use std::io::Cursor;
use base64::{Engine as _, engine::general_purpose};
use image::codecs::png::PngEncoder;

/// 来源应用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAppInfo {
    pub app_name: String,
    pub app_icon: Option<String>,
}

/// 从进程路径获取图标（通用函数）
fn get_icon_from_path(app_path: &str) -> Option<String> {
    let icon_result = file_icon_provider::get_file_icon(app_path, 64)
        .map_err(|e| log::warn!("Failed to get icon: {}", e))
        .ok()?;

    let img = image::RgbaImage::from_raw(
        icon_result.width,
        icon_result.height,
        icon_result.pixels,
    )?;

    let mut buffer = Cursor::new(Vec::new());
    let encoder = PngEncoder::new(&mut buffer);
    img.write_with_encoder(encoder)
        .map_err(|e| log::warn!("Failed to encode icon: {}", e))
        .ok()?;

    let base64_str = general_purpose::STANDARD.encode(buffer.get_ref());
    Some(format!("data:image/png;base64,{}", base64_str))
}

// ==================== 剪贴板所有者进程获取（Windows 优先） ====================

/// 获取剪贴板所有者的进程路径（仅 Windows）
/// 返回 (process_name, process_path)
#[cfg(target_os = "windows")]
pub fn get_clipboard_owner_process() -> Result<(String, String), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::GetClipboardOwner;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    unsafe {
        let hwnd_owner: HWND = GetClipboardOwner()
            .map_err(|e| format!("Failed to get clipboard owner: {}", e))?;

        if hwnd_owner.is_invalid() {
            return Err("Failed to get clipboard owner".to_string());
        }

        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd_owner, Some(&mut process_id as *mut u32));

        if process_id == 0 {
            return Err("Failed to get process ID from clipboard owner".to_string());
        }

        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)
            .map_err(|e| format!("Failed to open process: {}", e))?;

        let mut exe_path = vec![0u16; 260];
        let mut exe_path_len = exe_path.len() as u32;

        QueryFullProcessImageNameW(
            process_handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(exe_path.as_mut_ptr()),
            &mut exe_path_len,
        )
        .map_err(|e| format!("Failed to get process image name: {}", e))?;

        let exe_path_str = String::from_utf16_lossy(&exe_path[..exe_path_len as usize]);

        let process_name = std::path::Path::new(&exe_path_str)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Ok((process_name, exe_path_str))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_clipboard_owner_process() -> Result<(String, String), String> {
    Err("Clipboard owner detection is only supported on Windows".to_string())
}

// ==================== 活动窗口进程获取（跨平台） ====================

/// 获取活动窗口的进程路径（跨平台）
/// 返回 (process_name, process_path)
#[cfg(target_os = "windows")]
pub fn get_active_window_process() -> Result<(String, String), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return Err("No foreground window found".to_string());
        }

        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id as *mut u32));

        if process_id == 0 {
            return Err("Failed to get process ID".to_string());
        }

        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)
            .map_err(|e| format!("Failed to open process: {}", e))?;

        let mut exe_path = vec![0u16; 260];
        let mut exe_path_len = exe_path.len() as u32;

        QueryFullProcessImageNameW(
            process_handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(exe_path.as_mut_ptr()),
            &mut exe_path_len,
        )
        .map_err(|e| format!("Failed to get process image name: {}", e))?;

        let exe_path_str = String::from_utf16_lossy(&exe_path[..exe_path_len as usize]);

        let process_name = std::path::Path::new(&exe_path_str)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Ok((process_name, exe_path_str))
    }
}

#[cfg(target_os = "macos")]
pub fn get_active_window_process() -> Result<(String, String), String> {
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

        let bundle_url: id = msg_send![front_app, bundleURL];
        let app_path = if bundle_url != nil {
            let path_str: id = msg_send![bundle_url, path];
            if path_str != nil {
                let c_str: *const i8 = msg_send![path_str, UTF8String];
                std::ffi::CStr::from_ptr(c_str)
                    .to_string_lossy()
                    .to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let _ = pool;
        Ok((process_name, app_path))
    }
}

#[cfg(target_os = "linux")]
pub fn get_active_window_process() -> Result<(String, String), String> {
    use std::process::Command;

    let pid_output = Command::new("xdotool")
        .args(&["getactivewindow", "getwindowpid"])
        .output()
        .map_err(|e| format!("Failed to execute xdotool: {}", e))?;

    if !pid_output.status.success() {
        return Err("Failed to get active window pid".to_string());
    }

    let pid = String::from_utf8_lossy(&pid_output.stdout).trim().to_string();

    let ps_output = Command::new("ps")
        .args(&["-p", &pid, "-o", "comm="])
        .output()
        .map_err(|e| format!("Failed to execute ps: {}", e))?;

    let process_name = if ps_output.status.success() {
        String::from_utf8_lossy(&ps_output.stdout).trim().to_string()
    } else {
        "Unknown".to_string()
    };

    let exe_path = format!("/proc/{}/exe", pid);

    Ok((process_name, exe_path))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn get_active_window_process() -> Result<(String, String), String> {
    Err("Unsupported platform".to_string())
}

// ==================== 统一获取来源应用信息 ====================

/// 统一获取来源应用信息
/// 优先使用剪贴板所有者（Windows），回退到活动窗口
pub fn fetch_source_app_info_impl() -> Result<SourceAppInfo, String> {
    #[cfg(target_os = "windows")]
    {
        // Windows 平台：优先使用剪贴板所有者进程
        match get_clipboard_owner_process() {
            Ok((process_name, process_path)) => {
                let app_icon = get_icon_from_path(&process_path);
                return Ok(SourceAppInfo { app_name: process_name, app_icon });
            }
            Err(e) => {
                log::warn!("[SourceApp] 获取剪贴板所有者失败，回退到活动窗口: {}", e);
                // 回退到活动窗口
            }
        }
    }

    // 非 Windows 平台或回退方案：使用活动窗口进程
    match get_active_window_process() {
        Ok((process_name, process_path)) => {
            let app_icon = get_icon_from_path(&process_path);
            Ok(SourceAppInfo { app_name: process_name, app_icon })
        }
        Err(e) => Err(format!("Failed to get source app info: {}", e)),
    }
}

/// 获取来源应用信息（Tauri 命令，供前端调用）
#[tauri::command]
pub async fn get_source_app_info() -> Result<SourceAppInfo, String> {
    fetch_source_app_info_impl()
}
