use super::wait;
use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::ptr;
use std::sync::Mutex;
use tauri::command;
use tauri_plugin_eco_window::MAIN_WINDOW_TITLE;
use winapi::shared::minwindef::DWORD;
use winapi::shared::windef::{HWINEVENTHOOK, HWND};
use winapi::um::winuser::{
    GetWindowTextLengthW, GetWindowTextW, SetForegroundWindow, SetWinEventHook,
    EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT,
};

static PREVIOUS_WINDOW: Mutex<Option<isize>> = Mutex::new(None);

// 获取窗口标题
unsafe fn get_window_title(hwnd: HWND) -> String {
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

// 定义事件钩子回调函数
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

        // 忽略 EcoPaste 自己的窗口
        if window_title == MAIN_WINDOW_TITLE || window_title.contains("EcoPaste") {
            return;
        }

        // 检查窗口是否有效（不是桌面等系统窗口）
        if hwnd.is_null() {
            return;
        }

        let mut previous_window = PREVIOUS_WINDOW.lock().unwrap();
        let _ = previous_window.insert(hwnd as isize);
        log::debug!("记录上一个窗口: {}", window_title);
    }
}

// 监听窗口切换
pub fn observe_app() {
    unsafe {
        // 设置事件钩子
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
            log::error!("设置事件钩子失败");
            return;
        }
    }
}

// 获取上一个窗口
pub fn get_previous_window() -> Option<isize> {
    return PREVIOUS_WINDOW.lock().unwrap().clone();
}

// 快速粘贴 - 不获取焦点，直接执行粘贴操作
// 用于快捷键触发的快速粘贴，用户焦点已在目标窗口上
#[command]
pub async fn paste() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();

    // 使用 Shift+Insert 粘贴（避免与快捷键冲突）
    log::info!("[Paste] 执行粘贴操作 (Shift+Insert)");
    enigo.key(Key::LShift, Press).unwrap();
    enigo.key(Key::Insert, Click).unwrap();
    enigo.key(Key::LShift, Release).unwrap();

    wait(20);
    log::info!("[Paste] 粘贴操作完成");
}

// 带焦点切换的粘贴 - 用于前端粘贴（前端窗口会抢占焦点）
#[command]
pub async fn paste_with_focus() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();

    // 尝试聚焦到上一个窗口
    if let Some(prev_hwnd) = get_previous_window() {
        log::info!("[Paste] 尝试聚焦到上一个窗口: {:?}", prev_hwnd);
        let result = unsafe { SetForegroundWindow(prev_hwnd as HWND) };
        if result == 0 {
            log::warn!("[Paste] 无法聚焦到上一个窗口");
        } else {
            log::info!("[Paste] 聚焦成功");
        }
    } else {
        log::warn!("[Paste] 没有记录的上一个窗口");
    }

    // 等待窗口切换完成
    wait(50);

    // 执行粘贴操作
    log::info!("[Paste] 执行带焦点切换的粘贴操作 (Shift+Insert)");
    enigo.key(Key::LShift, Press).unwrap();
    enigo.key(Key::Insert, Click).unwrap();
    enigo.key(Key::LShift, Release).unwrap();

    // 等待粘贴操作完成
    wait(20);

    log::info!("[Paste] 带焦点切换的粘贴操作完成");
}
