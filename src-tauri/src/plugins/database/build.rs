const COMMANDS: &[&str] = &[
    "set_database_path",
    "query_history",
    "query_sync_data",
    "update_sync_status",
    "batch_update_sync_status",
    "upsert_from_cloud",
    "mark_deleted",
    "get_statistics"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
