use rodio::{
    Decoder, OutputStream, Sink, Source,
};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{command, Manager, State};

// 音效管理器结构体
pub struct AudioManager {
    audio_cache: Arc<Mutex<HashMap<String, String>>>, // 存储文件路径而不是解码器
    last_play_time: Arc<Mutex<HashMap<String, Instant>>>,
}

impl AudioManager {
    pub fn new() -> Self {
        AudioManager {
            audio_cache: Arc::new(Mutex::new(HashMap::new())),
            last_play_time: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // 预加载音频文件
    pub fn preload_audio(&self, name: &str, file_path: &str, app_handle: &tauri::AppHandle) -> Result<(), String> {
        // 解析资源路径
        let resolved_path = if file_path.starts_with("assets/") {
            // 如果是相对路径，尝试解析为资源路径
            match app_handle.path().resource_dir() {
                Ok(resource_dir) => {
                    let relative_path = file_path.strip_prefix("assets/").unwrap_or(file_path);
                    let resource_path = resource_dir.join(relative_path);
                    
                    // 检查资源文件是否存在
                    if resource_path.exists() {
                        resource_path.to_string_lossy().to_string()
                    } else {
                        // 尝试其他可能的路径
                        let alternatives = vec![
                            resource_dir.join("audio").join("copy.mp3"),
                            resource_dir.join("assets").join("audio").join("copy.mp3"),
                            PathBuf::from("assets/audio/copy.mp3"),
                            PathBuf::from("src/assets/audio/copy.mp3"),
                        ];
                        
                        for path in alternatives {
                            if path.exists() {
                                println!("Found audio file at: {}", path.display());
                                return self.preload_audio_with_path(name, &path.to_string_lossy());
                            }
                        }
                        
                        format!("Audio file not found at any expected location for: {}", file_path)
                    }
                }
                Err(_) => {
                    // 如果无法获取资源目录，尝试当前工作目录
                    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                    current_dir.join(file_path).to_string_lossy().to_string()
                }
            }
        } else {
            file_path.to_string()
        };

        self.preload_audio_with_path(name, &resolved_path)
    }
    
    fn preload_audio_with_path(&self, name: &str, resolved_path: &str) -> Result<(), String> {
        let mut cache = self.audio_cache.lock().unwrap();
        cache.insert(name.to_string(), resolved_path.to_string());
        
        println!("Preloaded audio: {} from {}", name, resolved_path);
        Ok(())
    }

    // 播放音效
    pub fn play_sound(&self, name: &str, volume: Option<f32>) -> Result<(), String> {
        // 检查最小播放间隔，防止过快重复播放
        {
            let mut last_play = self.last_play_time.lock().unwrap();
            if let Some(last_time) = last_play.get(name) {
                if last_time.elapsed() < Duration::from_millis(50) {
                    return Err("Too frequent playback".to_string());
                }
            }
            last_play.insert(name.to_string(), Instant::now());
        }

        // 获取音频文件路径
        let file_path = {
            let cache = self.audio_cache.lock().unwrap();
            cache.get(name).cloned()
        };

        if let Some(path) = file_path {
            // 每次播放时都重新创建音频流，确保设备可用
            let (_stream, stream_handle) = OutputStream::try_default()
                .map_err(|e| format!("Failed to initialize audio stream: {}", e))?;

            // 每次播放时重新加载文件，避免所有权问题
            let file = File::open(&path)
                .map_err(|e| format!("Failed to open audio file: {}", e))?;
            
            let reader = BufReader::new(file);
            let decoder = Decoder::new(reader)
                .map_err(|e| format!("Failed to decode audio file: {}", e))?;

            // 创建新的音频接收器
            let sink = Sink::try_new(&stream_handle)
                .map_err(|e| format!("Failed to create sink: {}", e))?;

            // 设置音量
            if let Some(vol) = volume {
                sink.set_volume(vol.clamp(0.0, 1.0));
            }

            // 播放音频
            let source = decoder.convert_samples::<f32>();
            sink.append(source);

            // 让音频在后台播放
            sink.detach();

            println!("Playing sound: {} from {}", name, path);
            Ok(())
        } else {
            Err(format!("Audio not found: {}", name))
        }
    }

    // 清理资源
    pub fn cleanup(&self) {
        let mut cache = self.audio_cache.lock().unwrap();
        cache.clear();
        
        println!("Audio manager cleaned up");
    }
}

// 初始化音频管理器
#[command]
pub async fn init_audio_manager(
    audio_files: HashMap<String, String>,
) -> Result<(), String> {
    // 这个命令会在插件初始化时调用
    println!("Audio manager initialized with {} files", audio_files.len());
    Ok(())
}

// 预加载音频文件
#[command]
pub async fn preload_audio(
    name: String,
    file_path: String,
    manager: State<'_, AudioManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    manager.preload_audio(&name, &file_path, &app_handle)
}

// 播放音效
#[command]
pub async fn play_sound(
    name: String,
    volume: Option<f32>,
    manager: State<'_, AudioManager>,
) -> Result<(), String> {
    println!("play_sound command called for: {}", name);
    
    // 检查音频是否已预加载
    let file_path = {
        let cache = manager.audio_cache.lock().unwrap();
        let path = cache.get(&name).cloned();
        println!("Audio cache lookup for '{}': {:?}", name, path);
        path
    };
    
    if file_path.is_none() {
        // 如果没有预加载，尝试使用默认路径
        println!("Audio not preloaded, trying default path");
        return Err(format!("Audio '{}' not preloaded. Call preload_audio first.", name));
    }
    
    manager.play_sound(&name, volume)
}

// 停止所有音效
#[command]
pub async fn stop_all_sounds(
    _manager: State<'_, AudioManager>,
) -> Result<(), String> {
    // 由于我们不再存储 sinks，这个功能暂时不可用
    println!("Stop all sounds called (not implemented in current design)");
    Ok(())
}

// 清理音频资源
#[command]
pub async fn cleanup_audio(
    manager: State<'_, AudioManager>,
) -> Result<(), String> {
    manager.cleanup();
    Ok(())
}