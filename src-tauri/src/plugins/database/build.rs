const COMMANDS: &[&str] = &[
    "set_database_path",
    "query_history",
    "query_history_with_filter",
    "query_sync_data",
    "update_sync_status",
    "batch_update_sync_status",
    "upsert_from_cloud",
    "insert_with_deduplication",
    "mark_deleted",
    "batch_mark_deleted",
    "hard_delete",
    "batch_hard_delete",
    "get_statistics",
    "update_favorite",
    "batch_update_favorite",
    "update_note",
    "update_content",
    "update_type",
    "mark_changed",
    "batch_mark_changed",
    "update_time",
    "get_changed_items_count",
    "get_changed_items_list",
    "query_with_filter",
    "query_for_sync",
    "search_data",
    "query_by_group",
    "get_all_groups",
    "get_filtered_statistics"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
