const COMMANDS: &[&str] = &[
    "get_active_window_info", 
    "get_app_icon"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
