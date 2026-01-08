use std::sync::atomic::AtomicBool;
use tauri::{
    command,
    image::Image,
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_eco_clipboard::{is_listen_enabled, toggle_listen as clipboard_toggle_listen};
use tauri_plugin_eco_window::{show_main_window, show_preference_window};

// 托盘菜单项 ID
const MENU_ITEM_SHOW: &str = "show";
const MENU_ITEM_PREFERENCE: &str = "preference";
const MENU_ITEM_TOGGLE_LISTEN: &str = "toggle_listen";
const MENU_ITEM_RELAUNCH: &str = "relaunch";
const MENU_ITEM_QUIT: &str = "quit";

/// 托盘状态
static TRAY_EXISTS: AtomicBool = AtomicBool::new(false);

/// 菜单项配置
#[derive(Debug, serde::Deserialize)]
pub struct MenuItemConfig {
    pub id: String,
    pub text: String,
}

/// 检查托盘是否存在
pub fn tray_exists() -> bool {
    TRAY_EXISTS.load(std::sync::atomic::Ordering::SeqCst)
}

/// 创建托盘菜单（使用 CheckMenuItemBuilder 来显示选中状态）
/// 返回菜单和监听开关菜单项（用于后续更新状态）
fn create_tray_menu<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<(Menu<R>, tauri::menu::CheckMenuItem<R>), String> {
    let listen_enabled = is_listen_enabled(app_handle);

    // 监听开关（带选中状态）
    let toggle_listen = CheckMenuItemBuilder::with_id(MENU_ITEM_TOGGLE_LISTEN, "监听剪贴板")
        .checked(listen_enabled)
        .build(app_handle)
        .map_err(|e| format!("创建监听开关菜单项失败: {}", e))?;

    // 分割线 1（监听开关和窗口之间）
    let separator1 =
        PredefinedMenuItem::separator(app_handle).map_err(|e| format!("创建分割线失败: {}", e))?;

    // 显示主窗口
    let show = MenuItemBuilder::with_id(MENU_ITEM_SHOW, "主窗口")
        .build(app_handle)
        .map_err(|e| format!("创建显示菜单项失败: {}", e))?;

    // 偏好设置
    let preference = MenuItemBuilder::with_id(MENU_ITEM_PREFERENCE, "偏好设置")
        .build(app_handle)
        .map_err(|e| format!("创建设置菜单项失败: {}", e))?;

    // 分割线 2（窗口和底部操作之间）
    let separator2 =
        PredefinedMenuItem::separator(app_handle).map_err(|e| format!("创建分割线失败: {}", e))?;

    // 重启应用
    let relaunch = MenuItemBuilder::with_id(MENU_ITEM_RELAUNCH, "重启应用")
        .build(app_handle)
        .map_err(|e| format!("创建重启菜单项失败: {}", e))?;

    // 退出
    let quit = MenuItemBuilder::with_id(MENU_ITEM_QUIT, "退出")
        .build(app_handle)
        .map_err(|e| format!("创建退出菜单项失败: {}", e))?;

    let menu = MenuBuilder::new(app_handle)
        .items(&[
            &toggle_listen,
            &separator1,
            &show,
            &preference,
            &separator2,
            &relaunch,
            &quit,
        ])
        .build()
        .map_err(|e| format!("构建菜单失败: {}", e))?;

    Ok((menu, toggle_listen))
}

/// 创建系统托盘
#[command]
pub async fn create_tray<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    // 如果托盘已存在，先销毁
    if tray_exists() {
        destroy_tray(app_handle.clone())?;
    }

    // 加载托盘图标
    let tray_icon = load_tray_icon(&app_handle)?;

    // 获取应用配置判断是否显示托盘
    let show_tray = should_show_tray(&app_handle);

    if !show_tray {
        return Ok(());
    }

    // 创建初始菜单
    let menu = create_tray_menu(&app_handle)?.0;

    // 构建托盘图标
    let _tray_icon = TrayIconBuilder::with_id("tray")
        .icon(tray_icon)
        .tooltip("EcoPaste-Sync")
        .show_menu_on_left_click(false) // 只在右键时显示菜单
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();

            match id {
                MENU_ITEM_SHOW => {
                    show_window_from_tray(app.clone(), "main".to_string());
                }
                MENU_ITEM_PREFERENCE => {
                    show_window_from_tray(app.clone(), "preference".to_string());
                }
                MENU_ITEM_TOGGLE_LISTEN => {
                    // 切换监听状态
                    clipboard_toggle_listen(&app);

                    // 重新创建菜单并更新托盘菜单（使用新的选中状态）
                    if let Ok((new_menu, _)) = create_tray_menu(&app) {
                        if let Some(tray) = app.tray_by_id("tray") {
                            let _ = tray.set_menu(Some(new_menu));
                        }
                    }
                }
                MENU_ITEM_RELAUNCH => {
                    // 发送事件让主程序允许退出
                    let _ = app.emit("tray://allow-exit-and-exit", ());
                    // 等待一小段时间让事件处理完成
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    // 重启应用
                    app.restart();
                }
                MENU_ITEM_QUIT => {
                    // 发送事件让主程序允许退出
                    let _ = app.emit("tray://allow-exit-and-exit", ());
                    // 等待一小段时间让事件处理完成
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    // 退出应用
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_window_from_tray(app.clone(), "main".to_string());
            }
        })
        .build(&app_handle)
        .map_err(|e| format!("创建托盘失败: {}", e))?;

    TRAY_EXISTS.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// 销毁系统托盘
#[command]
pub fn destroy_tray<R: Runtime>(_app_handle: AppHandle<R>) -> Result<(), String> {
    // Tauri 2.0 中托盘在 setup 时创建，无法动态销毁
    // 通过标记来控制是否显示
    TRAY_EXISTS.store(false, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// 更新托盘菜单
#[command]
pub async fn update_tray_menu<R: Runtime>(
    _app_handle: AppHandle<R>,
    _items: Vec<MenuItemConfig>,
) -> Result<(), String> {
    // 后续可以实现动态更新菜单
    Ok(())
}

/// 从托盘显示窗口
fn show_window_from_tray<R: Runtime>(app: AppHandle<R>, window_label: String) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match window_label.as_str() {
            "main" => {
                show_main_window(app_handle, None).await;
            }
            "preference" => {
                show_preference_window(app_handle, Some("center".to_string())).await;
            }
            _ => {}
        }
    });
}

/// 加载托盘图标
fn load_tray_icon<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Image<'static>, String> {
    // 打包后的资源路径格式：resourceDir/assets/tray.ico
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("获取资源目录失败: {}", e))?;
    let icon_path = resource_path.join("assets").join("tray.ico");

    Image::from_path(&icon_path).map_err(|e| format!("加载托盘图标失败: {}", e))
}

/// 检查是否应该显示托盘
fn should_show_tray<R: Runtime>(app_handle: &AppHandle<R>) -> bool {
    // 配置文件路径（与前端保持一致）
    // 开发环境: .store.dev.json
    // 生产环境: .store.json
    let is_dev = cfg!(debug_assertions);
    let config_filename = if is_dev {
        ".store.dev.json"
    } else {
        ".store.json"
    };

    // 优先使用 APPDATA 环境变量
    let config_path = if let Some(app_data_dir) = std::env::var_os("APPDATA") {
        std::path::PathBuf::from(app_data_dir)
            .join("com.Rains.EcoPaste-Sync")
            .join(config_filename)
    } else {
        // 备用方案
        match app_handle.path().app_data_dir() {
            Ok(path) => path.join(config_filename),
            Err(_) => {
                return true;
            }
        }
    };

    if !config_path.exists() {
        return true;
    }

    let config_content = match std::fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(_) => {
            return true;
        }
    };

    let config: serde_json::Value = match serde_json::from_str(&config_content) {
        Ok(config) => config,
        Err(_) => {
            return true;
        }
    };

    // 尝试获取托盘配置: clipboardStore.window.showTray
    if let Some(show_tray) = config
        .get("clipboardStore")
        .and_then(|cs| cs.get("window"))
        .and_then(|w| w.get("showTray"))
        .and_then(|t| t.as_bool())
    {
        return show_tray;
    }

    // 默认显示托盘
    true
}
