use rodio::{Decoder, OutputStream, Sink};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::thread;
use crossbeam_channel::{unbounded, Sender};
use tauri::{command, State};

// 音频命令枚举
#[derive(Debug)]
pub enum AudioCommand {
    Play { name: String, volume: f32 },
    Exit, // 添加优雅退出命令
}

// 音频服务结构体
#[derive(Clone)]
pub struct AudioService {
    pub tx: Sender<AudioCommand>,
}

impl AudioService {
    pub fn new() -> Self {
        let (tx, rx) = unbounded::<AudioCommand>();

        // 启动专门的音频线程
        thread::spawn(move || {
            println!("音频服务线程启动");

            // 预加载音频数据 - 使用更稳定的路径
            let mut preloaded = HashMap::new();
            let copy_audio_data = include_bytes!("../../../../assets/audio/copy.mp3").to_vec();
            preloaded.insert("copy".to_string(), Arc::new(copy_audio_data));

            // 音频播放循环
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    AudioCommand::Play { name, volume } => {
                        println!("音频线程收到播放命令: {}", name);
                        
                        // 每次播放时重新创建 OutputStream，确保使用当前默认设备
                        let (_stream, handle) = match OutputStream::try_default() {
                            Ok(s) => s,
                            Err(e) => {
                                eprintln!("音频错误: 无法初始化输出流 - {}", e);
                                continue;
                            }
                        };
                        
                        // 获取预加载的音频数据
                        if let Some(audio_data) = preloaded.get(&name) {
                            // 创建 Sink (音轨控制)
                            let sink = match Sink::try_new(&handle) {
                                Ok(s) => s,
                                Err(e) => {
                                    eprintln!("音频错误: 无法创建音频槽 - {}", e);
                                    continue;
                                }
                            };

                            // 从预加载的数据创建音频源
                            let cursor = Cursor::new((*audio_data).clone().to_vec());
                            
                            let source = match Decoder::new(cursor) {
                                Ok(s) => s,
                                Err(e) => {
                                    eprintln!("音频错误: 无法解码音频文件 - {}", e);
                                    continue;
                                }
                            };

                            // 设置音量
                            let vol = volume.clamp(0.0, 1.0);
                            sink.set_volume(vol);

                            // 播放音频
                            sink.append(source);

                            // 等待音频播放完成，确保 OutputStream 不被过早销毁
                            sink.sleep_until_end();
                            
                            println!("音频播放完成: {}", name);
                        } else {
                            eprintln!("音频错误: 未找到音频文件 '{}'", name);
                        }
                    }
                    AudioCommand::Exit => {
                        println!("收到退出命令，正在关闭音频服务线程");
                        break;
                    }
                }
            }
            
            println!("音频服务线程结束");
        });

        Self { tx }
    }

    // 添加优雅退出方法
    pub fn shutdown(&self) -> Result<(), String> {
        self.tx.send(AudioCommand::Exit)
            .map_err(|e| format!("Failed to send exit command: {}", e))
    }
}

// 音效管理器结构体（保持兼容性）
pub struct AudioManager {
    last_play_time: Arc<Mutex<HashMap<String, Instant>>>,
}

impl AudioManager {
    pub fn new() -> Self {
        AudioManager {
            last_play_time: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // 播放音效 - 通过 channel 发送到音频服务线程
    pub fn play_sound(&self, name: &str, volume: Option<f32>, audio_service: &AudioService) -> Result<(), String> {
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

        // 发送播放命令到音频服务线程
        let cmd = AudioCommand::Play {
            name: name.to_string(),
            volume: volume.unwrap_or(1.0),
        };

        audio_service.tx
            .send(cmd)
            .map_err(|e| format!("Failed to send audio command: {}", e))?;

        Ok(())
    }

    // 清理资源
    pub fn cleanup(&self, audio_service: &AudioService) -> Result<(), String> {
        println!("Audio manager cleaning up...");
        
        // 发送退出命令到音频服务线程
        audio_service.shutdown()?;
        
        println!("Audio manager cleaned up successfully");
        Ok(())
    }
}

// 播放音效
#[command]
pub async fn play_sound(
    name: String,
    volume: Option<f32>,
    manager: State<'_, AudioManager>,
    audio_service: State<'_, AudioService>,
) -> Result<(), String> {
    println!("play_sound command called for: {}", name);
    manager.play_sound(&name, volume, &audio_service.inner())
}

// 停止所有音效
#[command]
pub async fn stop_all_sounds(
    _manager: State<'_, AudioManager>,
) -> Result<(), String> {
    println!("Stop all sounds called (not implemented in current design)");
    Ok(())
}

// 清理音频资源
#[command]
pub async fn cleanup_audio(
    manager: State<'_, AudioManager>,
    audio_service: State<'_, AudioService>,
) -> Result<(), String> {
    manager.cleanup(&audio_service.inner())
}