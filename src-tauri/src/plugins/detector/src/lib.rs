use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};
use std::sync::Mutex;

mod commands;
mod models;
mod detectors;

pub use commands::detect_content;
pub use commands::run_detection;
pub use commands::convert_color;
pub use commands::ColorConvertResult;
pub use models::TypeDetectionResult;
pub use detectors::{DetectionOptions, DetectionResult, detect_color, get_color_format, conversion};

/// Detector 插件状态
pub struct DetectorState(Mutex<()>);

impl DetectorState {
    /// 创建新的 DetectorState
    pub fn new() -> Self {
        Self(Mutex::new(()))
    }

    /// 检测内容类型（同步调用）
    pub fn detect_content(
        &self,
        content: String,
        item_type: String,
        options: DetectionOptions,
    ) -> Result<TypeDetectionResult, String> {
        let _guard = self.0.lock().map_err(|e| e.to_string())?;

        // 只有文本类型才需要进行子类型检测
        if item_type != "text" {
            return Ok(TypeDetectionResult::default());
        }

        // 按优先级进行检测
        let result = run_detection(&content, &options);

        Ok(TypeDetectionResult {
            subtype: result.subtype,
            is_code: result.is_code,
            code_language: result.code_language,
            is_markdown: result.is_markdown,
            color_normalized: result.color_normalized,
        })
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-detector")
        .setup(|app, _api| {
            app.manage(DetectorState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::detect_content, commands::convert_color])
        .build()
}
