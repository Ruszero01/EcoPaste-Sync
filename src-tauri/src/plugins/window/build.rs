const COMMANDS: &[&str] = &[
    "show_window",
    "show_window_with_position",
    "destroy_window",
    "destroy_all_windows",
    "exit_app",
    "show_taskbar_icon",
    "show_main_window",
    "show_preference_window",
    "apply_mica_effect",
    "clear_mica_effect",
    "is_mica_supported",
    "create_window",
    "close_webview_for_test",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
