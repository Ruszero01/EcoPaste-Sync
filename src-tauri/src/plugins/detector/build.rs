const COMMANDS: &[&str] = &["detect_content", "convert_color"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
