# EcoPaste 开发最佳实践指南

## 1. 项目技术栈与架构分析

### 1.1 技术栈概览

**前端技术栈：**

- **框架**: React 18.3.1 + TypeScript
- **构建工具**: Vite 5.4.18
- **UI 库**: Ant Design 5.24.7 + Happy Work Theme
- **状态管理**: Valtio 2.1.4 (基于 Proxy 的响应式状态管理)
- **路由**: React Router DOM 6.27.0 (Hash 路由)
- **样式**: UnoCSS 0.63.6 + SCSS
- **国际化**: i18next 23.16.8 + react-i18next 15.4.1
- **工具库**: Lodash-es, ahooks, dayjs, nanoid 等

**后端技术栈：**

- **框架**: Tauri 2.5.0 (Rust 核心 + Web 前端)
- **数据库**: SQLite (通过@tauri-apps/plugin-sql)
- **插件系统**: 自定义 Tauri 插件架构

### 1.2 架构模式

**整体架构：**

```
┌─────────────────────────────────────────────────────────┐
│                   Tauri 应用架构                          │
├─────────────────────────────────────────────────────────┤
│  前端 (React + TypeScript)                              │
│  ├── 页面层 (Pages)                                     │
│  ├── 组件层 (Components)                                │
│  ├── 状态管理 (Stores)                                  │
│  ├── 工具函数 (Utils)                                   │
│  └── 插件接口 (Plugins)                                 │
├─────────────────────────────────────────────────────────┤
│  Tauri 核心层                                           │
│  ├── 窗口管理                                           │
│  ├── 系统集成                                           │
│  └── 插件系统                                           │
├─────────────────────────────────────────────────────────┤
│  Rust 后端 (自定义插件)                                 │
│  ├── 剪贴板插件                                         │
│  ├── OCR插件                                           │
│  ├── 窗口插件                                           │
│  └── 自启动插件                                         │
└─────────────────────────────────────────────────────────┘
```

## 2. 代码组织最佳实践

### 2.1 目录结构规范

```
src/
├── assets/          # 静态资源
│   ├── audio/       # 音频文件
│   ├── css/         # 全局样式
│   └── images/      # 图片资源
├── components/      # 通用组件
│   ├── ProList/     # 列表组件
│   ├── Audio/       # 音频组件
│   └── ...
├── constants/       # 常量定义
├── database/        # 数据库操作
├── hooks/           # 自定义Hooks
├── locales/         # 国际化文件
├── pages/           # 页面组件
│   ├── Main/        # 主页面
│   └── Preference/  # 设置页面
├── plugins/         # 前端插件接口
├── router/          # 路由配置
├── stores/          # 状态管理
├── types/           # TypeScript类型定义
└── utils/           # 工具函数

src-tauri/
├── src/
│   ├── plugins/     # Rust插件
│   │   ├── clipboard/
│   │   ├── ocr/
│   │   └── ...
│   └── main.rs      # 主入口
├── capabilities/    # 权限配置
└── tauri.conf.json  # Tauri配置
```

### 2.2 命名规范

**文件命名：**

- 组件文件：PascalCase (如 `ProList/index.tsx`)
- 工具文件：camelCase (如 `shared.ts`)
- 类型文件：camelCase (如 `global.d.ts`)
- 常量文件：camelCase (如 `index.ts`)

**变量命名：**

- 变量和函数：camelCase
- 常量：UPPER_SNAKE_CASE
- 组件：PascalCase
- 接口和类型：PascalCase (以 `I` 或 `T` 开头可选)

### 2.3 导入导出规范

```typescript
// 统一使用绝对路径导入
import { globalStore } from "@/stores/global";
import { ProList } from "@/components/ProList";
import type { HistoryTablePayload } from "@/types/database";

// 默认导出用于主要功能
export default Main;

// 命名导出用于工具函数
export { wait, formatDate };
```

## 3. 组件设计模式

### 3.1 组件层次结构

```
页面组件 (Pages)
└── 容器组件 (Container)
    └── 业务组件 (Business Components)
        └── 通用组件 (Common Components)
            └── 基础组件 (Base Components)
```

### 3.2 组件设计原则

**单一职责原则：**

```typescript
// 好的示例 - 单一职责
const Audio = () => {
  // 只负责音频播放
};

// 避免 - 多重职责
const AudioAndVideo = () => {
  // 既处理音频又处理视频
};
```

**组合优于继承：**

```typescript
// 好的示例 - 组合模式
const ProList = ({ header, children, ...rest }) => {
  return (
    <Flex vertical gap="small">
      {header && <Title>{header}</Title>}
      <List {...rest}>{children}</List>
    </Flex>
  );
};
```

### 3.3 组件通信模式

**Props 传递：**

```typescript
interface ItemProps {
  data: HistoryTablePayload;
  index: number;
  deleteModal: any;
  openNoteModel: () => void;
}
```

**Context API：**

```typescript
export const MainContext = createContext<MainContextValue>({
  state: INITIAL_STATE,
});

// 使用
const { state, getList } = useContext(MainContext);
```

**事件总线：**

```typescript
const $eventBus = useEventEmitter<string>();

// 发送事件
state.$eventBus?.emit(LISTEN_KEY.CLIPBOARD_ITEM_PREVIEW);

// 监听事件
useEffect(() => {
  const unsubscribe = $eventBus.subscribe((key) => {
    // 处理事件
  });
  return unsubscribe;
}, []);
```

## 4. 状态管理模式

### 4.1 Valtio 状态管理

**状态结构：**

```typescript
// 全局状态
export const globalStore = proxy<GlobalStore>({
  app: {
    /* 应用设置 */
  },
  appearance: {
    /* 外观设置 */
  },
  update: {
    /* 更新设置 */
  },
  shortcut: {
    /* 快捷键设置 */
  },
  env: {
    /* 环境变量 */
  },
});

// 剪贴板状态
export const clipboardStore = proxy<ClipboardStore>({
  window: {
    /* 窗口设置 */
  },
  audio: {
    /* 音效设置 */
  },
  search: {
    /* 搜索设置 */
  },
  content: {
    /* 内容设置 */
  },
  history: {
    /* 历史记录设置 */
  },
});
```

**状态订阅：**

```typescript
// 使用快照
const { shortcut } = useSnapshot(globalStore);

// 监听特定属性变化
useImmediateKey(globalStore.appearance, "language", i18n.changeLanguage);

// 监听整个对象变化
useSubscribe(globalStore, () => handleStoreChanged());
```

### 4.2 本地存储模式

```typescript
// 保存状态
export const saveStore = async (backup = false) => {
  const store = { globalStore, clipboardStore };
  const path = await getSaveStorePath(backup);
  return writeTextFile(path, JSON.stringify(store, null, 2));
};

// 恢复状态
export const restoreStore = async (backup = false) => {
  const path = await getSaveStorePath(backup);
  const existed = await exists(path);

  if (existed) {
    const content = await readTextFile(path);
    const store: Store = JSON.parse(content);
    deepAssign(globalStore, store.globalStore);
    deepAssign(clipboardStore, store.clipboardStore);
  }
};
```

## 5. 插件开发模式

### 5.1 插件架构

**前端插件接口：**

```typescript
// 定义命令常量
const COMMAND = {
  START_LISTEN: "plugin:eco-clipboard|start_listen",
  STOP_LISTEN: "plugin:eco-clipboard|stop_listen",
  // ...
};

// 调用后端命令
export const startListen = () => {
  return invoke(COMMAND.START_LISTEN);
};

// 监听后端事件
export const onClipboardUpdate = (fn: (payload: ClipboardPayload) => void) => {
  return listen(COMMAND.CLIPBOARD_UPDATE, fn);
};
```

**Rust 插件实现：**

```rust
// lib.rs
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-clipboard")
        .setup(move |app, _api| {
            app.manage(ClipboardManager::new());
            Ok(())
        })
        .invoke_handler(generate_handler![
            commands::start_listen,
            commands::stop_listen,
            // ...
        ])
        .build()
}
```

### 5.2 插件通信模式

**命令调用：**

```typescript
// 前端调用
const result = await invoke("plugin:eco-clipboard|read_text");
```

**事件监听：**

```typescript
// 前端监听
const unlisten = await listen("plugin:eco-clipboard://update", (event) => {
  console.log(event.payload);
});
```

## 6. 新功能开发流程指南

### 6.1 功能规划阶段

1. **需求分析**

   - 明确功能目标和用户价值
   - 确定技术可行性和实现复杂度
   - 评估与现有功能的集成点

2. **技术设计**

   - 确定前端组件结构
   - 设计状态管理方案
   - 规划插件接口（如需要）
   - 设计数据库表结构（如需要）

3. **接口设计**

   - 定义类型接口
   - 设计组件 Props
   - 规划事件流

### 6.2 设计阶段

1. **UI/UX 设计**

   - 遵循现有设计语言
   - 保持交互一致性
   - 考虑响应式设计

2. **架构设计**

   - 组件层次结构
   - 状态流向
   - 数据流设计

3. **接口设计**

   - TypeScript 类型定义
   - 插件命令定义
   - 事件监听机制

### 6.3 实现阶段

1. **环境准备**

   ```bash
   # 安装依赖
   pnpm install

   # 启动开发环境
   pnpm dev
   ```

2. **代码实现**

   - 按照目录结构创建文件
   - 遵循命名规范
   - 实现类型安全

3. **渐进开发**

   - 先实现核心功能
   - 再添加辅助功能
   - 最后完善细节

### 6.4 测试阶段

1. **单元测试**

   - 测试工具函数
   - 测试组件逻辑
   - 测试状态管理

2. **集成测试**

   - 测试组件交互
   - 测试插件通信
   - 测试数据流

3. **端到端测试**

   - 测试完整用户流程
   - 测试跨平台兼容性
   - 测试性能表现

### 6.5 集成阶段

1. **代码审查**

   - 检查代码规范
   - 验证类型安全
   - 确认最佳实践

2. **文档更新**

   - 更新 README
   - 添加代码注释
   - 更新类型文档

3. **发布准备**

   - 版本号更新
   - 变更日志
   - 发布流程

## 7. 前端组件开发指南

### 7.1 组件开发规范

**组件结构：**

```typescript
// 组件文件结构
ComponentName/
├── index.tsx          # 主组件
├── index.module.scss  # 样式文件
├── components/        # 子组件
└── types.ts          # 类型定义
```

**组件模板：**

```typescript
import type { FC } from "react";
import styles from "./index.module.scss";

interface ComponentProps {
  // 定义Props类型
}

const Component: FC<ComponentProps> = (props) => {
  // 组件逻辑

  return <div className={styles.root}>{/* 组件内容 */}</div>;
};

export default Component;
```

### 7.2 样式管理

**CSS 模块化：**

```scss
// index.module.scss
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &.active {
    background-color: var(--primary-color);
  }
}
```

**UnoCSS 原子类：**

```typescript
// 使用原子类
<div className="flex flex-col gap-2 p-4">{/* 内容 */}</div>
```

### 7.3 Hooks 使用

**自定义 Hook 模板：**

```typescript
import { useEffect, useState } from "react";

export const useCustomHook = (param: string) => {
  const [state, setState] = useState(null);

  useEffect(() => {
    // 副作用逻辑
  }, [param]);

  return { state, setState };
};
```

## 8. 后端插件开发指南

### 8.1 插件结构

```
src-tauri/src/plugins/plugin-name/
├── build.rs          # 构建脚本
├── Cargo.toml        # 依赖配置
├── permissions/      # 权限配置
│   └── default.toml
└── src/
    ├── lib.rs        # 插件入口
    ├── commands.rs   # 命令实现
    └── entities.rs   # 数据结构
```

### 8.2 插件开发模板

**lib.rs：**

```rust
use commands::PluginManager;
use tauri::{generate_handler, plugin::{Builder, TauriPlugin}, Manager, Runtime};

mod commands;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("eco-plugin-name")
        .setup(move |app, _api| {
            app.manage(PluginManager::new());
            Ok(())
        })
        .invoke_handler(generate_handler![
            commands::command_name,
            // ...
        ])
        .build()
}
```

**commands.rs：**

```rust
use serde::{Deserialize, Serialize};
use tauri::{State, Window};

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandParams {
    // 参数定义
}

#[tauri::command]
pub async fn command_name(
    params: CommandParams,
    state: State<'_, PluginManager>,
) -> Result<(), String> {
    // 命令实现
    Ok(())
}
```

### 8.3 错误处理

```rust
// 定义错误类型
#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

// 返回结果类型
type PluginResult<T> = Result<T, PluginError>;
```

## 9. 数据库操作指南

### 9.1 数据库初始化

```typescript
export const initDatabase = async () => {
  if (db) return;

  const path = await getSaveDatabasePath();
  db = await Database.load(`sqlite:${path}`);

  // 创建表
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      type TEXT,
      [group] TEXT,
      value TEXT,
      search TEXT,
      count INTEGER,
      width INTEGER,
      height INTEGER,
      favorite INTEGER DEFAULT 0,
      createTime TEXT,
      note TEXT,
      subtype TEXT
    );
  `);
};
```

### 9.2 CRUD 操作

**查询：**

```typescript
export const selectSQL = async <List>(
  tableName: TableName,
  payload: TablePayload = {}
) => {
  const { keys, values } = handlePayload(payload);
  const clause = map(keys, (key, index) => {
    if (key === "search") {
      const value = `%${payload.search}%`;
      values[index] = value;
      values.splice(index + 1, 0, value);
      return "(search LIKE ? OR note LIKE ?)";
    }
    return `${key} = ?`;
  }).join(" AND ");

  const whereClause = clause ? `WHERE ${clause}` : "";
  const list = await executeSQL(
    `SELECT * FROM ${tableName} ${whereClause} ORDER BY createTime DESC;`,
    values
  );

  return (list ?? []) as List;
};
```

**插入：**

```typescript
export const insertSQL = (tableName: TableName, payload: TablePayload) => {
  const { keys, values } = handlePayload(payload);
  const refs = map(values, () => "?");

  return executeSQL(
    `INSERT INTO ${tableName} (${keys}) VALUES (${refs});`,
    values
  );
};
```

**更新：**

```typescript
export const updateSQL = (tableName: TableName, payload: TablePayload) => {
  const { id, ...rest } = payload;
  const { keys, values } = handlePayload(rest);

  if (keys.length === 0) return;

  const setClause = map(keys, (item) => `${item} = ?`);

  return executeSQL(
    `UPDATE ${tableName} SET ${setClause} WHERE id = ?;`,
    values.concat(id!)
  );
};
```

**删除：**

```typescript
export const deleteSQL = async (tableName: TableName, item: TablePayload) => {
  const { id, type, value } = item;

  await executeSQL(`DELETE FROM ${tableName} WHERE id = ?;`, [id]);

  // 删除关联文件（如图片）
  if (type !== "image" || !value) return;

  const path = resolveImagePath(value);
  const existed = await exists(path);

  if (!existed) return;

  return remove(path);
};
```

### 9.3 数据库迁移

```typescript
// 添加字段
export const addField = async (
  tableName: TableName,
  field: string,
  type: string
) => {
  const fields = await getFields(tableName);

  if (some(fields, { name: field })) return;

  return executeSQL(`ALTER TABLE ${tableName} ADD COLUMN ${field} ${type};`);
};

// 重命名字段
export const renameField = async (
  tableName: TableName,
  field: string,
  rename: string
) => {
  const fields = await getFields(tableName);

  if (some(fields, { name: rename })) return;

  return executeSQL(
    `ALTER TABLE ${tableName} RENAME COLUMN ${field} TO ${rename};`
  );
};
```

## 10. 国际化实现指南

### 10.1 国际化配置

```typescript
// i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./zh-CN.json";
import enUS from "./en-US.json";

i18n.use(initReactI18next).init({
  resources: {
    [LANGUAGE.ZH_CN]: {
      translation: zhCN,
    },
    [LANGUAGE.EN_US]: {
      translation: enUS,
    },
  },
  lng: LANGUAGE.ZH_CN,
  fallbackLng: LANGUAGE.ZH_CN,
  debug: false,
  interpolation: {
    escapeValue: false,
  },
});
```

### 10.2 语言文件结构

```json
// zh-CN.json
{
  "preference": {
    "menu": {
      "title": {
        "clipboard": "剪贴板",
        "history": "历史记录",
        "general": "通用"
      }
    },
    "clipboard": {
      "window": {
        "style": "窗口样式",
        "position": "窗口位置"
      }
    }
  },
  "button": {
    "save": "保存",
    "cancel": "取消",
    "confirm": "确认"
  }
}
```

### 10.3 使用方法

```typescript
// 在组件中使用
const { t } = useTranslation();

return <div>{t("preference.menu.title.clipboard")}</div>;

// 动态切换语言
useImmediateKey(globalStore.appearance, "language", i18n.changeLanguage);

// 获取Antd语言包
export const getAntdLocale = (language: Language = LANGUAGE.ZH_CN) => {
  const antdLanguage: Record<Language, AntdLocale> = {
    [LANGUAGE.ZH_CN]: antdZhCN,
    [LANGUAGE.EN_US]: antdEnUS,
  };
  return antdLanguage[language];
};
```

## 11. 类型定义指南

### 11.1 类型组织

```
src/types/
├── global.d.ts      # 全局类型扩展
├── store.d.ts       # 状态管理类型
├── database.d.ts    # 数据库类型
├── plugin.d.ts      # 插件类型
└── shared.d.ts      # 共享类型
```

### 11.2 类型定义规范

**接口定义：**

```typescript
// 数据库类型
export interface HistoryTablePayload extends ClipboardPayload {
  id: string;
  favorite: boolean;
  createTime: string;
  note?: string;
}

// 状态管理类型
export interface GlobalStore {
  app: {
    autoStart: boolean;
    silentStart: boolean;
    showMenubarIcon: boolean;
    showTaskbarIcon: boolean;
  };
  appearance: {
    theme: Theme;
    isDark: boolean;
    language?: Language;
  };
  // ...
}

// 插件类型
export interface ClipboardPayload {
  type: "text" | "image" | "files" | "html" | "rtf";
  value: string;
  search: string;
  count: number;
  group: string;
  subtype?: string;
}
```

**联合类型和枚举：**

```typescript
// 联合类型
export type Theme = "auto" | "light" | "dark";
export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE];
export type OperationButton =
  | "copy"
  | "pastePlain"
  | "note"
  | "star"
  | "delete";

// 枚举常量
export const LANGUAGE = {
  ZH_CN: "zh-CN",
  ZH_TW: "zh-TW",
  EN_US: "en-US",
  JA_JP: "ja-JP",
} as const;
```

**泛型类型：**

```typescript
// 工具类型
export type TablePayload = Partial<HistoryTablePayload>;
export type Store = {
  globalStore: GlobalStore;
  clipboardStore: ClipboardStore;
};

// 函数类型
export type EventHandler<T = any> = (payload: T) => void;
export type AsyncFunction<T = any> = () => Promise<T>;
```

### 11.3 类型扩展

```typescript
// 全局类型扩展
declare module "react" {
  interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    "data-tauri-drag-region"?: boolean;
  }
}

declare module "valtio" {
  function useSnapshot<T extends object>(p: T): T;
}
```

## 12. 代码质量保证

### 12.1 代码规范

**Biome 配置：**

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noConsoleLog": "error",
        "noExplicitAny": "off"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "style": {
        "noUnusedTemplateLiteral": {
          "level": "error",
          "fix": "safe"
        },
        "useTemplate": {
          "level": "error",
          "fix": "safe"
        }
      }
    }
  }
}
```

**TypeScript 配置：**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

### 12.2 类型安全实践

**严格类型检查：**

```typescript
// 使用类型断言
const data = JSON.parse(json) as DataType;

// 使用类型守卫
const isString = (value: unknown): value is string => {
  return typeof value === "string";
};

// 使用泛型约束
interface Repository<T> {
  findById(id: string): Promise<T>;
  save(data: T): Promise<void>;
}
```

**错误处理：**

```typescript
// 统一错误处理
const handleError = (error: unknown) => {
  const message = isString(error) ? error : JSON.stringify(error);
  error(message);
};

// 类型安全的错误处理
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  if (error instanceof NetworkError) {
    // 处理网络错误
  } else if (error instanceof ValidationError) {
    // 处理验证错误
  } else {
    // 处理未知错误
    handleError(error);
  }
}
```

### 12.3 性能优化建议

**React 优化：**

```typescript
// 使用React.memo
const Component = React.memo(({ data }) => {
  return <div>{data.value}</div>;
});

// 使用useMemo
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(data);
}, [data]);

// 使用useCallback
const handleClick = useCallback(
  (id: string) => {
    onItemClick(id);
  },
  [onItemClick]
);
```

**虚拟化列表：**

```typescript
// 使用@tanstack/react-virtual
const rowVirtualizer = useVirtualizer({
  count: state.list.length,
  gap: 12,
  getScrollElement: () => outerRef.current,
  estimateSize: () => 120,
  getItemKey: (index) => state.list[index].id,
});
```

**状态管理优化：**

```typescript
// 避免不必要的订阅
const { specificValue } = useSnapshot(store);

// 使用浅比较
useSubscribe(store, () => {
  if (prevRef.current !== store.value) {
    // 处理变化
  }
});
```

### 12.4 错误处理最佳实践

**边界错误处理：**

```typescript
// 错误边界组件
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong.</h1>;
    }

    return this.props.children;
  }
}
```

**异步错误处理：**

```typescript
// Promise错误处理
const fetchData = async () => {
  try {
    const response = await api.getData();
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch data: ${error.message}`);
  }
};

// 全局错误监听
useEventListener("unhandledrejection", ({ reason }) => {
  const message = isString(reason) ? reason : JSON.stringify(reason);
  error(message);
});
```

## 13. 开发工具和环境

### 13.1 开发命令

```bash
# 开发模式
pnpm dev

# 构建
pnpm build

# 代码检查和格式化
pnpm lint

# Tauri 开发
pnpm tauri dev

# Tauri 构建
pnpm tauri build
```

### 13.2 调试技巧

**前端调试：**

- 使用浏览器开发者工具
- React DevTools
- Redux DevTools (状态管理)

**后端调试：**

- Rust 日志输出
- Tauri 开发者工具
- 终端错误信息

**插件调试：**

- 前后端通信日志
- 命令执行追踪
- 事件监听状态

### 13.3 构建和部署

**构建流程：**

1. 前端资源构建
2. Tauri 应用打包
3. 多平台构建配置
4. 签名和公证

**部署策略：**

- GitHub Actions 自动构建
- 多平台二进制发布
- 自动更新机制
- 版本管理

## 14. 总结

EcoPaste 项目采用了现代化的技术栈和架构设计，通过 Tauri 实现了跨平台的桌面应用。项目遵循以下最佳实践：

1. **清晰的代码组织结构**：按功能模块划分目录，保持代码的可维护性
2. **类型安全的开发**：全面使用 TypeScript，确保代码质量
3. **组件化设计**：遵循 React 最佳实践，实现可复用的组件
4. **统一的状态管理**：使用 Valtio 进行响应式状态管理
5. **插件化架构**：通过 Tauri 插件系统扩展功能
6. **国际化支持**：完整的多语言支持方案
7. **代码质量保证**：通过 Biome 和 TypeScript 严格模式确保代码质量

在开发新功能时，应该遵循这些既定的模式和规范，确保代码的一致性和可维护性。这份指南将作为 EcoPaste 项目开发的重要参考，帮助开发者快速上手并保持代码质量。
