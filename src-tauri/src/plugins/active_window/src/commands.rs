//! 活动窗口进程信息获取模块

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
