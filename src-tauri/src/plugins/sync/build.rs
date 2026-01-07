const COMMANDS: &[&str] = &[
    "init_sync",
    "get_sync_status",
    "trigger_sync",
    "start_auto_sync",
    "stop_auto_sync",
    "get_auto_sync_status",
    "update_auto_sync_interval",
    "test_webdav_connection",
    "update_sync_config",
    "reload_config_from_file",
    "save_connection_test_result",
    "upload_local_config",
    "apply_remote_config",
    "set_bookmark_sync_data",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
