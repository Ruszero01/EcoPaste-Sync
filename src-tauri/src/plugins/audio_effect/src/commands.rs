use rodio::{Decoder, OutputStream, Sink};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{command, State};

// 音效管理器结构体
pub struct AudioManager {
    last_play_time: Arc<Mutex<HashMap<String, Instant>>>,
}

impl AudioManager {
    pub fn new() -> Self {
        AudioManager {
            last_play_time: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // 播放音效 - 使用编译进二进制的音频数据
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

        // 在新线程中播放音频，避免阻塞主线程
        let name_clone = name.to_string();
        std::thread::spawn(move || {
            println!("Playing sound: {}", name_clone);
            
            // 获取默认音频输出流
            let (_stream, stream_handle) = match OutputStream::try_default() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("音频错误: 无法找到输出设备 - {}", e);
                    return;
                }
            };

            // 创建 Sink (音轨控制)
            let sink = match Sink::try_new(&stream_handle) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("音频错误: 无法创建音频槽 - {}", e);
                    return;
                }
            };

            // 加载音频数据 (直接编译进 exe，零路径烦恼)
            let sound_data = include_bytes!("../../../../../src/assets/audio/copy.mp3");
            let cursor = Cursor::new(sound_data);
            
            let source = match Decoder::new(cursor) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("音频错误: 无法解码音频文件 - {}", e);
                    return;
                }
            };

            // 设置音量
            let vol = volume.unwrap_or(1.0).clamp(0.0, 1.0);
            sink.set_volume(vol);

            // 播放音频
            sink.append(source);

            // 【至关重要】阻塞线程直到播放结束
            // 如果没有这一行，线程会立即结束，_stream 变量被销毁，导致硬件连接断开，从而没声音
            sink.sleep_until_end();
            
            println!("Sound playback completed: {}", name_clone);
        });

        Ok(())
    }

    // 清理资源
    pub fn cleanup(&self) {
        println!("Audio manager cleaned up");
    }
}

// 播放音效
#[command]
pub async fn play_sound(
    name: String,
    volume: Option<f32>,
    manager: State<'_, AudioManager>,
) -> Result<(), String> {
    println!("play_sound command called for: {}", name);
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