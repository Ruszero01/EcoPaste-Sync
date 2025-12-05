const COMMANDS: &[&str] = &[
    "show_window",
    "show_window_with_position",
    "hide_window",
    "show_taskbar_icon",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
