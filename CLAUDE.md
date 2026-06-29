# FC2ブログスクレイパー Chrome拡張機能

## プロジェクト概要
FC2ブログ（naname42.com）から作品情報をスクレイピングして、Googleスプレッドシートへ差分更新するChrome拡張機能。

### 対象サイト（siteKey）
| siteKey | 名称 | レビュー列 |
|---|---|---|
| blog-entry-570 | ナマラー | あり |
| blog-entry-625 | シロドラー | あり |
| blog-entry-624 | プリカラ | なし |

## ファイル構成
```
blog-scraper-extension/
├── manifest.json    ← Chrome拡張 Manifest V3
├── popup.html       ← ポップアップUI
├── popup.js         ← サイト判定・UI制御
├── background.js    ← スクレイピング本体・GAS通信
└── gas/
    └── Code.gs      ← GAS WebApp（doGet/doPost）
```

## 処理フロー
1. ユーザーがポップアップのボタンを押す
2. background.js → GAS GET → 既存Noリスト取得
3. `chrome.scripting.executeScript` でスクレイパーをタブに注入・実行
4. 新規アイテムのみ画像Base64化してGAS POSTで追記

## 設定値（要書き換え箇所）

### background.js
- `GAS_URL` ← GAS Web App の公開URL

### gas/Code.gs
- `SPREADSHEET_ID` ← スプレッドシートのID
- `PARENT_FOLDER_ID` ← 画像保存先GoogleドライブフォルダのID

## 開発環境
- **RPA端末**: 192.168.40.222 (~/blog-scraper-extension/)
- **GASアカウント**: kousuke@multiuse.xyz
- **GitHubアカウント**: ks-mac0728
- **claspトークン**: ~/.clasprc.json に保存済み

## GAS デプロイ手順
```bash
cd gas/
clasp push
clasp deploy
```

## Chrome拡張 インストール手順
1. Chrome → chrome://extensions/ → デベロッパーモードON
2. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択
