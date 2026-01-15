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
    "upload_local_config",
    "apply_remote_config",
    // 书签本地管理命令
    "load_bookmark_data",
    "save_bookmark_data",
    "add_bookmark_group",
    "update_bookmark_group",
    "delete_bookmark_group",
    "reorder_bookmark_groups",
    "clear_bookmark_data",
    // 服务器配置本地管理命令
    "save_server_config",
    "load_server_config",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
