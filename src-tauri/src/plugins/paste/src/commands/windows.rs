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
    GetAsyncKeyState, GetWindowTextLengthW, GetWindowTextW, SetForegroundWindow, SetWinEventHook,
    EVENT_SYSTEM_FOREGROUND, VK_CONTROL, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RSHIFT, VK_RWIN,
    WINEVENT_OUTOFCONTEXT,
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

        // 检查窗口是否有效
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

// 释放所有按住的修饰键
fn release_all_modifier_keys(enigo: &mut Enigo) {
    let modifier_keys = [
        (VK_LSHIFT, Key::Shift),
        (VK_RSHIFT, Key::Shift),
        (VK_CONTROL, Key::Control),
        (VK_MENU, Key::Alt),
        (VK_LWIN, Key::LWin),
        (VK_RWIN, Key::RWin),
    ];

    for (vk_code, enigo_key) in modifier_keys.iter() {
        let state = unsafe { GetAsyncKeyState(*vk_code) };
        if (state & 0x8000u16 as i16) != 0 {
            let _ = enigo.key(*enigo_key, Release);
        }
    }
}

// 快速粘贴 - 不获取焦点，直接执行粘贴操作
#[command]
pub async fn paste() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();

    release_all_modifier_keys(&mut enigo);

    enigo.key(Key::LShift, Press).unwrap();
    enigo.key(Key::Insert, Click).unwrap();
    enigo.key(Key::LShift, Release).unwrap();

    wait(5);
}

// 带焦点切换的粘贴
#[command]
pub async fn paste_with_focus() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();

    if let Some(prev_hwnd) = get_previous_window() {
        let result = unsafe { SetForegroundWindow(prev_hwnd as HWND) };
        if result == 0 {
            log::warn!("[Paste] 无法聚焦到上一个窗口");
        }
    } else {
        log::warn!("[Paste] 没有记录的上一个窗口");
    }

    wait(50);
    release_all_modifier_keys(&mut enigo);
    wait(10);

    enigo.key(Key::LShift, Press).unwrap();
    wait(5);
    enigo.key(Key::Insert, Click).unwrap();
    wait(5);
    enigo.key(Key::LShift, Release).unwrap();

    wait(20);
}
