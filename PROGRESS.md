# 進捗ログ

## 現在のステータス: ⏸ OAuthブロック中

---

## 完了済み

- [x] manifest.json 作成（Manifest V3）
- [x] popup.html / popup.js 作成（UI・サイト判定）
- [x] background.js 作成（スクレイピング・GAS通信）
- [x] gas/Code.gs 作成（doGet/doPost）
- [x] GASプロジェクト作成・clasp push・deploy完了
- [x] GAS Web App URL 取得済み（background.js の GAS_URL に要設定）
- [x] CLAUDE.md 作成
- [x] GitHubリポジトリ作成・push完了

---

## 次にやること

### ステップ1: GAS OAuthを承認する ← **ここで止まっている**

GASの初回実行に必要なOAuth権限（Sheets・Drive）をまだ承認していない。

**方法A（推奨）: GASエディタから実行**
1. https://script.google.com にアクセス（kousuke@multiuse.xyz でログイン）
2. このプロジェクトを開く
3. 関数セレクタで  を選択して「実行」ボタンを押す
4. 権限承認ダイアログが出るので「許可」
5. 実行ログにスプレッドシートのURLが表示される → IDをメモ

**方法B: iPhoneのSafariから**
- GASエディタにアクセスして同様に操作

### ステップ2: IDをコードに埋め込む

承認後、実行ログに出たスプレッドシートIDを以下2箇所に設定：

**gas/Code.gs**
```javascript
var SPREADSHEET_ID  = '1xxxxx...'; // ← ここ
var PARENT_FOLDER_ID = '1yyyyy...'; // ← GoogleドライブフォルダのID
```

**background.js**
```javascript
const GAS_URL = 'https://script.google.com/macros/s/実際のID/exec'; // ← ここ
```

その後：
```bash
cd ~/blog-scraper-extension/gas/
clasp push
clasp deploy --deploymentId 既存のdeploymentId
```

### ステップ3: 動作確認

1. Chrome拡張をリロード（chrome://extensions/）
2. naname42.com の対象ページ（blog-entry-570/625/624）を開く
3. 拡張機能のアイコンをクリック → 「スクレイピング実行」
4. スプレッドシートに追記されるか確認

---

## 設定値メモ

| 項目 | 値 | 状態 |
|---|---|---|
| GAS Web App URL | （要確認: clasp deploy の出力参照） | ✅ deploy済み |
| Spreadsheet ID | YOUR_SPREADSHEET_ID | ❌ 未設定 |
| Drive Folder ID | YOUR_FOLDER_ID | ❌ 未設定 |
| GitHub リポジトリ | https://github.com/ks-mac0728/blog-scraper-extension | ✅ |

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-06-30 | 全ファイル作成・GASデプロイ完了。OAuthブロック中 |
