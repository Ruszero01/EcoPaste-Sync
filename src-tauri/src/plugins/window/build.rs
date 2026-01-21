const COMMANDS: &[&str] = &[
    "toggle_window",
    "show_taskbar_icon",
    "apply_mica_effect",
    "clear_mica_effect",
    "is_mica_supported",
    "create_window",
    "exit_app", // Internal: only for tray plugin
    "set_window_always_on_top",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
