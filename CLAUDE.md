# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EcoPaste is an open-source, cross-platform clipboard management tool built with Tauri v2 and React. It provides a lightweight, efficient solution for managing clipboard history across Windows, macOS, and Linux platforms with a focus on privacy and local data storage.

## Technology Stack

- **Frontend**: React 18.3.1 + TypeScript 5.8.3
- **Build Tool**: Vite 5.4.18 with hot module replacement
- **Desktop Framework**: Tauri v2 (Rust backend)
- **UI Library**: Ant Design 5.24.7 with Happy Work Theme
- **Styling**: UnoCSS 0.63.6 (atomic CSS) + SCSS
- **State Management**: Valtio 2.1.4 (proxy-based)
- **Database**: SQLite with Tauri SQL plugin
- **Package Manager**: pnpm (enforced via preinstall script)
- **Code Quality**: Biome 1.9.3 for linting and formatting

## Development Commands

### Core Development
```bash
pnpm dev          # Start development server with icon generation
pnpm build        # Production build (includes icon generation and vite build)
pnpm tauri dev    # Start Tauri development mode
pnpm tauri build  # Build Tauri application
```

### Code Quality
```bash
pnpm lint         # Run Biome check and auto-fix issues
```

### Release Management
```bash
pnpm release      # Standard release
pnpm release-rc   # Release candidate
pnpm release-beta # Beta release
```

## Architecture Overview

### Application Structure
The codebase follows a modular architecture with clear separation of concerns:

```
src/
├── components/     # Reusable UI components (ProList, ProSelect, etc.)
├── constants/      # Application constants and configuration
├── database/       # Database operations and SQL utilities
├── hooks/          # Custom React hooks (useTauriListen, useSubscribe, etc.)
├── locales/        # Internationalization files (i18n)
├── pages/          # Main application pages (Main, Preference)
├── plugins/        # Tauri plugin wrappers (clipboard, ocr, paste, window)
├── router/         # Application routing configuration
├── stores/         # State management (global, clipboard)
├── types/          # TypeScript type definitions
└── utils/          # Utility functions and helpers
```

### Window Architecture
- **Main Window**: Transparent, always-on-top clipboard interface (360x600px)
- **Preference Window**: Settings interface (700x480px)
- Both windows use transparent backgrounds and custom styling

### State Management
- **Global Store**: App settings, appearance, shortcuts, updates
- **Clipboard Store**: Window preferences, audio settings, search, content settings, history
- Uses Valtio for proxy-based reactive state management

### Database Schema
Single SQLite `history` table with fields:
- `id`, `type`, `group`, `value`, `search`
- `count`, `width`, `height`, `favorite`
- `createTime`, `note`, `subtype`

## Development Guidelines

### Code Style
- Uses Biome for consistent formatting and linting
- Strict TypeScript configuration enabled
- Auto-imports configured for React, hooks, and utilities
- Path aliases: `@/*` maps to `src/*`

### Component Architecture
- Custom `Pro*` components (ProList, ProSelect, ProSwitch) for consistent UI
- Modular component structure with clear separation of concerns
- Uses ahooks for enhanced React utilities

### Tauri Integration
- Custom Tauri plugins for core functionality:
  - `tauri-plugin-eco-clipboard`: Clipboard operations
  - `tauri-plugin-eco-paste`: Paste functionality
  - `tauri-plugin-eco-ocr`: Text recognition
  - `tauri-plugin-eco-window`: Window management
  - `tauri-plugin-eco-autostart`: Autostart functionality

### Git Workflow
- Uses simple-git-hooks for pre-commit validation
- Commitlint for conventional commits
- Lint-staged runs Biome on committed files
- Only pnpm is allowed as package manager

### Build Process
1. Icon generation via `scripts/buildIcon.ts`
2. Vite build for frontend assets
3. Tauri build for desktop application
4. Multiple platform outputs (NSIS, DMG, AppImage, DEB, RPM)

## Key Files and Configurations

- **Tauri Config**: `src-tauri/tauri.conf.json` - App settings, windows, permissions
- **Vite Config**: Auto-imports, aliases, dev server settings
- **TypeScript Config**: Strict mode with path aliases and CSS modules
- **Biome Config**: Code formatting and linting rules
- **Main Entry**: `src/main.tsx` and `src/App.tsx`
- **Router**: `src/router/index.ts` - Hash-based routing
- **Stores**: `src/stores/global.ts` and `src/stores/clipboard.ts`

## Common Development Patterns

### Custom Hooks
- `useTauriListen`: Listen to Tauri events
- `useSubscribe`: Subscribe to store changes
- `useImmediate`: Immediate effect execution
- `useWindowState`: Window state management

### Plugin Usage
All Tauri plugins are wrapped in `src/plugins/` for consistent API and error handling.

### Internationalization
Uses react-i18next with locale files in `src/locales/`. Language changes are reactive and persist in global store.

### Styling Approach
- UnoCSS for atomic CSS classes
- SCSS for complex component styles
- Ant Design theming with Happy Work Theme
- CSS modules supported via TypeScript plugin

## Testing

Currently has basic testing setup in `tests/` directory but no comprehensive unit/integration test suite. Focus is on manual testing and user feedback.