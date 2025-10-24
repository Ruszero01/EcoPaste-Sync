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

- 🔄 **Basic Cloud Sync**: Multi-device clipboard data synchronization through WebDAV protocol
- 🗂️ **Flexible Configuration**: Support for custom sync paths and sync frequency settings
- 🔐 **Data Security**: Hybrid mode with local storage as primary and cloud sync as secondary

### 🚀 Future Plans

- 📌 **Selective Sync**: Support for selective synchronization (e.g., only favorites, specific types)
- ⚡ **Real-time Sync**: Real-time synchronization based on cloud database for instant updates across devices
- 🎯 **Smart Sync Strategy**: Automatic optimization of sync behavior based on network conditions and device status
- 🌐 **Multi-protocol Support**: Support for more cloud storage protocols (OneDrive, Google Drive, etc.)

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
git clone -b add-sync https://github.com/EcoPasteHub/EcoPaste.git
cd EcoPaste

# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build production version
pnpm tauri build
```

> ⚠️ **Note**: This is a development branch and may contain experimental features. For production use, we recommend choosing the official stable version.

## Features

- 🎉 Built with Tauri v2, lightweight and efficient, taking cross-platform experience to the next level.
- 💻 Compatible with Windows, macOS, and Linux (X11), enabling seamless switching between devices.
- ✨ Simple and intuitive user interface, easy to operate, zero learning curve, ready to use out of the box.
- 📋 Supports clipboard content types like plain text, rich text, HTML, images, and files.
- 🔒 Local data storage ensures user privacy and gives users full control over their data.
- 📝 Notes feature allows easy categorization, management, and retrieval to boost productivity.
- ☁️ **Cloud Sync**: Supports clipboard data synchronization across multiple devices through WebDAV protocol, ensuring data consistency across different platforms.
- 🔄 **Smart Sync Strategy**: Supports manual sync and scheduled sync, allowing flexible adjustment of sync frequency based on network conditions.
- 🛡️ **Data Security**: Cloud sync data uses encrypted transmission and supports custom sync paths, ensuring data security and controllability.
- ⚙️ Rich personalization settings to meet diverse user needs and create a tailored experience.
- 🤝 Comprehensive documentation and community support to explore and grow with developers.
- 🧩 Continuously optimized with more exciting features waiting to be discovered.

## Feedback

1. 🔍 First, check out the [FAQ](https://ecopaste.cn/problem/macos/damage) or browse through the existing [issues](https://github.com/EcoPasteHub/EcoPaste/issues)。

2. ❓ If your issue remains unresolved, please submit a new [issue](https://github.com/EcoPasteHub/EcoPaste/issues/new/choose) with a detailed description to help us quickly identify and address the problem.

## Star History

<a href="https://star-history.com/#EcoPasteHub/EcoPaste&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
 </picture>
</a>

## Community

⚠️ Friendly Reminder: Group chats are for casual discussions and experience sharing only. For issue reporting or submitting new feature requests, please refer to [Feedback](#Feedback).

<table>
  <thead>
    <tr>
      <th width="33.3%">WeChat Group</th>
      <th width="33.3%">QQ Group</th>
      <th width="33.3%">Telegram</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://ecopaste.cn/community/wechat-group-dark.png" />
          <source media="(prefers-color-scheme: light)" srcset="https://ecopaste.cn/community/wechat-group-light.png" />
          <img src="https://ecopaste.cn/community/wechat-group-light.png" />
        </picture>
      </td>
      <td>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://ecopaste.cn/community/qq-group-dark.png" />
          <source media="(prefers-color-scheme: light)" srcset="https://ecopaste.cn/community/qq-group-light.png" />
          <img src="https://ecopaste.cn/community/qq-group-light.png" />
        </picture>
      </td>
      <td>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://ecopaste.cn/community/telegram-chat-dark.png" />
          <source media="(prefers-color-scheme: light)" srcset="https://ecopaste.cn/community/telegram-chat-light.png" />
          <img src="https://ecopaste.cn/community/telegram-chat-light.png" />
        </picture>
      </td>
    </tr>
  </tbody>
</table>

## Contributors

Thank you to everyone who has contributed to EcoPaste! If you’d like to contribute, check out the [Contributing Guide](./.github/CONTRIBUTING/en-US.md).

<a href="https://github.com/EcoPasteHub/EcoPaste/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=EcoPasteHub/EcoPaste" />
</a>

## Sponsors

If you find this project helpful, consider sponsoring us! Your support helps us maintain and improve EcoPaste, bringing more value to the community.

Please leave a message when sponsoring so we can include you in our [Sponsors List](https://ecopaste.cn/sponsor/list). Thank you for your support and encouragement!

|                        WeChat Pay                         |                       Alipay                        |
| :-------------------------------------------------------: | :-------------------------------------------------: |
| ![wehcat-pay](https://ecopaste.cn/sponsor/wechat-pay.png) | ![ali-pay](https://ecopaste.cn/sponsor/ali-pay.png) |
