use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveWindowInfo {
    pub app_name: String,
    pub window_title: String,
    pub process_name: String,
}

#[cfg(target_os = "windows")]
#[command]
pub fn get_active_window_info() -> Result<ActiveWindowInfo, String> {
    use windows::Win32::Foundation::{HWND, MAX_PATH};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        // 获取前台窗口
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return Err("No foreground window found".to_string());
        }

        // 获取窗口标题
        let mut window_title = vec![0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut window_title);
        let window_title = if title_len > 0 {
            String::from_utf16_lossy(&window_title[..title_len as usize])
        } else {
            String::new()
        };

        // 获取进程ID
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id as *mut u32));

        if process_id == 0 {
            return Err("Failed to get process ID".to_string());
        }

        // 打开进程以获取进程信息
        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)
            .map_err(|e| format!("Failed to open process: {}", e))?;

        // 获取进程可执行文件路径
        let mut exe_path = vec![0u16; MAX_PATH as usize];
        let mut exe_path_len = exe_path.len() as u32;

        QueryFullProcessImageNameW(
            process_handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(exe_path.as_mut_ptr()),
            &mut exe_path_len,
        )
        .map_err(|e| format!("Failed to get process image name: {}", e))?;

        let exe_path_str = String::from_utf16_lossy(&exe_path[..exe_path_len as usize]);

        // 从路径中提取文件名作为进程名
        let process_name = std::path::Path::new(&exe_path_str)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        // 尝试从可执行文件中提取应用名称（使用进程名作为fallback）
        let app_name = process_name.clone();

        Ok(ActiveWindowInfo {
            app_name,
            window_title,
            process_name,
        })
    }
}

#[cfg(target_os = "macos")]
#[command]
pub fn get_active_window_info() -> Result<ActiveWindowInfo, String> {
    use cocoa::appkit::NSRunningApplication;
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSAutoreleasePool, NSString};
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let _pool = NSAutoreleasePool::new(nil);

        // 获取当前活动的应用程序
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let front_app: id = msg_send![workspace, frontmostApplication];

        if front_app == nil {
            return Err("No frontmost application found".to_string());
        }

        // 获取应用名称
        let app_name_ns: id = msg_send![front_app, localizedName];
        let app_name = if app_name_ns != nil {
            let c_str: *const i8 = msg_send![app_name_ns, UTF8String];
            std::ffi::CStr::from_ptr(c_str)
                .to_string_lossy()
                .to_string()
        } else {
            String::from("Unknown")
        };

        // 获取Bundle标识符作为进程名
        let bundle_id_ns: id = msg_send![front_app, bundleIdentifier];
        let process_name = if bundle_id_ns != nil {
            let c_str: *const i8 = msg_send![bundle_id_ns, UTF8String];
            std::ffi::CStr::from_ptr(c_str)
                .to_string_lossy()
                .to_string()
        } else {
            app_name.clone()
        };

        Ok(ActiveWindowInfo {
            app_name: app_name.clone(),
            window_title: String::new(), // macOS较难获取窗口标题，暂时留空
            process_name,
        })
    }
}

#[cfg(target_os = "linux")]
#[command]
pub fn get_active_window_info() -> Result<ActiveWindowInfo, String> {
    // Linux实现：使用wmctrl或xdotool命令
    // 这是一个简化的实现，实际应用中可能需要更复杂的逻辑
    use std::process::Command;

    // 尝试使用xdotool获取活动窗口信息
    let output = Command::new("xdotool")
        .args(&["getactivewindow", "getwindowname"])
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let window_title = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();

            // 尝试获取进程名
            let pid_output = Command::new("xdotool")
                .args(&["getactivewindow", "getwindowpid"])
                .output();

            let process_name = if let Ok(pid_output) = pid_output {
                if pid_output.status.success() {
                    let pid = String::from_utf8_lossy(&pid_output.stdout)
                        .trim()
                        .to_string();

                    // 使用ps命令获取进程名
                    let ps_output = Command::new("ps")
                        .args(&["-p", &pid, "-o", "comm="])
                        .output();

                    if let Ok(ps_output) = ps_output {
                        String::from_utf8_lossy(&ps_output.stdout)
                            .trim()
                            .to_string()
                    } else {
                        String::from("Unknown")
                    }
                } else {
                    String::from("Unknown")
                }
            } else {
                String::from("Unknown")
            };

            return Ok(ActiveWindowInfo {
                app_name: process_name.clone(),
                window_title,
                process_name,
            });
        }
    }

    Err("Failed to get active window info on Linux".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
#[command]
pub fn get_active_window_info() -> Result<ActiveWindowInfo, String> {
    Err("Unsupported platform".to_string())
}
