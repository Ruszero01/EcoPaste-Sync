# AGENTS.md

EcoPaste-Sync: Tauri v2 + Rust backend, React 18 + TypeScript + Vite frontend. Cloud sync via WebDAV.

## Essential Commands

```bash
# Install - must use pnpm
pnpm install

# Development
pnpm dev                  # Build icons + Vite dev server
pnpm tauri dev            # Full dev (Vite + Tauri)
pnpm dev:vite             # Frontend only (http://localhost:3000)

# Build
pnpm build                # Icon + Vite build
pnpm tauri build          # Production build
pnpm tauri build --debug  # Debug build

# Code quality
pnpm lint                 # Biome auto-fix for src
biome check src           # Biome check only (no auto-fix)
biome check --write src   # Biome auto-fix (same as pnpm lint)

# Release
pnpm run release          # Full release
pnpm run release-rc       # Release candidate
pnpm run release-beta     # Beta release
```

**No test suite configured** - CI only runs Biome linting on staged files.

## Code Style Guidelines

### Frontend (TypeScript/React)

- **Linting**: Biome with strict rules enforced in `biome.json`. No `console.log`, no unused variables/imports, no `any` type.
- **State Management**: Valtio - use `proxy()` for stores, `useSnapshot()` in components. Never mutate state directly.
- **Components**: Functional components with TypeScript. Name props interfaces `ComponentNameProps`, use `FC<ComponentNameProps>` type.
- **Imports**: Use path aliases consistently - `@/utils`, `@/components`, `@/hooks`, `@/types`, `@/locales`, `@/assets`.
- **Auto-imports**: React hooks, ahooks, router hooks, i18n hooks are auto-configured via unplugin-auto-import. DON'T import manually.
- **Styling**: UnoCSS utility classes + Ant Design components. Global styles in `src/assets/css/global.scss`.
- **i18n**: Use `useTranslation()` hook, translation keys in `src/locales/{lang}.json`. Avoid hardcoded strings.
- **TypeScript**: Strict mode enabled. Use types from `@/types/` or define proper interfaces. Never use `any`.
- **Tauri Commands**: Invoke with `invoke<ReturnType>("plugin:eco-{name}|{command}", payload)`. Handle errors appropriately.

### Backend (Rust)

- **Error Handling**: Commands return `Result<T, String>` for simplicity. Use `?` operator, log errors with `log::error!()`.
- **Async Patterns**: Commands can be async. Use `Arc<Mutex<T>>` for shared mutable state, `State<T>` for dependency injection.
- **Plugin Structure**: Each plugin follows pattern: `commands.rs` (handlers), `lib.rs` (exports), `build.rs` (build script), `permissions/default.toml`.
- **Logging**: Use `log::info!()`, `log::error!()`, `log::warn!()`, `log::debug!()` appropriately. Debug logs for tracing.

### TypeScript Conventions

```typescript
// Props interface naming
interface ButtonProps {
  label: string;
  onClick: () => void;
}

// Functional component
const Button: FC<ButtonProps> = ({ label, onClick }) => {
  return <button onClick={onClick}>{label}</button>;
};

// Tauri invoke
const result = await invoke<string>("plugin:eco-sync|get_config", {});
```

### Rust Conventions

```rust
#[tauri::command]
async fn get_config(state: State<Arc<Mutex<SyncState>>>) -> Result<SyncConfig, String> {
    let config = state.lock().map_err(|e| e.to_string())?.config.clone();
    log::debug!("Config retrieved: {:?}", config);
    Ok(config)
}
```

## Critical Conventions

### File Paths (Windows)
Always use complete absolute paths with drive letters:
```typescript
const filePath = "G:/Develop/github/EcoPaste-Sync/src/App.tsx";  // Correct
const filePath = "./src/App.tsx";  // Wrong - may cause path resolution issues
```

### Git Hooks
- **Pre-commit**: Runs Biome on staged files via lint-staged (`.lintstagedrc` config in package.json)
- **Commit-msg**: Enforces conventional commits (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `chore`)

### Sync System
- Local-first design with WebDAV cloud storage
- Dual-switch mode: File mode (images/files), Favorite mode (favorites only)
- Text/HTML/RTF always synced regardless of mode

## Project Structure

```
EcoPaste-Sync/
├── src/                    # Frontend React + TypeScript
│   ├── assets/            # Static assets, global styles
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── locales/           # i18n translation files
│   ├── pages/             # Page components
│   ├── stores/            # Valtio proxy stores
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── main.tsx           # App entry point
├── src-tauri/             # Tauri backend (Rust)
│   ├── src/
│   │   ├── commands.rs   # Command handlers
│   │   └── lib.rs        # Plugin exports
│   ├── Cargo.toml
│   └── permissions/
├── scripts/               # Build scripts (tsx)
├── biome.json            # Biome lint config
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Architecture Summary

- **Frontend**: React 18 + Vite + Valtio (state) + UnoCSS + Ant Design + i18next
- **Backend**: Tauri v2 plugins (sync, database, clipboard, hotkey, ocr, etc.)
- **Storage**: SQLite local database + WebDAV cloud (sync-data.json + files/)
- **Data Flow**: React components → Tauri invoke → Rust handlers → SQLite/WebDAV

## Key Dependencies

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, Valtio, UnoCSS, Ant Design, i18next |
| Backend | Tauri v2, rusqlite, tokio, serde, regex |

## Editor Configuration

### VS Code Recommended Extensions
- Biome LSP
- Tauri Visual Studio Code Extension
- ESLint
- Prettier

## Common Tasks

### Adding a New Tauri Plugin
1. Create directory in `src-tauri/src/plugins/{name}/`
2. Create `commands.rs`, `lib.rs`, `build.rs`, `permissions/default.toml`
3. Register plugin in `src-tauri/src/lib.rs`
4. Add frontend invoke wrapper in `src/utils/tauri.ts`

### Adding a New i18n Key
1. Add key to `src/locales/en.json` and `src/locales/zh.json`
2. Use in component: `const { t } = useTranslation(); t('key.name')`
