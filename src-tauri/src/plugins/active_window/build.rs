const COMMANDS: &[&str] = &["get_active_window_info"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
