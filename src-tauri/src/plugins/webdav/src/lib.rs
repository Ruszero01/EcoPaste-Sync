use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-webdav")
        .invoke_handler(generate_handler![
            commands::set_server_config,
            commands::get_server_config,
            commands::test_connection,
            commands::test_webdav_operations,
            commands::create_directory,
            commands::upload_sync_data,
            commands::download_sync_data
        ])
        .build()
}