use tauri::{AppHandle, Emitter};
use std::thread;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use std::sync::LazyLock;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AutoSyncStatus {
    pub enabled: bool,
    pub interval_hours: u64,
    pub last_sync_time: Option<u64>,
    pub next_sync_time: Option<u64>,
}

// 线程安全的全局状态
static AUTO_SYNC_STATUS: LazyLock<Arc<Mutex<Option<AutoSyncStatus>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));

static TIMER_HANDLE: LazyLock<Arc<Mutex<Option<thread::JoinHandle<()>>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));

#[tauri::command]
pub async fn start_auto_sync(app_handle: AppHandle, interval_hours: u64) -> Result<(), String> {
    // 验证间隔时间
    if interval_hours == 0 {
        return Err("Interval hours must be greater than 0".to_string());
    }

    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // 停止现有定时器
    stop_existing_timer()?;

    // 更新状态
    {
        let mut status = AUTO_SYNC_STATUS.lock().unwrap();
        *status = Some(AutoSyncStatus {
            enabled: true,
            interval_hours,
            last_sync_time: Some(current_time),
            next_sync_time: Some(current_time + (interval_hours * 3600)),
        });
    }

    // 启动新的定时器
    start_sync_timer(app_handle, interval_hours)?;

    log::info!("Auto sync started with interval: {} hours", interval_hours);

    Ok(())
}

/// 启动同步定时器
fn start_sync_timer(app_handle: AppHandle, interval_hours: u64) -> Result<(), String> {
    let interval_duration = Duration::from_secs(interval_hours * 3600);
    let app_handle_clone = app_handle.clone();

    let handle = thread::spawn(move || {
        // 首次延迟30秒执行，让应用完全启动
        thread::sleep(Duration::from_secs(30));

        loop {
            // 检查是否还在启用状态
            let is_enabled = {
                let status = AUTO_SYNC_STATUS.lock().unwrap();
                status.as_ref().map(|s| s.enabled).unwrap_or(false)
            };

            if !is_enabled {
                log::info!("Auto sync timer stopped (disabled)");
                break;
            }

            // 执行同步
            log::info!("Executing auto sync...");

            let current_time = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();

            // 更新最后同步时间
            {
                let mut status = AUTO_SYNC_STATUS.lock().unwrap();
                if let Some(ref mut s) = status.as_mut() {
                    s.last_sync_time = Some(current_time);
                    s.next_sync_time = Some(current_time + (s.interval_hours * 3600));
                }
            }

            // 触发前端同步事件
            if let Err(e) = app_handle_clone.emit("auto-sync-trigger", serde_json::json!({
                "timestamp": current_time,
                "type": "background_sync"
            })) {
                log::error!("Failed to emit auto sync trigger: {}", e);
            }

            log::info!("Auto sync completed, next sync in {} hours", interval_hours);

            // 等待下次同步
            thread::sleep(interval_duration);
        }
    });

    // 保存定时器句柄
    {
        let mut handle_guard = TIMER_HANDLE.lock().unwrap();
        *handle_guard = Some(handle);
    }

    Ok(())
}

/// 停止现有的定时器
fn stop_existing_timer() -> Result<(), String> {
    let mut handle_guard = TIMER_HANDLE.lock().unwrap();
    if let Some(_handle) = handle_guard.take() {
        log::info!("Stopping existing auto sync timer");
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_auto_sync() -> Result<(), String> {
    // 更新状态
    {
        let mut status = AUTO_SYNC_STATUS.lock().unwrap();
        if let Some(ref mut s) = status.as_mut() {
            s.enabled = false;
            s.next_sync_time = None;
        }
    }

    // 停止定时器
    stop_existing_timer()?;

    log::info!("Auto sync stopped");
    Ok(())
}

#[tauri::command]
pub async fn get_auto_sync_status() -> Result<AutoSyncStatus, String> {
    let status = AUTO_SYNC_STATUS.lock().unwrap();
    match status.as_ref() {
        Some(status) => Ok(status.clone()),
        None => Ok(AutoSyncStatus {
            enabled: false,
            interval_hours: 1,
            last_sync_time: None,
            next_sync_time: None,
        })
    }
}

#[tauri::command]
pub async fn update_sync_interval(app_handle: AppHandle, interval_hours: u64) -> Result<(), String> {
    // 验证间隔时间
    if interval_hours == 0 {
        return Err("Interval hours must be greater than 0".to_string());
    }

    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let should_restart = {
        let mut status = AUTO_SYNC_STATUS.lock().unwrap();
        if let Some(ref mut s) = status.as_mut() {
            s.interval_hours = interval_hours;

            // 如果当前正在运行，更新下次同步时间并重启定时器
            if s.enabled {
                s.next_sync_time = Some(current_time + (interval_hours * 3600));
                true
            } else {
                false
            }
        } else {
            // 如果还没有状态，创建一个新状态（但禁用的）
            *status = Some(AutoSyncStatus {
                enabled: false,
                interval_hours,
                last_sync_time: None,
                next_sync_time: None,
            });
            false
        }
    };

    // 如果需要重启定时器
    if should_restart {
        stop_existing_timer()?;
        start_sync_timer(app_handle, interval_hours)?;
    }

    log::info!("Auto sync interval updated to: {} hours", interval_hours);
    Ok(())
}