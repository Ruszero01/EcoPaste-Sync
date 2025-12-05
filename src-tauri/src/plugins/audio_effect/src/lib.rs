use commands::{AudioManager, init_audio_manager, play_sound, preload_audio, stop_all_sounds, cleanup_audio};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{
    generate_handler,
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

mod commands;

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("eco-audio-effect")
        .setup(move |app, _api| {
            // 创建音频管理器实例
            let audio_manager = AudioManager::new();
            app.manage(audio_manager);

            // 预加载默认音效文件
            let app_handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                println!("Starting audio preload...");
                
                // 获取应用资源目录
                let resource_dir = app_handle
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                
                println!("Resource directory: {:?}", resource_dir);

                // 尝试多个可能的路径
                let possible_paths = vec![
                    resource_dir.join("audio/copy.mp3"),
                    resource_dir.join("assets/audio/copy.mp3"),
                    PathBuf::from("assets/audio/copy.mp3"),
                    PathBuf::from("src/assets/audio/copy.mp3"),
                ];

                let mut found_path = None;
                for path in &possible_paths {
                    println!("Checking path: {:?}", path);
                    if path.exists() {
                        found_path = Some(path.clone());
                        break;
                    }
                }

                if let Some(path) = found_path {
                    let path_str = path.to_string_lossy().to_string();
                    println!("Found audio file at: {}", path_str);
                    
                    // 直接调用内部方法预加载
                    let audio_manager = app_handle.state::<AudioManager>();
                    let manager = audio_manager.inner();
                    if let Err(e) = manager.preload_audio("copy", "assets/audio/copy.mp3", &app_handle) {
                        eprintln!("Failed to preload copy sound: {}", e);
                    } else {
                        println!("Successfully preloaded copy sound");
                    }
                } else {
                    eprintln!("Could not find copy.mp3 in any of the expected locations");
                    // 列出所有尝试的路径
                    for (i, path) in possible_paths.iter().enumerate() {
                        eprintln!("  {}: {:?}", i, path);
                    }
                }

                // 初始化音频管理器
                let mut audio_files = HashMap::new();
                audio_files.insert("copy".to_string(), "assets/audio/copy.mp3".to_string());
                
                if let Err(e) = init_audio_manager(audio_files).await {
                    eprintln!("Failed to initialize audio manager: {}", e);
                } else {
                    println!("Audio manager initialized successfully");
                }
            });

            Ok(())
        })
        .invoke_handler(generate_handler![
            init_audio_manager,
            preload_audio,
            play_sound,
            stop_all_sounds,
            cleanup_audio
        ])
        .build()
}