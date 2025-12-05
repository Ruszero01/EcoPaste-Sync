use commands::{AudioManager, AudioService, play_sound, stop_all_sounds, cleanup_audio};
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

mod commands;

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("eco-audio-effect")
        .setup(move |app, _api| {
            // 创建音频服务实例（启动音频线程）
            let audio_service = AudioService::new();
            app.manage(audio_service.clone());

            // 创建音频管理器实例
            let audio_manager = AudioManager::new();
            app.manage(audio_manager);

            println!("Audio effect plugin initialized successfully");
            Ok(())
        })
        .invoke_handler(generate_handler![
            play_sound,
            stop_all_sounds,
            cleanup_audio
        ])
        .build()
}