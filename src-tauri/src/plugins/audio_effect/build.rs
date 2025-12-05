const COMMANDS: &[&str] = &[
    "init_audio_manager",
    "preload_audio",
    "play_sound",
    "stop_all_sounds",
    "cleanup_audio"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}