use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod sync_engine;
mod types;
mod webdav;
mod auto_sync_manager;
mod sync_core;
mod data_manager;
mod file_sync_manager;
mod cleanup_manager;
mod events;

pub use sync_engine::{create_shared_engine, CloudSyncEngine};
pub use types::*;
pub use webdav::{create_shared_client, WebDAVClientState, WebDAVConfig};
pub use auto_sync_manager::{create_shared_manager, AutoSyncManagerState};
pub use sync_core::{
    SyncCore, SyncModeConfig, SyncDataItem, SyncIndex, SyncProcessResult, SyncStatistics,
    StateValidationResult, SyncDataStatus
};
pub use data_manager::{DataManager, create_shared_manager as create_data_manager};
pub use file_sync_manager::{
    FileSyncManager, FileMetadata, FileUploadTask, FileDownloadTask, FileOperationResult,
    FileSyncBatch, FileSyncProgress, FileSyncStrategy, FileSyncConfig,
    create_shared_manager as create_file_sync_manager
};
pub use cleanup_manager::{CleanupManager, CleanupConfig, CleanupStatus};
pub use events::{EventEmitter, SyncEvent, create_shared_emitter};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-sync")
        .invoke_handler(generate_handler![
            commands::init_sync,
            commands::start_sync,
            commands::stop_sync,
            commands::get_sync_status,
            commands::trigger_sync,
            commands::start_auto_sync,
            commands::stop_auto_sync,
            commands::get_auto_sync_status,
            commands::update_auto_sync_interval,
            commands::test_webdav_connection,
            commands::get_sync_progress,
            commands::update_sync_config,
            commands::get_sync_config,
            commands::upload_file,
            commands::download_file,
            commands::delete_file,
            commands::sync_file_batch,
            commands::delete_files,
            commands::get_file_sync_config,
            commands::update_file_sync_config
        ])
        .build()
}
