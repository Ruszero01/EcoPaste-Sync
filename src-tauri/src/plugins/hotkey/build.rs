const COMMANDS: &[&str] = &[
    "register_all_shortcuts",
    "get_blacklist_cmd",
    "add_to_blacklist_cmd",
    "remove_from_blacklist_cmd",
    "clear_blacklist_cmd",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
