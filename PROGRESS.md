# 進捗ログ

## 現在のステータス: ✅ 動作確認待ち

---

## 完了済み

- [x] manifest.json 作成（Manifest V3）
- [x] popup.html / popup.js 作成（UI・サイト判定）
- [x] background.js 作成（スクレイピング・GAS通信）
- [x] gas/Code.gs 作成（doGet/doPost）
- [x] GASプロジェクト作成・push・deploy完了（v3）
- [x] OAuthブロック突破（setup()関数を実行してSheets/Drive権限承認済み）
- [x] Spreadsheet ID・Folder ID をコードに埋め込み済み
- [x] GitHubリポジトリ作成・push完了

---

## 設定値メモ

| 項目 | 値 |
|---|---|
| GAS Web App URL | https://script.google.com/macros/s/AKfycbyMpaRiFj_N_fSHNf5RE3bVJmMtGwaW9Py9NOe47Ki3LPy41IGn22_HKIl1k6k3C3eRdw/exec |
| Spreadsheet ID | 1kTcfBD_0FFplFjHR0j-wXexpdOV783QSNnOO9WXseVo |
| Drive Folder ID | 1N8b7OGZo8ZNuanTWvZEc8tNY-aZtWIiY |
| GAS Script ID | 1hGg1OILjjcgXNsyRZMZgdm9WLUHqNcfM2LI41-pfgCkSmEPpd_em5XiK |
| GitHub リポジトリ | https://github.com/ks-mac0728/blog-scraper-extension |

---

## 次にやること（動作確認）

1. Chrome拡張をインストール（未済の場合）
   - chrome://extensions/ → デベロッパーモードON
   - 「パッケージ化されていない拡張機能を読み込む」→ ~/blog-scraper-extension/ を選択

2. naname42.com の対象ページを開く
   - https://naname42.com/blog-entry-570.html（ナマラー）
   - https://naname42.com/blog-entry-625.html（シロドラー）
   - https://naname42.com/blog-entry-624.html（プリカラ）

3. 拡張機能アイコンをクリック → 「スクレイピング実行」

4. スプレッドシートに追記されるか確認
   - https://docs.google.com/spreadsheets/d/1kTcfBD_0FFplFjHR0j-wXexpdOV783QSNnOO9WXseVo

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-06-30 | 全ファイル作成・GASデプロイ完了。OAuthブロック中 |
| 2026-06-30 | OAuth承認完了。ID設定・再デプロイ完了。動作確認待ち |
