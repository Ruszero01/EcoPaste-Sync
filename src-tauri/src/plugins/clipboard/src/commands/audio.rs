use rodio::{Decoder, OutputStream, Source};
use std::io::Cursor;
use std::thread;

/// 嵌入的音效数据（MP3 格式）
const COPY_AUDIO_DATA: &[u8] = include_bytes!("../../../../../assets/audio/copy.mp3");

/// 播放复制音效
/// 使用独立线程播放，不阻塞主流程
pub fn play_copy_audio() {
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
