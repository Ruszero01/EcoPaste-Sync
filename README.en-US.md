<a href="https://github.com/EcoPasteHub/EcoPaste">
  <img src="https://socialify.git.ci/EcoPasteHub/EcoPaste/image?description=1&descriptionEditable=Open%20source%20clipboard%20management%20tools%20for%20Windows%2C%20MacOS%20and%20Linux(x11).&font=Source%20Code%20Pro&forks=1&issues=1&logo=https%3A%2F%2Fgithub.com%2FEcoPasteHub%2FEcoPaste%2Fblob%2Fmaster%2Fpublic%2Flogo.png%3Fraw%3Dtrue&name=1&owner=1&pattern=Floating%20Cogs&pulls=1&stargazers=1&theme=Auto" alt="EcoPaste" />
</a>

<div align="center">
  <br/>
  
  <div>
      English | <a href="./README.md">简体中文</a> | <a href="./README.zh-TW.md">繁體中文</a> | <a href="./README.ja-JP.md">日本語</a>
  </div>

  <br/>
    
  <div>
    <a href="https://github.com/EcoPasteHub/EcoPaste/releases">
      <img
        alt="Windows"
        src="https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB0PSIxNzI2MzA1OTcxMDA2IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjE1NDgiIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ij48cGF0aCBkPSJNNTI3LjI3NTU1MTYxIDk2Ljk3MTAzMDEzdjM3My45OTIxMDY2N2g0OTQuNTEzNjE5NzVWMTUuMDI2NzU3NTN6TTUyNy4yNzU1NTE2MSA5MjguMzIzNTA4MTVsNDk0LjUxMzYxOTc1IDgwLjUyMDI4MDQ5di00NTUuNjc3NDcxNjFoLTQ5NC41MTM2MTk3NXpNNC42NzA0NTEzNiA0NzAuODMzNjgyOTdINDIyLjY3Njg1OTI1VjExMC41NjM2ODE5N2wtNDE4LjAwNjQwNzg5IDY5LjI1Nzc5NzUzek00LjY3MDQ1MTM2IDg0Ni43Njc1OTcwM0w0MjIuNjc2ODU5MjUgOTE0Ljg2MDMxMDEzVjU1My4xNjYzMTcwM0g0LjY3MDQ1MTM2eiIgcC1pZD0iMTU0OSIgZmlsbD0iI2ZmZmZmZiI+PC9wYXRoPjwvc3ZnPg=="
      />
    </a >  
    <a href="https://github.com/EcoPasteHub/EcoPaste/releases">
      <img
        alt="MacOS"
        src="https://img.shields.io/badge/-MacOS-black?style=flat-square&logo=apple&logoColor=white"
      />
    </a >
    <a href="https://github.com/EcoPasteHub/EcoPaste/releases">
      <img 
        alt="Linux"
        src="https://img.shields.io/badge/-Linux-yellow?style=flat-square&logo=linux&logoColor=white" 
      />
    </a>
  </div>

  <div>
    <a href="./LICENSE">
      <img
        src="https://img.shields.io/github/license/EcoPasteHub/EcoPaste?style=flat-square"
      />
    </a >
    <a href="https://github.com/EcoPasteHub/EcoPaste/releases">
      <img
        src="https://img.shields.io/github/package-json/v/EcoPasteHub/EcoPaste?style=flat-square"
      />
    </a >
    <a href="https://github.com/EcoPasteHub/EcoPaste/releases">
      <img
        src="https://img.shields.io/github/downloads/EcoPasteHub/EcoPaste/total?style=flat-square"
      />  
    </a >
  </div>
  
  <br/>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./static/app-dark.en-US.png" />
    <source media="(prefers-color-scheme: light)" srcset="./static/app-light.en-US.png" />
    <img src="./static/app-light.en-US.png" />
 </picture>
</div>

## 🌟 Branch Information

> 📋 **This branch is based on the official EcoPaste v0.5.0 version, providing a temporary solution for cloud sync functionality as the official cloud sync feature has been delayed.**

### ✨ Current Features

- 🔄 **WebDAV Cloud Sync**: Multi-device clipboard data synchronization through WebDAV protocol
- 🗂️ **Dual-Switch Sync Mode**: Simple favorites mode and file mode switches for selective content synchronization
- 🔐 **Data Security**: Local-first storage architecture, data fully controlled, HTTPS/TLS encrypted transmission
- ⚡ **Real-time Sync Engine**: Smart conflict detection and resolution based on checksums, supporting bidirectional and incremental sync
- 🤖 **Background Auto Sync**: Rust plugin-based scheduled sync, configurable 1-24 hour intervals
- ⚙️ **Configuration Sync**: Complete application settings sync including sync modes, shortcuts, UI configurations
- 📁 **Optimized File Handling**: Smart file path extraction, metadata management, cross-device path consistency

### 📦 Usage Instructions

This branch is primarily for users who urgently need cross-device sync functionality, serving as a temporary solution until the official cloud sync feature is released. If you only need local clipboard management, we recommend using the [official main branch](https://github.com/EcoPasteHub/EcoPaste).

---

## 📥 Get Application

> 💡 **This branch focuses on cloud sync feature development. For downloading the complete application, please visit the official main branch.**

### 🔗 Visit Official Main Branch

- 🌐 **GitHub Homepage**: [EcoPasteHub/EcoPaste](https://github.com/EcoPasteHub/EcoPaste)
- 📱 **Official Downloads**: [Releases Page](https://github.com/EcoPasteHub/EcoPaste/releases)
- 📚 **Documentation**: [EcoPaste Official Website](https://ecopaste.cn/)

### 🛠️ Build from Source (Development Version)

```bash
# Clone this branch
git clone https://github.com/Ruszero01/EcoPaste-Sync.git

# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build production version
pnpm tauri build
```

> ⚠️ **Note**: This is a development branch and may contain experimental features. For production use, we recommend choosing the official stable version.

### ☁️ Cloud Sync Features (This Branch's Specialty)

#### 🏗️ System Architecture

Distributed cloud sync architecture based on WebDAV protocol, adopting a local-first design philosophy:

```mermaid
graph TB
    subgraph "Multi-Device Environment"
        D1[Device A]
        D2[Device B]
        D3[Device C]
    end

    subgraph "Cloud Sync Architecture"
        SE[SyncEngine<br/>Sync Engine Core]
        CD[CloudDataManager<br/>Cloud Data Manager]
        FS[FileSyncManager<br/>File Sync Manager]
        WD[WebDAV<br/>Cloud Storage Service]
    end

    subgraph "Local Storage"
        DB[(SQLite<br/>Local Database)]
        FS2[File System<br/>Local Cache]
    end

    D1 --> SE
    D2 --> SE
    D3 --> SE
    SE --> CD
    SE --> FS
    CD --> WD
    FS --> WD
    SE --> DB
    SE --> FS2
```

#### ✨ Core Features

- **Dual-Switch Sync Mode**: Simple favorites mode and file mode switches for flexible content control
- **Multi-type Support**: Support for various data types including text, images, and files
- **Bidirectional Sync**: Support for bidirectional data synchronization and incremental updates across multiple devices
- **Auto Sync**: Configurable sync intervals for automatic data synchronization
- **WebDAV Protocol**: Based on standard WebDAV protocol, compatible with various cloud storage services
- **Data Security**: Support for data encryption and compression to ensure secure transmission
- **Error Handling**: Comprehensive error handling and retry mechanisms to ensure sync reliability
- **Simple Interface**: Clean user interface and status display for easy operation

#### 📋 Technical Architecture Details

**🔄 Sync Process**

1. **Data Collection**: Collect clipboard data from local database
2. **Smart Filtering**: Filter data based on dual-switch sync mode (favorites mode/file mode)
3. **Conflict Detection**: Detect real conflicts based on checksums and timestamps
4. **Conflict Resolution**: Support three strategies: local priority, remote priority, smart merge
5. **File Processing**: Separate processing of metadata and original files
6. **Cloud Sync**: Upload index and files to WebDAV server
7. **Local Update**: Apply cloud changes to local database

**💾 Storage Architecture**

- **Local Storage**: SQLite database + file system cache
- **Cloud Storage**: WebDAV server (sync-data.json + files/ directory)
- **Data Format**: Hybrid architecture of lightweight index + complete metadata

**🛡️ Security Guarantees**

- Local-first storage, data fully controllable
- HTTPS/TLS encrypted transmission
- Smart conflict resolution to avoid data loss
- Comprehensive error handling and recovery mechanisms

📖 **Detailed Architecture Documentation**: View [Cloud Sync Architecture Documentation](./docs/CLOUD_SYNC_ARCHITECTURE.md) and [Architecture Diagram](./docs/architecture-diagram.md) for technical implementation details.

### Cloud Sync Configuration (This Branch)

1. **Prepare WebDAV Service**: Ensure you have an available WebDAV service
2. **Configure Connection**: Configure server information in preferences' "Cloud Sync" section
3. **Start Syncing**: Select appropriate sync strategy and start synchronization

## Star History

<a href="https://star-history.com/#EcoPasteHub/EcoPaste&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
 </picture>
</a>

## Contributors

Thank you to everyone who has contributed to EcoPaste! If you’d like to contribute, check out the [Contributing Guide](./.github/CONTRIBUTING/en-US.md).

<a href="https://github.com/EcoPasteHub/EcoPaste/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=EcoPasteHub/EcoPaste" />
</a>
