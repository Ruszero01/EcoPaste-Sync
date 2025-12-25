const COMMANDS: &[&str] = &[
    "set_database_path",
    "query_history",
    "query_history_with_filter",
    "insert_with_deduplication",
    "mark_deleted",
    "batch_mark_deleted",
    "hard_delete",
    "batch_hard_delete",
    "get_statistics",
    "update_field",
    "mark_changed",
    "batch_mark_changed",
    "get_changed_items_count",
    "get_changed_items_list",
    "query_with_filter",
    "search_data",
    "query_by_group",
    "get_all_groups",
    "get_filtered_statistics",
    "get_database_info",
    "reset_database"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
