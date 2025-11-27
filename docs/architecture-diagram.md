# EcoPaste-Sync 现代架构图

## 系统架构概览

```mermaid
graph TB
    subgraph "前端层 Frontend Layer<br/>React 18 + TypeScript"
        UI[用户界面组件<br/>Main/Pages/CloudSync<br/>Dock/Float/List组件]
        State[状态管理<br/>Valtio globalStore<br/>clipboardStore]
        Router[路由系统<br/>React Router v6<br/>Hash路由模式]
        Hooks[React Hooks<br/>自定义Hooks<br/>事件系统]
    end

    subgraph "业务逻辑层 Business Logic Layer<br/>模块化架构"
        SyncEngine[同步引擎核心<br/>syncEngine.ts<br/>performBidirectionalSync]
        LocalData[本地数据管理器<br/>localDataManager.ts<br/>智能筛选过滤]
        CloudData[云端数据管理器<br/>cloudDataManager.ts<br/>统一格式管理]
        FileSync[文件同步管理器<br/>fileSyncManager.ts<br/>文件包处理]
        AutoSync[自动同步管理<br/>autoSync.ts<br/>线程安全定时器和状态]
        BookmarkManager[书签管理器<br/>bookmarkManager.ts<br/>分组和排序]
        BookmarkSync[书签同步管理<br/>bookmarkSync.ts<br/>基于时间戳的跨设备书签同步]
        ConflictResolver[冲突解决器<br/>syncConflictResolver.ts<br/>智能合并策略]
        CodeDetector[代码检测器<br/>codeDetector.ts<br/>代码内容语法识别和语言检测]
    end

    subgraph "数据库层 Database Layer<br/>SQLite + 增强功能"
        SQLite[(SQLite 数据库<br/>完整history表结构<br/>索引优化)]
        Database[数据库操作<br/>database/index.tsx<br/>事务安全操作]
        Cache[缓存管理<br/>LRU策略<br/>文件验证]
        Bookmarks[(书签分组表<br/>bookmark_groups<br/>bookmark_items)]
    end

    subgraph "Tauri 插件层 Plugin Layer<br/>Rust 高性能实现"
        WebDAVPlugin[eco-webdav插件<br/>reqwest HTTP客户端<br/>流式传输]
        AutoSyncPlugin[eco-auto-sync插件<br/>线程安全定时器<br/>事件发射]
        WindowPlugin[eco-window插件<br/>窗口管理<br/>透明效果]
        ClipboardPlugin[eco-clipboard插件<br/>剪贴板监控<br/>跨平台支持]
        OCRPlugin[eco-ocr插件<br/>图像文本识别<br/>Tesseract集成]
        PastePlugin[eco-paste插件<br/>智能粘贴<br/>格式转换]
    end

    subgraph "网络传输层 Network Layer<br/>WebDAV 协议"
        WebDAVClient[WebDAV 前端接口<br/>webdav.ts<br/>API封装和认证]
        ConnectionManager[连接管理<br/>连接池优化<br/>性能监控]
        FileSystemInterface[文件系统接口<br/>MKCOL支持<br/>目录创建]
    end

    subgraph "云存储层 Cloud Storage Layer<br/>WebDAV 服务器"
        WebDAVServer[WebDAV 云服务器<br/>用户配置路径]
        SyncData[sync-data.json<br/>统一数据格式<br/>CloudSyncData]
        FileStore[files/ 目录<br/>文件存储<br/>时间戳命名]
        ConfigStore[store-config.json<br/>配置同步<br/>环境过滤]
    end

    UI --> State
    State --> Router
    Router --> Hooks
    Hooks --> SyncEngine

    SyncEngine --> LocalData
    SyncEngine --> CloudData
    SyncEngine --> FileSync
    SyncEngine --> RealtimeSync
    SyncEngine --> BookmarkManager
    SyncEngine --> BookmarkSync
    SyncEngine --> ConflictResolver
    SyncEngine --> CodeDetector

    LocalData --> Database
    Database --> SQLite
    BookmarkManager --> Bookmarks
    FileSync --> Cache

    CloudData --> WebDAVClient
    FileSync --> WebDAVClient
    BookmarkSync --> WebDAVClient

    WebDAVClient --> ConnectionManager
    ConnectionManager --> FileSystemInterface
    FileSystemInterface --> WebDAVServer

    WebDAVServer --> SyncData
    WebDAVServer --> FileStore
    WebDAVServer --> ConfigStore

    WebDAVPlugin --> ConnectionManager
    AutoSyncPlugin --> RealtimeSync
    WindowPlugin -.-> UI
    ClipboardPlugin --> Database
    OCRPlugin --> FileSync
    PastePlugin --> Database

    RealtimeSync -.-> AutoSyncPlugin
    Cache -.-> FileSystemInterface
```

## 主要同步数据流程

```mermaid
sequenceDiagram
    participant U as 用户剪贴板
    participant CB as ClipboardPlugin
    participant DB as SQLite数据库
    participant SE as SyncEngine
    participant LD as LocalDataManager
    participant CD as CloudDataManager
    participant FS as FileSyncManager
    participant CR as ConflictResolver
    participant WD as WebDAV客户端
    participant WV as WebDAV服务器

    U->>CB: 剪贴板数据变更
    CB->>DB: 存储历史记录
    CB->>SE: 触发自动同步事件

    SE->>LD: 获取本地变更数据
    LD->>DB: 查询未同步项目
    DB-->>LD: 返回SyncItem列表
    LD->>LD: 应用同步模式过滤
    LD-->>SE: 返回筛选后数据

    SE->>CD: 下载云端数据索引
    CD->>WD: 请求 sync-data.json
    WD->>WV: HTTP GET请求
    WV-->>WD: 返回云端数据
    WD-->>CD: 返回CloudSyncData
    CD->>CD: 验证数据格式和校验和
    CD-->>SE: 返回云端SyncItem列表

    SE->>SE: 执行冲突检测算法
    alt 检测到真实冲突
        SE->>CR: 启动冲突解决流程
        CR->>CR: 应用解决策略(本地/远程/合并)
        CR-->>SE: 返回解决结果
    end

    par 并行数据上传
        SE->>CD: 准备云端数据上传
        CD->>CD: 构建CloudSyncData格式
        CD->>WD: 上传 sync-data.json
        WD->>WV: HTTP PUT请求
        WV-->>WD: 上传确认
        WD-->>CD: 上传成功
    and
        SE->>FS: 处理文件同步
        FS->>FS: 提取文件路径和元数据
        loop 每个文件
            FS->>WD: 上传文件到files/目录
            WD->>WV: HTTP PUT请求(流式传输)
            WV-->>WD: 上传确认
            WD-->>FS: 返回文件元数据
        end
    end

    SE->>LD: 应用云端变更到本地
    LD->>DB: 更新同步状态和元数据
    LD->>DB: 插入新的云端项目
    LD->>DB: 标记已删除项目
    DB-->>LD: 确认更新完成
    LD-->>SE: 本地应用完成

    SE->>SE: 更新同步统计和状态
    SE->>U: 通知同步完成(可选)
```

## 自动同步流程

```mermaid
graph TB
    A[AutoSyncPlugin启动] --> B[线程安全初始化]
    B --> C[设置全局状态Arc<Mutex>]
    C --> D[延迟30秒首次执行]
    D --> E{检查WebDAV配置}

    E -->|配置不存在| F[跳过本次同步]
    E -->|配置无效| F
    E -->|配置有效| G[获取同步间隔设置]

    F --> H[等待下次检查]
    G --> I{同步间隔类型}

    I -->|1小时| J[设置3600秒定时器]
    I -->|2小时| K[设置7200秒定时器]
    I -->|6小时| L[设置21600秒定时器]
    I -->|12小时| M[设置43200秒定时器]
    I -->|24小时| N[设置86400秒定时器]

    J --> O[启动定时器线程]
    K --> O
    L --> O
    M --> O
    N --> O

    O --> P[定时器触发]
    P --> Q[发射auto-sync-trigger事件]
    Q --> R[前端RealtimeSync监听]

    R --> S[防抖处理200ms]
    S --> T[验证WebDAV连接]
    T --> U{连接测试}

    U -->|失败| V[记录错误日志]
    U -->|成功| W[初始化SyncEngine]

    W --> X[读取同步模式配置]
    X --> Y[执行performBidirectionalSync]
    Y --> Z{同步结果}

    Z -->|成功| AA[更新UI状态]
    Z -->|部分成功| BB[显示部分成功提示]
    Z -->|失败| CC[显示错误提示]

    AA --> DD[刷新剪贴板列表]
    BB --> DD
    CC --> EE[重置连接状态]

    DD --> FF[等待下次定时器]
    EE --> FF
    FF --> H

    V --> GG[等待5分钟后重试]
    GG --> H

    H --> H
```

## 文件处理流程

```mermaid
flowchart TD
    A[SyncEngine检测文件类型] --> B[FileSyncManager.extractFilePaths]
    B --> C{文件路径格式分析}

    C -->|字符串路径| D[path处理]
    C -->|数组格式| E[files数组解析]
    C -->|复合对象| F[originalPath/path提取]
    C -->|嵌套结构| G[递归路径搜索]

    D --> H[validateFilePath]
    E --> H
    F --> H
    G --> H

    H --> I{路径有效性检查}
    I -->|无效路径| J[log错误跳过]
    I -->|有效路径| K[fs.access文件存在]

    K --> L{文件存在检查}
    L -->|文件不存在| M[跳过文件]
    L -->|文件存在| N[fs.stat获取文件信息]

    N --> O[生成FileMetadata对象]
    O --> P{文件大小检查}

    P -->|超过限制100MB| Q[log警告跳过]
    P -->|大小合适| R[计算MD5校验和]

    R --> S[generateRemoteFileName]
    S --> T["构建远程路径: {timestamp}_{originalName}"]

    T --> U{检查WebDAV已存在}
    U -->|已存在| V["复用现有文件"]
    U -->|不存在| W["uploadFile到WebDAV"]

    W --> X[reqwest流式上传]
    X --> Y{上传状态检查}

    Y -->|上传失败| Z[重试机制3次]
    Y -->|上传成功| AA[返回FileUploadResult]

    Z --> BB{重试次数}
    BB -->|未超限| W
    BB -->|超限| CC[标记上传失败]

    AA --> DD[更新SyncItem字段]
    V --> DD
    CC --> DD
    M --> DD
    J --> DD
    Q --> DD

    DD --> EE[value字段转为FileMetadata数组]
    EE --> FF[_syncType标记为files]
    FF --> GG[添加到files数组待同步]

    GG --> HH{处理下一个文件}
    HH -->|还有文件| B
    HH -->|处理完成| II[返回处理结果统计]

    II --> JJ[FileSyncManager.handleFilePackageUploads]
    JJ --> KK[更新CloudSyncData.files字段]
```

## 冲突解决策略

```mermaid
graph TD
    A[detectRealConflicts调用] --> B[遍历本地SyncItem数组]
    B --> C[查找云端对应项目]
    C --> D{云端项目存在?}

    D -->|不存在| E[新增云端项目]
    D -->|存在| F[开始真实冲突检测]

    F --> G{checksum比较}
    F --> H{favorite状态比较}
    F --> I{note内容比较}
    F --> J{lastModified比较}

    G -->|不同| K[内容真实冲突]
    H -->|不同| L[收藏状态冲突]
    I -->|不同| M[备注内容冲突]
    J -->|不同且校验和相同| N[元数据冲突]

    G -->|相同| O[内容一致]
    H -->|相同| O
    I -->|相同| O
    J -->|相同| O

    O --> P[跳过无冲突项目]
    K --> Q[syncConflictResolver解决]
    L --> Q
    M --> Q
    N --> Q

    Q --> R{用户选择的解决策略}
    R -->|local| S[本地优先策略]
    R -->|remote| T[远程优先策略]
    R -->|merge| U[智能合并策略]

    S --> V[使用本地版本数据]
    T --> W[使用远程版本数据]
    U --> X[执行智能合并算法]

    X --> Y[选择较新的lastModified]
    X --> Z[合并favorite状态]
    X --> AA[合并note内容]
    X --> BB[保留search字段]

    Y --> CC[生成合并结果]
    Z --> CC
    AA --> CC
    BB --> CC

    V --> DD[应用解决结果]
    W --> DD
    CC --> DD

    DD --> EE[更新本地数据库]
    DD --> FF[更新云端数据]
    P --> GG[处理下一个项目]

    EE --> HH[标记同步完成]
    FF --> HH
    GG --> I
    HH --> II[返回冲突解决报告]
```

## WebDAV 云端存储结构

```mermaid
graph LR
    subgraph "WebDAV 云存储"
        A[用户配置同步路径/]
        B[sync-data.json<br/>统一数据索引文件<br/>CloudSyncData v2格式]
        C[store-config.json<br/>应用配置文件<br/>环境过滤配置]
        D[files/<br/>文件存储目录<br/>时间戳命名规则]

        A --> B
        A --> C
        A --> D

        subgraph "sync-data.json 结构"
            E["format: 'unified'<br/>version: 2.0"]
            F["timestamp: Unix时间戳<br/>deviceId: 唯一设备标识"]
            G["items: SyncItem数组<br/>包含_syncType字段"]
            H["deletedItems: ID数组<br/>软删除标记"]
            I["statistics: 统计数据<br/>dataChecksum: SHA256"]
            J["performanceMetrics<br/>网络质量指标"]

            E --> F
            F --> G
            G --> H
            H --> I
            I --> J
        end

        subgraph "files/ 目录结构"
            K[images/<br/>图片文件存储]
            L[documents/<br/>文档文件存储]
            M[archives/<br/>压缩文件存储]
            N[others/<br/>其他类型文件]

            D --> K
            D --> L
            D --> M
            D --> N
        end

        subgraph "文件命名规则"
            O["{itemId}_{timestamp}_{originalName}<br/>唯一标识+时间戳+原名"]
            P["文件类型子目录<br/>按文件类型分类存储"]
            Q["最大100MB限制<br/>超出跳过并记录"]

            O --> P
            P --> Q
        end
    end
```

## 数据转换流程

```mermaid
graph TB
    subgraph "数据库格式"
        A1["HistoryItem<br/>id, type, value"]
        A2["favorite, note, createTime"]
        A3["group, subtype, count"]
        A4["width, height, search"]
        A5["deleted, deviceId"]
    end

    subgraph "同步格式"
        B1["SyncItem<br/>继承HistoryItem所有字段"]
        B2["+ count: number<br/>同步必需字段"]
        B3["+ lastModified: number<br/>最后修改时间"]
        B4["+ deviceId: string<br/>设备标识"]
    end

    subgraph "云端格式"
        C1["CloudSyncData<br/>format: 'unified'"]
        C2["items: SyncItem数组<br/>完整数据数组"]
        C3["deletedItems: 字符串数组<br/>删除项目列表"]
        C4["metadata & checksum<br/>元数据和校验"]
    end

    subgraph "文件元数据转换"
        D1["files类型: value=文件元数据数组"]
        D2["image类型: value=文件路径/元数据"]
        D3["其他类型: value=原始内容"]
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

## 书签同步流程

```mermaid
graph TB
    subgraph "用户操作"
        A[用户创建书签分组]
        B[用户编辑书签]
        C[用户删除书签]
        D[拖拽排序书签]
    end

    subgraph "BookmarkManager处理"
        E[本地数据更新]
        F[更新时间戳]
        G[持久化存储]
        H[触发同步事件]
    end

    subgraph "BookmarkSync同步逻辑"
        I[获取本地书签数据]
        J[下载云端书签数据]
        K{时间戳比较}

        K -->|本地时间戳更新| L[上传本地数据到云端]
        K -->|云端时间戳更新| M[下载数据到本地]
        K -->|时间戳相同| N{内容一致性检查}

        N -->|内容不一致| O[以云端数据为准]
        N -->|内容一致| P[无需同步]
    end

    subgraph "同步结果"
        Q[数据合并完成]
        R[更新本地状态]
        S[通知前端刷新]
    end

    A --> E
    B --> E
    C --> E
    D --> E

    E --> F
    F --> G
    G --> H

    H --> I
    I --> J
    J --> K

    L --> Q
    M --> Q
    O --> Q
    P --> Q

    Q --> R
    R --> S
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