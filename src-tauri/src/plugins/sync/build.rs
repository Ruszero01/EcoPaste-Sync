const COMMANDS: &[&str] = &[
    "init_sync",
    "start_sync",
    "stop_sync",
    "get_sync_status",
    "trigger_sync",
    "start_auto_sync",
    "stop_auto_sync",
    "get_auto_sync_status",
    "update_auto_sync_interval",
    "notify_data_changed",
    "test_webdav_connection",
    "get_sync_progress",
    "update_sync_config",
    "get_sync_config",
    "upload_file",
    "download_file",
    "delete_file",
    "sync_file_batch",
    "delete_files",
    "get_file_sync_config",
    "update_file_sync_config",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
