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

- 🔄 **WebDAV 雲端同步**：透過 WebDAV 協定實現剪貼板數據的多設備同步
- 🗂️ **智慧同步模式**：支援多種同步策略，包括按內容類型、收藏狀態等條件進行選擇性同步
- 🔐 **數據安全保障**：本地存儲為主，雲端同步為輔的混合模式，數據完全可控
- ⚡ **即時同步引擎**：智慧衝突檢測與解決，支援雙向同步和增量更新

### 🚀 未來規劃

- 📌 **多協定雲端存儲支援**：支援 OneDrive、Google Drive、Dropbox 等更多雲端存儲協定
- ⚡ **雲端數據庫即時同步**：基於雲端數據庫的即時同步功能，多設備間即時更新

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

## 核心功能

### 📋 剪貼板管理
- **多格式支援**：支援純文字、富文字、HTML、圖片、檔案等多種剪貼板格式
- **智慧去重**：自動識別重複內容，避免冗餘存儲
- **歷史記錄**：完整保存剪貼板歷史，支援按時間、類型、收藏狀態篩選
- **快速搜尋**：強大的搜尋功能，快速定位所需內容
- **分組管理**：按內容類型自動分組（文字、圖片、檔案等）
- **收藏系統**：標記重要內容為收藏，永久保存不被清理

### 🎨 介面與互動
- **現代化設計**：基於 Ant Design 的美觀介面，支援亮色/暗色主題
- **多種視窗模式**：浮動視窗、停靠視窗等多種顯示方式
- **快捷操作**：一鍵複製、貼上、刪除等快捷操作
- **快捷鍵支援**：全域快捷鍵快速喚出，快速貼上鍵（1-9）高效操作

### 🔧 系統整合
- **多平臺支援**：Windows、macOS、Linux（x11）全平臺兼容
- **開機自啟**：支援開機自動啟動，後台靜默運行
- **系統托盤**：最小化到系統托盤，不佔用工作列空間
- **全域熱鍵**：自訂全域快捷鍵，隨時快速存取

### 📊 數據管理
- **本地資料庫**：基於 SQLite 的可靠本地存儲
- **自動清理**：可配置的歷史記錄自動清理策略
- **數據匯出**：支援數據備份和匯出功能
- **容量管理**：智慧管理存儲空間，避免過度佔用
- **數據恢復**：支援從備份檔案恢復數據

### ☁️ 雲端同步功能（本分支特色）
- **WebDAV 同步**：支援透過 WebDAV 協定進行多設備數據同步
- **智慧同步模式**：多種同步策略，支援按內容類型、收藏狀態等條件選擇
- **衝突解決**：智慧衝突檢測與自動解決機制
- **雙向同步**：支援多設備間的雙向數據同步

### ⚙️ 個性化設定
- **主題定制**：亮色/暗色主題，跟隨系統或手動切換
- **語言支援**：中文簡體、繁體、英文、日文等多語言
- **行為配置**：豐富的行為選項，滿足不同使用習慣
- **效能優化**：可配置的效能參數，平衡功能與資源佔用
- **更新管理**：自動檢查更新，支援增量更新

### 🔒 隱私與安全
- **本地優先**：數據主要存儲在本地，完全可控
- **隱私保護**：敏感數據不上傳，或僅在用戶授權下同步
- **權限管理**：最小權限原則，僅請求必要的系統權限
- **安全審計**：程式碼開源透明，接受社群安全審查

## 📖 使用指南

### 快速開始
1. **下載安裝**：從 [Releases](https://github.com/EcoPasteHub/EcoPaste/releases) 頁面下載對應平臺的安裝包
2. **啟動應用**：首次啟動會自動開始監聽剪貼板
3. **配置設定**：透過偏好設定自訂行為和外觀
4. **開始使用**：使用快捷鍵喚出介面，開始管理剪貼板

### 雲端同步配置（本分支）
1. **準備 WebDAV 服務**：確保你有可用的 WebDAV 服務
2. **配置連接**：在偏好設定的"雲端同步"中填寫伺服器資訊並測試連接
3. **開始同步**：選擇合適的同步策略並開始同步

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
