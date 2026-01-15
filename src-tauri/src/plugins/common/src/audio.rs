//! 音频播放模块
//! 提供复制音效播放功能

use rodio::{Decoder, OutputStream, Source};
use std::io::Cursor;
use std::thread;

use tauri::{AppHandle, Runtime};

use crate::config as common_config;

/// 嵌入的音效数据（MP3 格式）
const COPY_AUDIO_DATA: &[u8] = include_bytes!("../../../../assets/audio/copy.mp3");

/// 检查是否启用复制音效
pub fn should_play_copy_audio<R: Runtime>(app_handle: &AppHandle<R>) -> bool {
    match common_config::get_cached_config(app_handle) {
        Ok(config) => {
            // 检查 clipboardStore.audio.copy
            common_config::get_nested(&config, &["clipboardStore", "audio", "copy"])
                .and_then(|v| v.as_bool())
                .unwrap_or(false) // 默认关闭
        }
        Err(_) => false,
    }
}

/// 播放复制音效
/// 使用独立线程播放，不阻塞主流程
pub fn play_copy_audio<R: Runtime>(app_handle: &AppHandle<R>) {
    // 检查是否启用音效
    if !should_play_copy_audio(app_handle) {
        return;
    }

    thread::spawn(move || {
        // 获取默认音频输出设备
        let (_stream, stream_handle) = match OutputStream::try_default() {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[Audio] 无法打开音频设备: {}", e);
                return;
            }
        };

        // 解码音频数据
        let cursor = Cursor::new(COPY_AUDIO_DATA);
        let source: Decoder<Cursor<&[u8]>> = match Decoder::new_mp3(cursor) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[Audio] 音频解码失败: {}", e);
                return;
            }
        };

        // 播放音频
        if let Err(e) = stream_handle.play_raw(source.convert_samples()) {
            log::warn!("[Audio] 音频播放失败: {}", e);
        }

        // 等待音频播放完成
        thread::sleep(std::time::Duration::from_millis(300));
    });
}
