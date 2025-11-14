<a href="https://github.com/EcoPasteHub/EcoPaste">
  <img src="https://socialify.git.ci/EcoPasteHub/EcoPaste/image?description=1&descriptionEditable=Windows%E3%80%81MacOS%E3%80%81Linux(x11)%20%E7%94%A8%E3%81%AE%E3%82%AA%E3%83%BC%E3%83%97%E3%83%B3%E3%82%BD%E3%83%BC%E3%82%B9%E3%81%AE%E3%82%AF%E3%83%AA%E3%83%83%E3%83%97%E3%83%9C%E3%83%BC%E3%83%89%E7%AE%A1%E7%90%86%E3%83%84%E3%83%BC%E3%83%AB%E3%80%82&font=Source%20Code%20Pro&forks=1&issues=1&logo=https%3A%2F%2Fgithub.com%2FEcoPasteHub%2FEcoPaste%2Fblob%2Fmaster%2Fpublic%2Flogo.png%3Fraw%3Dtrue&name=1&owner=1&pattern=Floating%20Cogs&pulls=1&stargazers=1&theme=Auto" alt="EcoPaste" />
</a>

<div align="center">
  <br/>

  <div>
      日本語 | <a href="./README.md">简体中文</a> | <a href="./README.zh-TW.md">繁體中文</a> | <a href="./README.en-US.md">English</a>
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
    <source media="(prefers-color-scheme: dark)" srcset="./static/app-dark.ja-JP.png" />
    <source media="(prefers-color-scheme: light)" srcset="./static/app-light.ja-JP.png" />
    <img src="./static/app-light.ja-JP.png" />
  </picture>
</div>

## 🌟 ブランチ情報

> 📋 **このブランチは公式 EcoPaste v0.5.0 バージョンをベースにし、公式のクラウド同期機能が遅れているため、クラウド同期機能の一時的なソリューションを提供します。**

### ✨ 現在の機能

- 🔄 **WebDAV クラウド同期**：WebDAV プロトコルを通じて複数デバイス間のクリップボードデータ同期を実現
- 🗂️ **デュアルスイッチ同期モード**：シンプルなお気に入りモードとファイルモードスイッチによる選択的コンテンツ同期
- 🔐 **データセキュリティ保障**：ローカルファーストストレージアーキテクチャ、データ完全制御、HTTPS/TLS 暗号化転送
- ⚡ **リアルタイム同期エンジン**：チェックサムベースのスマート競合検出と解決、双方向同期と増分更新
- 🤖 **バックグラウンド自動同期**：Rust プラグインベースのスケジュール同期、1-24 時間設定可能な間隔
- ⚙️ **設定同期**：完全なアプリケーション設定同期、同期モード、ショートカット、UI 設定を含む
- 📁 **ファイル最適化処理**：スマートファイルパス抽出、メタデータ管理、クロスデバイスパス一貫性保証

### 📦 使用説明

このブランチは主にクロスデバイス同期機能を緊急に必要とするユーザー向けで、公式のクラウド同期機能がリリースされるまでの一時的なソリューションとして提供されます。ローカルクリップボード管理機能のみが必要な場合は、[公式メインブランチ](https://github.com/EcoPasteHub/EcoPaste)の使用をお勧めします。

---

## 📥 アプリケーションの入手

> 💡 **このブランチはクラウド同期機能の開発に焦点を当てています。完全なアプリケーションのダウンロードについては、公式メインブランチをご覧ください。**

### 🔗 公式メインブランチへアクセス

- 🌐 **GitHub ホームページ**：[EcoPasteHub/EcoPaste](https://github.com/EcoPasteHub/EcoPaste)
- 📱 **公式ダウンロード**：[Releases ページ](https://github.com/EcoPasteHub/EcoPaste/releases)
- 📚 **ドキュメント**：[EcoPaste 公式サイト](https://ecopaste.cn/)

### 🛠️ ソースからビルド（開発版）

```bash
# このブランチをクローン
git clone https://github.com/Ruszero01/EcoPaste-Sync.git

# 依存関係をインストール
pnpm install

# 開発モードで実行
pnpm tauri dev

# 本番バージョンをビルド
pnpm tauri build
```

> ⚠️ **注意**：これは開発ブランチであり、実験的な機能が含まれている可能性があります。本番環境での使用は、公式の安定バージョンを選択することをお勧めします。

## 機能紹介

- 🎉 Tauri v2 をもとに開発、軽量で効率的、クロスプラットフォームの体験をさらに向上させる。
- 💻 Windows、macOS、Linux（x11）とも対応でき、複数デバイス間でシームレスに切り替え可能である。
- ✨ シンプルで直感的なユーザーインターフェース、敷居が低く簡単に利用可能になる。
- 📋 テキスト、リッチテキスト、HTML、画像、ファイル形式のクリップボード内容をサポートできる。
- 🔒 データはローカルに保存され、ユーザーのプライバシーを保護、データはユーザー自身が完全に管理できる。
- 📝 メモ機能をサポートでき、簡単に分類、管理、検索が可能で作業効率を向上させる。
- ☁️ **クラウド同期機能**：WebDAV プロトコルをベースにした多デバイス間のクリップボードデータ同期

#### 🏗️ システムアーキテクチャ

WebDAV プロトコルに基づく分散型クラウド同期アーキテクチャ、ローカルファーストの設計哲学を採用：

```mermaid
graph TB
    subgraph "マルチデバイス環境"
        D1[デバイス A]
        D2[デバイス B]
        D3[デバイス C]
    end

    subgraph "クラウド同期アーキテクチャ"
        SE[SyncEngine<br/>同期エンジンコア]
        CD[CloudDataManager<br/>クラウドデータ管理]
        FS[FileSyncManager<br/>ファイル同期管理]
        WD[WebDAV<br/>クラウドストレージサービス]
    end

    subgraph "ローカルストレージ"
        DB[(SQLite<br/>ローカルデータベース)]
        FS2[ファイルシステム<br/>ローカルキャッシュ]
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

#### ✨ コア機能

- 🔄 **デュアルスイッチ同期モード**：シンプルなお気に入りモードとファイルモードスイッチで柔軟なコンテンツ制御
- 📊 **多種データタイプ対応**：テキスト、画像、ファイルなど多様なデータタイプの同期をサポート
- 🔄 **双方向同期**：多デバイス間の双方向データ同期と増分更新をサポート
- ⏰ **自動同期**：同期間隔を設定可能で、データを自動的に同期
- 🔐 **データセキュリティ**：データの暗号化と圧縮をサポートし、転送の安全性を確保
- 🛠️ **エラーハンドリング**：完全なエラー処理と再試行メカニズムで同期の信頼性を確保
- 🎨 **シンプルなインターフェース**：シンプルなユーザーインターフェースと状態表示で操作が簡単

#### 📋 技術アーキテクチャ詳細

**🔄 同期プロセス**

1. **データ収集**：ローカルデータベースからクリップボードデータを収集
2. **スマートフィルタリング**：デュアルスイッチ同期モード（お気に入りモード/ファイルモード）に基づきデータをフィルタリング
3. **競合検出**：チェックサムとタイムスタンプに基づき真の競合を検出
4. **競合解決**：ローカル優先、リモート優先、スマートマージの 3 つの戦略をサポート
5. **ファイル処理**：メタデータとオリジナルファイルの分離処理
6. **クラウド同期**：インデックスとファイルを WebDAV サーバーにアップロード
7. **ローカル更新**：クラウドの変更をローカルデータベースに適用

**💾 ストレージアーキテクチャ**

- **ローカルストレージ**：SQLite データベース + ファイルシステムキャッシュ
- **クラウドストレージ**：WebDAV サーバー（sync-data.json + files/ ディレクトリ）
- **データフォーマット**：軽量インデックス + 完全メタデータのハイブリッドアーキテクチャ

**🛡️ セキュリティ保証**

- ローカルファーストストレージ、データ完全制御可能
- HTTPS/TLS 暗号化通信
- スマート競合解決、データ損失を防止
- 完全なエラー処理と復旧メカニズム

📖 **詳細なアーキテクチャドキュメント**：技術実装の詳細については、[クラウド同期アーキテクチャドキュメント](./docs/CLOUD_SYNC_ARCHITECTURE.md)と[アーキテクチャ図](./docs/architecture-diagram.md)をご覧ください。

- ⚙️ 豊富なカスタマイズ設定で、異なるユーザーのニーズを満たす個別体験を提供できる。
- 🤝 完善なドキュメントとコミュニティ機能をサポート、開発者と共に成長を目指す。
- 🧩 継続的な最適化し、もっと驚きの機能があなたの発見を待っている。

## 履歴スター

<a href="https://star-history.com/#EcoPasteHub/EcoPaste&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=EcoPasteHub/EcoPaste&type=Date" />
 </picture>
</a>

## 貢献者

EcoPaste へ貴重なご貢献をいただいた皆様に感謝します！もし EcoPaste にご協力のご希望があれば、[貢献ガイド](./.github/CONTRIBUTING/ja-JP.md)をご覧ください。

<a href="https://github.com/EcoPasteHub/EcoPaste/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=EcoPasteHub/EcoPaste" />
</a>
