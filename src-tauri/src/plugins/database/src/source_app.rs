//! 来源应用信息获取模块
//! 提供统一的来源应用信息获取接口

use serde::{Deserialize, Serialize};

/// 来源应用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAppInfo {
    pub app_name: String,
    pub app_icon: Option<String>,
}

/// 获取来源应用信息
#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn get_source_app_info() -> Result<SourceAppInfo, String> {
    use std::io::Write;

    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::GetClipboardOwner;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    unsafe {
        // 获取剪贴板所有者的窗口句柄
        let hwnd_owner: HWND = GetClipboardOwner()
            .map_err(|e| format!("Failed to get clipboard owner: {}", e))?;

        if hwnd_owner.is_invalid() {
            return Err("Failed to get clipboard owner".to_string());
        }

        // 通过句柄获取 PID
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd_owner, Some(&mut process_id as *mut u32));

        if process_id == 0 {
            return Err("Failed to get process ID from clipboard owner".to_string());
        }

        // 打开进程以获取进程信息
        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)
            .map_err(|e| format!("Failed to open process: {}", e))?;

        // 获取进程可执行文件路径
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

        // 从路径中提取文件名作为应用名
        let app_name = std::path::Path::new(&exe_path_str)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        // 获取应用图标
        let app_icon = extract_icon_from_exe(&exe_path_str);

        Ok(SourceAppInfo {
            app_name,
            app_icon,
        })
    }
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn get_source_app_info() -> Result<SourceAppInfo, String> {
    Err("Not supported on this platform".to_string())
}

/// 从可执行文件提取图标（返回 Base64 编码的 PNG）
#[cfg(target_os = "windows")]
fn extract_icon_from_exe(exe_path: &str) -> Option<String> {
    use std::fs::File;
    use std::io::Bytes;

    // 使用 PowerShell 获取图标并转换为 Base64
    let output = std::process::Command::new("powershell")
        .args(&[
            "-Command",
            &format!(
                "[System.Drawing.Image]::FromFile('{}.ico').Save([System.IO.MemoryStream]::new()) | Out-Null; [Convert]::ToBase64String([System.Drawing.Image]::FromFile('{}.ico').ToByteArray())",
                exe_path, exe_path
            ),
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let base64 = String::from_utf8_lossy(&output.stdout);
    let base64 = base64.trim();

    if base64.is_empty() {
        return None;
    }

    Some(base64.to_string())
}

#[cfg(not(target_os = "windows"))]
fn extract_icon_from_exe(_exe_path: &str) -> Option<String> {
    None
}
