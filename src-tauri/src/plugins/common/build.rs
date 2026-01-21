const COMMANDS: &[&str] = &[
    "get_current_window_info",
    "get_last_window_info",
    "get_foreground_window_info",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
