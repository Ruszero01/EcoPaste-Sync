# EcoPaste 云同步架构图

## 系统架构概览

```mermaid
graph TB
    subgraph "前端层 Frontend Layer"
        UI[用户界面组件]
        State[状态管理]
        Hooks[React Hooks]
    end

    subgraph "业务逻辑层 Business Logic Layer"
        SyncEngine[同步引擎核心]
        LocalData[本地数据管理器]
        CloudData[云端数据管理器]
        FileSync[文件同步管理器]
        AutoSync[自动同步管理器]
        ConflictResolver[冲突解决器]
    end

    subgraph "网络传输层 Network Layer"
        WebDAVClient[WebDAV 客户端]
        TauriPlugin[Tauri 插件]
    end

    subgraph "数据存储层 Data Storage Layer"
        SQLite[(SQLite 数据库)]
        FileSystem[文件系统]
        WebDAVServer[WebDAV 服务器]
    end

    UI --> State
    State --> Hooks
    Hooks --> SyncEngine

    SyncEngine --> LocalData
    SyncEngine --> CloudData
    SyncEngine --> FileSync
    SyncEngine --> AutoSync
    SyncEngine --> ConflictResolver

    LocalData --> SQLite
    FileSync --> FileSystem
    CloudData --> WebDAVClient
    FileSync --> WebDAVClient

    WebDAVClient --> TauriPlugin
    TauriPlugin --> WebDAVServer
```

## 同步数据流程

```mermaid
sequenceDiagram
    participant U as 用户剪贴板
    participant L as LocalDataManager
    participant SE as SyncEngine
    participant CD as CloudDataManager
    participant FS as FileSyncManager
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
        SE->>ConflictResolver: 解决冲突
        ConflictResolver-->>SE: 解决结果
    end

    SE->>FS: 处理文件上传
    FS->>W: 上传文件到 files/ 目录
    W-->>FS: 上传结果

    SE->>CD: 上传更新的索引
    CD->>W: 上传 sync-data.json
    W-->>CD: 上传成功

    SE->>L: 应用云端变更
    L->>L: 更新本地数据库
```

## 文件处理流程

```mermaid
flowchart TD
    A[检测到文件类型数据] --> B[提取文件路径]
    B --> C{路径是否有效?}
    C -->|是| D[检查文件大小]
    C -->|否| E[记录错误并跳过]

    D --> F{文件大小合适?}
    F -->|是| G[构建远程文件路径]
    F -->|否| H[跳过过大的文件]

    G --> I[上传文件到WebDAV]
    I --> J{上传成功?}
    J -->|是| K[生成文件元数据]
    J -->|否| L[重试或失败]

    K --> M[更新数据项value字段]
    M --> N[标记为已处理]

    N --> O[继续下一个文件]
    E --> O
    H --> O
    L --> O

    O --> P{还有文件?}
    P -->|是| B
    P -->|否| Q[文件处理完成]
```

## 冲突解决策略

```mermaid
graph TD
    A[检测到冲突] --> B{冲突类型}

    B -->|校验和不同| C[内容冲突]
    B -->|收藏状态不同| D[状态冲突]
    B -->|备注不同| E[注释冲突]

    C --> F{解决策略}
    D --> F
    E --> F

    F -->|本地优先| G[使用本地数据]
    F -->|远程优先| H[使用远程数据]
    F -->|智能合并| I[智能合并算法]

    I --> J[比较修改时间]
    I --> K[合并备注信息]
    I --> L[选择较新状态]

    J --> M[生成合并结果]
    K --> M
    L --> M

    G --> N[应用解决结果]
    H --> N
    M --> N

    N --> O[更新本地和云端]
```

## WebDAV 云端存储结构

```mermaid
graph LR
    subgraph "WebDAV 服务器"
        A[用户配置的同步路径/]
        B[sync-data.json<br/>数据索引文件]
        C[files/<br/>原始文件目录]

        A --> B
        A --> C

        subgraph "文件目录结构"
            D[itemId_timestamp_filename1.ext]
            E[itemId_timestamp_filename2.ext]
            F[itemId_timestamp_image.png]

            C --> D
            C --> E
            C --> F
        end
    end

    subgraph "sync-data.json 内容"
        G[CloudItemFingerprint[]<br/>轻量级数据指纹]
        H[id, type, checksum<br/>size, timestamp, favorite]
        I[value字段<br/>文件/图片元数据]

        G --> H
        G --> I
    end
```

## 数据转换流程

```mermaid
graph TB
    subgraph "数据库格式 HistoryTablePayload"
        A1[id, type, value<br/>favorite, note, createTime]
        A2[group, subtype, count<br/>width, height, search]
    end

    subgraph "同步格式 SyncItem"
        B1[继承HistoryTablePayload]
        B2[+ checksum, timestamp<br/>+ deviceId, lastModified]
    end

    subgraph "云端指纹 CloudItemFingerprint"
        C1[id, type, checksum<br/>favorite, size, timestamp]
        C2[value? 文件/图片元数据]
    end

    A1 --> B1
    A2 --> B1
    B1 --> B2
    B2 --> C1
    B2 --> C2

    subgraph "元数据转换"
        D[files类型: value=JSON文件元数据数组]
        E[image类型: value=文件路径]
        F[其他类型: value=原始内容]
    end

    C2 --> D
    C2 --> E
    C2 --> F
```

## 模块依赖关系

```mermaid
graph TD
    subgraph "核心模块"
        SyncEngine[SyncEngine<br/>同步引擎核心]
        LocalData[LocalDataManager<br/>本地数据管理]
        CloudData[CloudDataManager<br/>云端数据管理]
        FileSync[FileSyncManager<br/>文件同步管理]
    end

    subgraph "辅助模块"
        ConflictResolver[SyncConflictResolver<br/>冲突解决器]
        AutoSync[AutoSyncManager<br/>自动同步管理]
        WebDAV[WebDAV Plugin<br/>网络传输]
    end

    subgraph "存储层"
        Database[SQLite数据库]
        FileSystem[文件系统]
        RemoteStorage[WebDAV服务器]
    end

    SyncEngine --> LocalData
    SyncEngine --> CloudData
    SyncEngine --> FileSync
    SyncEngine --> ConflictResolver
    SyncEngine --> AutoSync

    LocalData --> Database
    FileSync --> FileSystem
    CloudData --> WebDAV
    FileSync --> WebDAV

    WebDAV --> RemoteStorage

    ConflictResolver -.-> SyncEngine
    AutoSync -.-> SyncEngine
```