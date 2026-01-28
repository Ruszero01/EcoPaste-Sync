const COMMANDS: &[&str] = &["paste", "paste_with_focus", "quick_paste", "batch_paste", "single_paste", "paste_color"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
