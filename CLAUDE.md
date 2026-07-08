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
- **claspトークン**: ~/.clasprc.json に保存済み

## Git運用ルール
- 作業開始時に必ず `git pull` を実行すること
- 作業終了時に必ず `git add -A && git commit && git push` まで完了させること
- 途中で作業を中断する場合もpushしてから離れること
- GASを変更した場合は `clasp push && clasp deploy` もpushの前に実行すること

## 進捗記録ルール
- ユーザーが「OK」「完了」「ありがとう」などを言ったタイミングでPROGRESS.mdを更新してpush
- PROGRESS.mdには「何をやったか」「次にやること」「未完了の課題」「ユーザーの意図・構想」「最後の作業環境」を記録すること
- 「ユーザーの意図・構想」には会話の中でユーザーが話した目的・将来像・設計上の判断理由を追記すること（古い内容は残して蓄積する）
- 「最後の作業環境」には作業した端末名（開発Mac / RPA端末 / MateBook）と日時を記録すること
- 次回作業開始時に必ずPROGRESS.mdを読み込んでから始める

## GitHub
- **ユーザー**: ks-mac0728

## 運用ルールの共有ルール
- 作業中に「このプロジェクト固有ではなく、全プロジェクト・全端末に共通する運用ルールだ」と気づいた場合、このプロジェクトのCLAUDE.mdだけに書いて終わらせず、`~/Documents/operations`（`templates/CLAUDE.md.template`・`templates/PROGRESS.md.template`）や`~/Documents/dev-environment`側も直接編集してcommit・pushすること
- これを怠ると、個別プロジェクトで得た知見がそのプロジェクト内に閉じ込められ、他のプロジェクト・他端末に共有されないまま失われる

## 開発環境について
**セッション開始時に必ず`~/Documents/dev-environment/PROGRESS.md`を読み込むこと**（「参照すること」ではなく、聞かれなくても毎回自動で行うこと）。拠点構成・ネットワーク・認証方式等の最新情報はここにしかない。ここには複製しない（重複すると情報が古くなるため）。

## AIクレジット枯渇時の引き継ぎルール
1. 作業の優先記録: クレジット（APIリクエスト制限）が切れそうになった場合、またはユーザーからの指示があった場合は、作業を中断し、直ちに現在の進行状況、未完了のタスク、および次に実行すべきステップを `PROGRESS.md` に詳細に記録すること。
2. フォールバック先の優先順位（2026-07-08検証済み）:
   1. **Gemini**（AiderDeskの`gemini-2.5-pro`によるAgentモード、またはGemini CLI）。自律的な複数ステップ実行が実際に機能することを確認済み。コストも1回あたり$0.002程度と軽微
   2. Claude API従量課金・DeepSeek・OpenRouter・Groq等の他社API（要ユーザー自身のアカウント登録。コストや無料枠の制限を考慮して選ぶ）
   3. RPA端末のOllamaローカルAI（`qwen2.5-coder:7b`）は**Aiderの Code Mode（シンプルな差分編集）限定**で使うこと。Agentモード（ツール呼び出しによる自律実行）は`qwen2.5-coder:7b`・`llama3.1:8b`・`qwen3:8b`の3モデルで検証した結果、ツール呼び出しの形式崩れ・ツール不使用・計画だけ立てて実行せず、という3通りの失敗パターンとなり不採用（16GB RAM環境の構造的な限界と判断）。ローカルAIには具体的かつ単純な指示のみを与えること

## GAS デプロイ手順
```bash
cd gas/
clasp push
clasp deploy
```

## Chrome拡張 インストール手順
1. Chrome → chrome://extensions/ → デベロッパーモードON
2. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択
