# EcoPaste 云同步架构图

## 系统架构概览

```mermaid
graph TB
    subgraph "前端层 Frontend Layer"
        UI[用户界面组件<br/>CloudSync/index.tsx<br/>ImmediateSyncButton.tsx<br/>syncModeConfig.ts]
        State[状态管理<br/>globalStore<br/>Valtio状态管理]
        Hooks[React Hooks<br/>useTauriListen<br/>事件监听]
    end

    subgraph "业务逻辑层 Business Logic Layer"
        SyncEngine[同步引擎核心<br/>syncEngine.ts<br/>performBidirectionalSync]
        LocalData[本地数据管理器<br/>localDataManager.ts<br/>filterItemsBySyncMode]
        CloudData[云端数据管理器<br/>cloudDataManager.ts<br/>CloudSyncData管理]
        FileSync[文件同步管理器<br/>fileSyncManager.ts<br/>文件包处理]
        AutoSync[自动同步管理器<br/>autoSync.ts<br/>事件监听和状态同步]
        ConflictResolver[冲突解决器<br/>syncConflictResolver.ts<br/>detectRealConflicts]
        ConfigSync[配置同步管理器<br/>configSync.ts<br/>配置上传下载]
    end

    subgraph "网络传输层 Network Layer"
        WebDAVClient[WebDAV 前端接口<br/>webdav.ts<br/>API封装和认证]
        TauriPlugin1[eco-webdav插件<br/>Rust WebDAV实现<br/>HTTP请求和文件操作]
        TauriPlugin2[eco-auto-sync插件<br/>Rust自动同步实现<br/>后台定时器和状态管理]
    end

    subgraph "数据存储层 Data Storage Layer"
        SQLite[(SQLite 数据库<br/>剪贴板历史记录<br/>同步状态和元数据)]
        FileSystem[文件系统<br/>文件缓存目录<br/>配置文件存储]
        WebDAVServer[WebDAV 服务器<br/>sync-data.json<br/>files/]
    end

    UI --> State
    State --> Hooks
    Hooks --> SyncEngine

    SyncEngine --> LocalData
    SyncEngine --> CloudData
    SyncEngine --> FileSync
    SyncEngine --> AutoSync
    SyncEngine --> ConflictResolver
    SyncEngine --> ConfigSync

    LocalData --> SQLite
    FileSync --> FileSystem
    CloudData --> WebDAVClient
    FileSync --> WebDAVClient
    ConfigSync --> WebDAVClient

    WebDAVClient --> TauriPlugin1
    AutoSync --> TauriPlugin2
    TauriPlugin1 --> WebDAVServer

    TauriPlugin2 -.-> SyncEngine
```

## 主要同步数据流程

```mermaid
sequenceDiagram
    participant U as 用户剪贴板
    participant L as LocalDataManager
    participant SE as SyncEngine
    participant CD as CloudDataManager
    participant FS as FileSyncManager
    participant CR as ConflictResolver
    participant W as WebDAV服务器

    U->>L: 剪贴板数据
    L->>L: 存储到本地数据库
    L->>SE: 触发同步事件

    SE->>L: 获取本地数据
    SE->>SE: 数据筛选和过滤
    SE->>CD: 下载云端索引

    CD->>W: 请求 sync-data.json
    W-->>CD: 返回云端索引
    CD->>SE: 云端筛选数据

    SE->>SE: 冲突检测
    alt 有冲突
        SE->>CR: 解决冲突
        CR-->>SE: 解决结果
    end

    par 并行处理
        SE->>CD: 处理元数据上传
        CD->>W: 上传 sync-data.json
        W-->>CD: 上传成功
    and
        SE->>FS: 处理文件上传
        FS->>W: 上传文件到 files/ 目录
        W-->>FS: 上传结果
    end

    SE->>L: 应用云端变更
    L->>L: 更新本地数据库

    SE->>SE: 更新同步状态
```

## 自动同步流程

```mermaid
graph TB
    A[Tauri 后端定时器启动] --> B[延迟30秒执行]
    B --> C{检查同步状态}
    C -->|已启用| D[触发同步事件]
    C -->|已禁用| E[停止定时器]

    D --> F[前端事件监听]
    F --> G[获取WebDAV配置]
    G --> H{配置有效?}
    H -->|是| I[初始化SyncEngine]
    H -->|否| J[跳过本次同步]

    I --> K[设置同步模式配置]
    K --> L[执行双向同步流程]
    L --> M{同步成功?}
    M -->|是| N[触发UI更新事件]
    M -->|否| O[记录错误信息]

    N --> P[刷新剪贴板列表]
    P --> Q[等待下次同步]
    O --> Q

    Q --> C
    E --> R[自动同步停止]
```

## 文件处理流程

```mermaid
flowchart TD
    A[检测到文件类型数据] --> B[从原始数据提取文件路径]
    B --> C{路径格式识别}

    C -->|字符串路径| D[简单路径处理]
    C -->|数组格式| E[数组路径解析]
    C -->|对象格式| F[复合对象处理]
    C -->|嵌套结构| G[嵌套路径提取]

    D --> H[路径验证]
    E --> H
    F --> H
    G --> H

    H --> I{路径有效?}
    I -->|否| J[记录错误并跳过]
    I -->|是| K[检查文件大小]

    K --> L{文件大小合适?}
    L -->|否| M[跳过过大的文件]
    L -->|是| N[构建远程文件路径]

    N --> O[检查文件是否需要上传]
    O --> P{需要上传?}
    P -->|否| Q[复用已有文件]
    P -->|是| R[上传文件到WebDAV]

    R --> S{上传成功?}
    S -->|是| T[生成文件元数据]
    S -->|否| U[重试或失败]

    T --> V[更新SyncItem的value字段]
    V --> W[标记为文件类型_syncType]

    Q --> W
    U --> W
    M --> X[继续下一个文件]
    J --> X
    W --> X

    X --> Y{还有文件?}
    Y -->|是| B
    Y -->|否| Z[文件处理完成]
```

## 冲突解决策略

```mermaid
graph TD
    A[检测到潜在冲突] --> B[真实冲突检测]

    B --> C{校验和不同?}
    B --> D{收藏状态不同?}
    B --> E{备注内容不同?}

    C -->|是| F[内容冲突]
    D -->|是| G[状态冲突]
    E -->|是| H[注释冲突]

    C -->|否| I[非真实冲突]
    D -->|否| I
    E -->|否| I

    F --> J{解决策略}
    G --> J
    H --> J
    I --> K[跳过处理]

    J -->|本地优先| L[使用本地数据]
    J -->|远程优先| M[使用远程数据]
    J -->|智能合并| N[智能合并算法]

    N --> O[比较修改时间]
    N --> P[合并备注信息]
    N --> Q[选择较新状态]

    O --> R[生成合并结果]
    P --> R
    Q --> R

    L --> S[应用解决结果]
    M --> S
    R --> S

    S --> T[更新本地和云端数据]
    K --> T
```

## WebDAV 云端存储结构

```mermaid
graph LR
    subgraph "WebDAV 服务器"
        A[用户配置的同步路径/]
        B[sync-data.json<br/>统一数据索引文件<br/>CloudSyncData格式]
        C[files/<br/>原始文件存储目录<br/>itemId_timestamp_filename]
  
        A --> B
        A --> C
  
        subgraph "sync-data.json 结构"
            E["format: 'unified'<br/>timestamp, deviceId"]
            F["items: SyncItem数组<br/>完整同步数据"]
            G["deletedItems: 字符串数组<br/>已删除项目ID"]
            H["statistics & metadata<br/>统计信息和校验和"]

            E --> F
            E --> G
            E --> H
        end

        subgraph "文件命名规则"
            I[文件: itemId_timestamp_originalName]
            J[图片: itemId_timestamp_imageName]

            C --> I
            C --> J
        end
    end
```

## 数据转换流程

```mermaid
graph TB
    subgraph "数据库格式"
        A1[HistoryItem<br/>id, type, value]
        A2[favorite, note, createTime]
        A3[group, subtype, count]
        A4[width, height, search]
        A5[deleted, deviceId]
    end

    subgraph "同步格式"
        B1[SyncItem<br/>继承HistoryItem所有字段]
        B2[+ count: number<br/>同步必需字段]
        B3[+ lastModified: number<br/>最后修改时间]
        B4[+ deviceId: string<br/>设备标识]
    end

    subgraph "云端格式"
        C1[CloudSyncData<br/>format: 'unified']
        C2[items: SyncItem数组<br/>完整数据数组]
        C3[deletedItems: 字符串数组<br/>删除项目列表]
        C4[metadata & checksum<br/>元数据和校验]
    end

    subgraph "文件元数据转换"
        D1[files类型: value=文件元数据数组]
        D2[image类型: value=文件路径/元数据]
        D3[其他类型: value=原始内容]
    end

    A1 --> B1
    A2 --> B1
    A3 --> B1
    A4 --> B1
    A5 --> B1

    B1 --> B2
    B2 --> B3
    B3 --> B4

    B4 --> C1
    C1 --> C2
    C2 --> C3
    C3 --> C4

    B4 --> D1
    B4 --> D2
    B4 --> D3
```

## 模块依赖关系

```mermaid
graph TD
    subgraph "核心同步模块"
        SyncEngine[SyncEngine<br/>同步引擎核心<br/>协调所有同步操作]
        LocalData[LocalDataManager<br/>本地数据管理<br/>筛选和数据库操作]
        CloudData[CloudDataManager<br/>云端数据管理<br/>索引和数据同步]
        FileSync[FileSyncManager<br/>文件同步管理<br/>文件上传下载]
    end

    subgraph "辅助功能模块"
        ConflictResolver[SyncConflictResolver<br/>冲突解决器<br/>智能冲突处理]
        AutoSync[AutoSyncManager<br/>自动同步管理<br/>定时器和状态]
        ConfigSync[ConfigSync<br/>配置同步管理<br/>应用配置同步]
    end

    subgraph "网络传输模块"
        WebDAV[WebDAV Plugin<br/>WebDAV协议实现<br/>文件传输和认证]
        AutoSyncPlugin[AutoSync Plugin<br/>后台自动同步<br/>Rust定时器实现]
    end

    subgraph "存储层"
        Database[SQLite数据库<br/>本地数据存储]
        FileSystem[本地文件系统<br/>缓存和临时文件]
        RemoteStorage[WebDAV服务器<br/>云端数据存储]
    end

    SyncEngine --> LocalData
    SyncEngine --> CloudData
    SyncEngine --> FileSync
    SyncEngine --> ConflictResolver
    SyncEngine --> AutoSync
    SyncEngine --> ConfigSync

    LocalData --> Database
    FileSync --> FileSystem
    CloudData --> WebDAV
    FileSync --> WebDAV
    ConfigSync --> WebDAV

    WebDAV --> RemoteStorage
    AutoSync --> AutoSyncPlugin
    AutoSyncPlugin -.-> SyncEngine

    ConflictResolver -.-> SyncEngine
    AutoSync -.-> SyncEngine
```

## 配置同步流程

```mermaid
graph LR
    A[应用配置变更] --> B[ConfigSync]
    B --> C{同步配置启用?}
    C -->|否| D[仅本地存储]
    C -->|是| E[过滤环境配置]

    E --> F[序列化配置]
    F --> G[上传到WebDAV]
    G --> H[store-config.json]

    subgraph "配置过滤"
        I[移除环境相关配置]
        J[保留用户设置]
        K[保留同步模式配置]
        L[保留快捷键和UI设置]

        E --> I
        I --> J
        J --> K
        K --> L
    end

    subgraph "下载应用"
        M[下载远程配置]
        N[验证配置格式]
        O[应用到本地文件]
        P[重新加载Store]

        Q[配置同步触发] --> M
        M --> N
        N --> O
        O --> P
    end
```

## 后端自动同步架构

```mermaid
graph TB
    subgraph "Rust 后端插件"
        AS[eco-auto-sync 插件<br/>线程安全的全局状态管理]
        Timer[定时器管理<br/>可配置间隔]
        Events[事件发射器<br/>auto-sync-trigger]
    end

    subgraph "全局状态"
        Status[AUTO_SYNC_STATUS<br/>Arc<Mutex<Option<AutoSyncStatus>>>]
        Handle[TIMER_HANDLE<br/>Arc<Mutex<Option<JoinHandle>>>>]
    end

    subgraph "同步触发流程"
        ST[系统定时器触发]
        CE[配置有效性检查]
        EE[发射同步事件]
        FE[前端事件处理]
    end

    AS --> Status
    AS --> Handle
    AS --> Timer
    AS --> Events

    Timer --> ST
    ST --> CE
    CE --> EE
    EE --> FE

    FE -.->|事件流| SyncEngine
```

---

该架构图文档详细展示了 EcoPaste 云同步功能的完整架构设计，包括最新的双开关同步模式、自动同步、配置同步和统一数据格式等核心组件，为理解和维护系统提供了可视化的技术参考。