const COMMANDS: &[&str] = &["create_tray", "destroy_tray", "update_tray_menu"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
