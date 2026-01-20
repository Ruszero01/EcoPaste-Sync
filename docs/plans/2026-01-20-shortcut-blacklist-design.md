# 快捷键黑名单功能设计文档

> 创建日期：2026-01-20

## 概述

实现快捷键黑名单功能，当活动窗口在黑名单中时，拦截 Alt+C、Alt+X 快捷键不显示 EcoPaste 窗口。同时统一窗口监听逻辑，避免重复代码。

### 技术约束（关键）

- **快捷键拦截在 Rust 端同步处理**，避免窗口闪烁
- **从 database 插件迁移代码到 common 插件**，避免重复实现
- **避免循环依赖**：common 插件可以被 hotkey、window、database 引用，但不能引用它们

### 配置结构

```json
{
  "globalStore": {
    "shortcut": {
      "blacklist": ["chrome.exe", "code.exe"]
    }
  }
}
```

```
┌──────────────────────────────────────────────────────────────────┐
│ common 插件：新增 active_window.rs                                │
│ - get_foreground_window_info() → HWND + 进程名 + 窗口标题 + 图标  │
│ - start_foreground_listener() → 启动持续监听（供 paste 共用）      │
│ - get_last_foreground_info() → 获取上一个前台窗口                  │
└──────────────────────────────────────────────────────────────────┘
         ▲                                           │
         │ 统一监听逻辑                               │ 使用
         │                                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ paste 插件                                                        │
│ - 移除 windows.rs 的重复监听逻辑                                  │
│ - 调用 common 的 start_foreground_listener()                      │
└──────────────────────────────────────────────────────────────────┘
         ▲                                           │
         │ 统一获取                                   │ 使用
         │                                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ database 插件                                                     │
│ - 移除 source_app.rs 的重复逻辑                                   │
│ - 调用 common 的 get_foreground_window_info()                     │
└──────────────────────────────────────────────────────────────────┘
         ▲                                           │
         │                                          │
         ▼                                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ hotkey 插件 + 前端 Blacklist                                      │
│ - 快捷键事件触发时，调用 common 检查黑名单                         │
│ - 前端显示"上一个窗口" + 加入黑名单按钮                           │
└──────────────────────────────────────────────────────────────────┘
```

## 配置结构

### 新增配置项

在 `clipboardStore` 配置节下新增：

```json
{
  "clipboardStore": {
    "shortcutBlacklist": ["chrome.exe", "code.exe"]
  }
}
```

## 功能模块

### 1. common 插件 - active_window.rs

#### 新增类型

```rust
pub struct ForegroundWindowInfo {
    pub hwnd: isize,
    pub process_name: String,
    pub window_title: String,
    pub app_icon: Option<String>,
}
```

#### 新增函数

| 函数 | 说明 |
|------|------|
| `get_foreground_window_info()` | 同步获取当前前台窗口信息 |
| `start_foreground_listener()` | 启动后台持续监听（设置 WinEventHook） |
| `get_last_foreground_info()` | 获取上一次前台窗口信息（供黑名单显示用） |
| `is_process_in_blacklist(process_name: &str) -> bool` | 检查进程是否在黑名单中 |

#### 跨平台实现

- **Windows**: 使用 `GetForegroundWindow` + `GetWindowThreadProcessId` + `OpenProcess`
- **macOS**: 使用 `NSWorkspace frontmostApplication`
- **Linux**: 使用 `xdotool getactivewindow` + `ps`

### 2. paste 插件 - 重构

#### 移除

- `src/commands/windows.rs` 文件

#### 修改

- `lib.rs` 中移除 `observe_app()` 调用，改为调用 `common::start_foreground_listener()`
- `commands/paste.rs` 中 `get_previous_window()` 改为调用 `common::get_last_foreground_info()`

### 3. database 插件 - 重构

#### 移除

- `source_app.rs` 中重复的窗口获取逻辑

#### 修改

- `fetch_source_app_info_impl()` 改为调用 `common::get_foreground_window_info()`

### 4. hotkey 插件 - commands.rs

#### 修改 `handle_shortcut_event()`

在显示窗口前，先检查黑名单：

```rust
fn handle_shortcut_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    shortcut: &Shortcut,
    _event: ShortcutEvent,
) {
    let shortcut_upper = shortcut.to_string().to_uppercase();
    let shortcut_normalized = shortcut_upper.replace("KEY", "").replace("DIGIT", "");

    // 检查是否是主快捷键（Alt+C 或 Alt+X）
    if shortcut_normalized == "ALT+C" || shortcut_normalized == "ALT+X" {
        // 检查黑名单
        if let Some(info) = common::get_last_foreground_info() {
            if common::is_process_in_blacklist(&info.process_name) {
                log::info!("[Hotkey] 快捷键 {} 被黑名单拦截: {}", shortcut_normalized, info.process_name);
                return; // 拦截，不显示窗口
            }
        }
    }

    // ... 原有显示窗口逻辑
}
```

### 5. 前端 - ActiveWinBar 组件

#### 位置

主页面（Main）底部，固定显示（不随列表滚动）。

#### 功能

1. 显示"上一个窗口"信息（进程名 + 图标）
2. 显示"加入黑名单"按钮
3. 点击按钮后弹出确认对话框

#### 组件结构

```
┌─────────────────────────────────────┐
│ [图标] Chrome  │ [加入黑名单]        │
└─────────────────────────────────────┘
```

#### 交互逻辑

1. 组件挂载时调用 `get_last_foreground_info` 获取信息
2. 用户点击"加入黑名单"按钮
3. 弹出确认对话框："确定将 Chrome 加入快捷键黑名单？"
4. 确认后调用 `add_to_blacklist` 保存到配置
5. 成功后显示 Toast 提示

### 6. 前端 - 快捷键设置页面

#### 位置

偏好设置 → 快捷键设置 Tab

#### 布局

```
┌─────────────────────────────────────────────────┐
│ 快捷键设置                                      │
├─────────────────────────────────────────────────┤
│ 主窗口快捷键                                    │
│ ┌─────────────────────────────────────────────┐ │
│ │ Alt+C      [编辑] [清除]                    │ │
│ └─────────────────────────────────────────────┘ │
│                                              │
│ 偏好设置快捷键                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Alt+X      [编辑] [清除]                    │ │
│ └─────────────────────────────────────────────┘ │
│                                              │
├─────────────────────────────────────────────────┤
│ ═══════════════════════════════════════════════ │ ← 分隔线
│                                              │
│ 快捷键黑名单                                   │
│ ┌─────────────────────────────────────────────┐ │
│ │ 当前黑名单：                                 │ │
│ │ • chrome.exe    [×]                         │ │
│ │ • code.exe      [×]                         │ │
│ │                                           │ │
│ │ [添加应用]                                  │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

#### 功能

1. 显示当前黑名单列表
2. 每个项目显示进程名和删除按钮
3. "添加应用"按钮点击后显示当前活动窗口列表供选择

## 数据流

### 快捷键触发流程

```
用户按 Alt+C
       │
       ▼
┌─────────────────┐
│ hotkey 插件     │──读取配置的黑名单列表────────────────────┐
└────────┬────────┘                                        │
         │ 不在黑名单                                      │ 在黑名单
         ▼                                                 ▼
┌─────────────────┐                                ┌─────────────────┐
│ 显示 EcoPaste   │                                │ 拦截（不显示）   │
└────────┬────────┘                                └─────────────────┘
         │
         │ 窗口显示后
         ▼
┌─────────────────┐
│ 前端 ActiveWinBar│
│ 显示上一个窗口   │──用户点击"加入黑名单"──→ 保存到配置
└─────────────────┘
```

### 窗口监听流程

```
┌─────────────────────────────────────────────┐
│ 应用启动                                     │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ common::start_foreground_listener()         │
│ (设置 WinEventHook 监听前台窗口变化)         │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 事件：前台窗口变化                           │
│ • 更新内部 last_foreground 状态              │
│ • 供 paste 恢复焦点使用                      │
│ • 供黑名单检查使用                          │
└─────────────────────────────────────────────┘
```

## 跨平台注意事项

| 平台 | 获取前台窗口 | 获取进程路径 | 注意事项 |
|------|-------------|-------------|---------|
| Windows | `GetForegroundWindow` | `QueryFullProcessImageNameW` | 使用 `PROCESS_QUERY_LIMITED_INFORMATION` |
| macOS | `NSWorkspace frontmostApplication` | `bundleURL.path` | 返回 bundle identifier |
| Linux | `xdotool getactivewindow` | `/proc/{pid}/exe` | 依赖 xdotool 工具 |

## 测试用例

1. **黑名单拦截测试**
   - [ ] Chrome 在黑名单中，按 Alt+C 不显示窗口
   - [ ] 从黑名单移除后，Alt+C 正常显示窗口
   - [ ] 偏好设置窗口同样受黑名单拦截

2. **窗口监听测试**
   - [ ] 切换窗口后，ActiveWinBar 显示正确
   - [ ] 粘贴后焦点恢复到上一个窗口

3. **跨平台测试**
   - [ ] Windows 平台正常拦截
   - [ ] macOS 平台正常拦截
   - [ ] Linux 平台正常拦截

## 依赖更新

### common/Cargo.toml

新增依赖：

```toml
# Windows API
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = ["Win32_UI_WindowsAndMessaging", "Win32_System_Threading"] }

# macOS
[target.'cfg(target_os = "macos")'.dependencies]
cocoa = "0.26"
objc = "0.2"

# 文件图标获取
file_icon_provider.workspace = true

# 图像处理
image.workspace = true
```

## 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/plugins/common/src/active_window.rs` | 新增 | 统一窗口监听模块 |
| `src-tauri/src/plugins/common/src/lib.rs` | 修改 | 导出 active_window 模块 |
| `src-tauri/src/plugins/common/Cargo.toml` | 修改 | 添加跨平台依赖 |
| `src-tauri/src/plugins/paste/src/commands/windows.rs` | 删除 | 移除重复监听逻辑 |
| `src-tauri/src/plugins/paste/src/commands/mod.rs` | 修改 | 移除 windows.rs 导入 |
| `src-tauri/src/plugins/paste/src/lib.rs` | 修改 | 调用 common 监听 |
| `src-tauri/src/plugins/database/src/source_app.rs` | 修改 | 调用 common 获取窗口信息 |
| `src-tauri/src/plugins/hotkey/src/commands.rs` | 修改 | 添加黑名单检查 |
| `src/types/plugin.d.ts` | 修改 | 添加前端调用类型 |
| `src/plugins/window.ts` | 修改 | 添加获取窗口信息接口 |
| `src/plugins/hotkey.ts` | 修改 | 添加黑名单操作接口 |
| `src/pages/Main/components/ActiveWinBar/index.tsx` | 新增 | 活动窗口显示组件 |
| `src/pages/Main/components/Footer/index.tsx` | 修改 | 集成 ActiveWinBar |
| `src/pages/Preference/components/Shortcut/index.tsx` | 修改 | 添加黑名单设置区域 |

---

## 权限配置检查清单

**注意**：`should_block_shortcut()` 是内部函数，无需配置权限。

权限配置规范（参考 `docs/Tauri 后端插件配置规范.md`）：

| 配置位置 | 内容 |
|---------|------|
| `plugins/hotkey/permissions/default.toml` | `allow-get_blacklist`, `allow-refresh_blacklist_cache` |
| `plugins/window/permissions/default.toml` | `allow-get_active_window_info` |
| `capabilities/default.json` | `"eco-hotkey:default"`, `"eco-window:default"` |

**检查清单**：
- [ ] 所有前端调用的命令都加入了 `build.rs` 的 `COMMANDS` 数组
- [ ] 所有前端调用的命令都在插件的 `permissions/default.toml` 中配置了 `allow-xxx` 权限
- [ ] `capabilities/default.json` 中注册了插件的默认权限（无需逐个列出命令）

---

## 循环依赖说明

依赖方向：
```
hotkey → common ← window
              ↓
          database
```

**common 插件可以被 hotkey、window、database 引用，但不能引用它们。**

---

## 性能考虑

- **快捷键拦截在 Rust 端同步执行**，无前端异步调用开销，避免窗口闪烁
- 活跃窗口指示器使用 paste 记录的"上一个窗口"（事件驱动，无轮询）
- 图标获取涉及文件 I/O，建议添加缓存机制
- 黑名单匹配使用简单字符串数组遍历，项数少时性能可接受
- `refresh_blacklist_cache()` 确保配置变更后立即生效

