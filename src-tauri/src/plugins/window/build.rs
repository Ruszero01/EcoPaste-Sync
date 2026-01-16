const COMMANDS: &[&str] = &[
    "toggle_window",
    "show_taskbar_icon",
    "apply_mica_effect",
    "clear_mica_effect",
    "is_mica_supported",
    "create_window",
    "exit_app", // Internal: only for tray plugin
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
