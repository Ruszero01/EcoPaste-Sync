<a href="https://github.com/EcoPasteHub/EcoPaste">
  <img src="https://socialify.git.ci/EcoPasteHub/EcoPaste/image?description=1&descriptionEditable=%E9%81%A9%E7%94%A8%E6%96%BC%20Windows%E3%80%81MacOS%20%E5%92%8C%20Linux(x11)%20%E7%9A%84%E9%96%8B%E6%BA%90%E5%89%AA%E8%B2%BC%E6%9D%BF%E7%AE%A1%E7%90%86%E5%B7%A5%E5%85%B7%E3%80%82&font=Source%20Code%20Pro&forks=1&issues=1&logo=https%3A%2F%2Fgithub.com%2FEcoPasteHub%2FEcoPaste%2Fblob%2Fmaster%2Fpublic%2Flogo.png%3Fraw%3Dtrue&name=1&owner=1&pattern=Floating%20Cogs&pulls=1&stargazers=1&theme=Auto" alt="EcoPaste" />
</a>

<div align="center">
  <br/>

  <div>
    繁體中文 | <a href="./README.md">简体中文</a> | <a href="./README.en-US.md">English</a> | <a href="./README.ja-JP.md">日本語</a>
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
    <source media="(prefers-color-scheme: dark)" srcset="./static/app-dark.zh-TW.png" />
    <source media="(prefers-color-scheme: light)" srcset="./static/app-light.zh-TW.png" />
    <img src="./static/app-light.zh-TW.png" />
  </picture>
</div>

## 🌟 分支說明

> 📋 **本分支基於官方 EcoPaste v0.5.0 版本，提供雲端同步功能的臨時解決方案，由於官方雲端同步功能遲遲未上線。**

### ✨ 當前特性

- 🔄 **基礎雲端同步**：透過 WebDAV 協定實現剪貼板數據的多設備同步
- 🗂️ **靈活配置**：支援自定義同步路徑和同步頻率設定
- 🔐 **數據安全**：本地存儲為主，雲端同步為輔的混合模式

### 🚀 未來規劃

- 📌 **選擇性同步**：支援選擇性同步（如僅同步收藏內容、指定類型等）
- ⚡ **即時同步**：基於雲端數據庫的即時同步功能，多設備間即時更新
- 🎯 **智慧同步策略**：根據網路狀況和設備狀態自動優化同步行為
- 🌐 **多協定支援**：支援更多雲端存儲協定（如 OneDrive、Google Drive 等）

### 📦 使用說明

本分支主要面向急需跨設備同步功能的用戶，作為官方雲端同步功能發布前的臨時解決方案。如果您只需要本地剪貼板管理功能，建議使用 [官方主分支](https://github.com/EcoPasteHub/EcoPaste)。

---

## 📥 獲取應用程式

> 💡 **本分支專注於雲端同步功能開發，如需下載完整應用程式，請訪問官方主分支**

### 🔗 訪問官方主分支

- 🌐 **GitHub 主頁**：[EcoPasteHub/EcoPaste](https://github.com/EcoPasteHub/EcoPaste)
- 📱 **官方下載**：[Releases 頁面](https://github.com/EcoPasteHub/EcoPaste/releases)
- 📚 **使用文檔**：[EcoPaste 官網](https://ecopaste.cn/)

### 🛠️ 從源碼建構（開發版）

```bash
# 克隆本分支
git clone -b add-sync https://github.com/EcoPasteHub/EcoPaste.git
cd EcoPaste

# 安裝依賴
pnpm install

# 開發模式運行
pnpm tauri dev

# 建構生產版本
pnpm tauri build
```

> ⚠️ **注意**：本分支為開發分支，可能包含實驗性功能。生產使用建議選擇官方穩定版本。

## 功能介紹

- 🎉 基於 Tauri v2 開發，輕量高效，跨平臺體驗更進一步。
- 💻 支持 Windows、macOS 和 Linux（x11），在多設備間無縫切換。
- ✨ 簡潔直觀的使用者介面，操作簡單，零門檻上手，開箱即用。
- 📋 支持純文字、富文字、HTML、圖片和檔案類型的剪貼板內容。
- 🔒 數據本地存儲，確保用戶隱私安全，數據完全掌控在用戶手中。
- 📝 支持備註功能，輕鬆分類、管理和檢索，讓工作更高效。
- ☁️ **雲端同步功能**：支援透過 WebDAV 協定實現多設備間的剪貼板數據同步，確保數據在不同設備間保持一致性。
- 🔄 **智慧同步策略**：支援手動同步和定時同步，可根據網路狀況靈活調整同步頻率。
- 🛡️ **數據安全保障**：雲端同步數據採用加密傳輸，支援自定義同步路徑，確保數據安全可控。
- ⚙️ 豐富的個性化設定，滿足不同用戶需求，打造專屬體驗。
- 🤝 完善的檔案與社區支持，與開發者共同探索與成長。
- 🧩 持續優化中，更多驚喜功能等你發現。

## 問題迴響

1. 🔍 優先查閱[常見問題](https://ecopaste.cn/problem/macos/damage)或瀏覽已有 [issues](https://github.com/EcoPasteHub/EcoPaste/issues)。

2. ❓ 如果問題仍未解决，請提交新的 [issue](https://github.com/EcoPasteHub/EcoPaste/issues/new/choose)，並附上詳細描述，方便我們快速定位和解决。

## 歷史星標

<a href="https://star-history.com/#EcoPasteHub/EcoPaste&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
 </picture>
</a>

## 社區交流

⚠️ 溫馨提示：群聊僅限日常討論和經驗分享，如需迴響問題或提交新需求，請查看[問題迴響](#問題迴響)。

<table>
  <thead>
    <tr>
      <th width="33.3%">微信群</th>
      <th width="33.3%">QQ 群</th>
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

## 貢獻者

感謝大家為 EcoPaste 做出的寶貴貢獻！如果你也希望為 EcoPaste 做出貢獻，請查閱[貢獻指南](./.github/CONTRIBUTING/zh-TW.md)。

<a href="https://github.com/EcoPasteHub/EcoPaste/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=EcoPasteHub/EcoPaste" />
</a>

## 贊助

如果您覺得這個項目對您有幫助，可以考慮贊助支持我們！您的支持將幫助我們更好地維護和發展項目，讓 EcoPaste 持續為社區創造價值。

贊助時請務必填寫留言，以便我們收錄到[贊助名單](https://ecopaste.cn/sponsor/index)中，感謝您的支持與鼓勵！

|                           微信                            |                       支付寶                        |
| :-------------------------------------------------------: | :-------------------------------------------------: |
| ![wehcat-pay](https://ecopaste.cn/sponsor/wechat-pay.png) | ![ali-pay](https://ecopaste.cn/sponsor/ali-pay.png) |
