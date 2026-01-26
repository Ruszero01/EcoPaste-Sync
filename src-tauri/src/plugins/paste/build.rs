const COMMANDS: &[&str] = &["paste", "paste_with_focus", "quick_paste", "batch_paste"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
