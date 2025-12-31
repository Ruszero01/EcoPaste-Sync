const COMMANDS: &[&str] = &[
    "register_shortcut",
    "unregister_shortcut",
    "unregister_all_shortcuts",
    "register_default_shortcuts",
    "register_all_shortcuts",
    "get_shortcut_state",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
