const COMMANDS: &[&str] = &[
    "set_server_config",
    "get_server_config",
    "test_connection",
    "test_webdav_operations",
    "create_directory",
    "upload_sync_data",
    "download_sync_data"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}