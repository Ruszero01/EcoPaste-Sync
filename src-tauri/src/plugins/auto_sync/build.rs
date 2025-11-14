const COMMANDS: &[&str] = &[
    "start_auto_sync",
    "stop_auto_sync",
    "get_auto_sync_status",
    "update_sync_interval"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}