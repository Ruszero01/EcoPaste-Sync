const COMMANDS: &[&str] = &[
    "query_history_with_filter",
    "delete_items",
    "update_field",
    "cleanup_history",
    "reset_database",
    "get_database_info",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
