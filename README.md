# Pocket Editor

スマホで AtCoder や Project Euler をするためのコードエディタ（PWA）。
ビルド不要の素の HTML / CSS / JavaScript だけで動きます。

## 競技プログラミング向けの機能

- **その場で実行**：上部の ▶ で実行・テスト画面へ
  - **Python**：ブラウザ内で実行（[Pyodide](https://pyodide.org/)）。初回に約 10MB をダウンロードした後はオフラインでも動作。
    `numpy` などは import すると自動で読み込み。`sys.stdin.buffer` や `exit()` も使用可、巨大整数の `str()` 制限は解除済み
  - **JavaScript**：ブラウザ内で実行。`require('fs').readFileSync('/dev/stdin')` と `readline` の `line`/`close` に対応
  - **C++**：[Wandbox](https://wandbox.org/) API でコンパイル・実行（要ネット接続、`-O2 -std=gnu++20`、ACL は非対応）
- **テストケース**：入力と期待する出力を登録して一括実行し、**AC / WA / RE / CE** を判定（小数は誤差 1e-6 まで許容）。
  ファイルごとに保存され、「貼り付け」ボタンでサンプルを入れられる
- **実行時間の表示**と**停止ボタン**（無限ループや長い Project Euler の計算を中断できる）
- **エラー行へジャンプ**：エラーメッセージの行番号をタップするとその行へ移動
- **テンプレート**：AtCoder（Python / C++）、Project Euler（Python）、JavaScript
- **シンタックスハイライト**と**行番号**、Python の `:` 後の自動インデント
- 提出用の**コードコピー**ボタン

## エディタの機能

- **自動保存**：入力内容は端末内（IndexedDB）に自動で保存
- **複数ファイル管理**：☰ から一覧・切り替え・新規作成、ファイル名タップで名前変更
- **補助キーバー**：Tab／インデント解除、← ↑ ↓ →（長押しで連続移動）、行頭／行末、
  プログラミング用の記号、行選択・行複製・行削除
- **括弧の自動補完**・**改行時の自動インデント**
- **検索と置換**：一致箇所のハイライト、大文字小文字の区別、正規表現（`$1` などの置換参照も可）
- **元に戻す／やり直す**（ブラウザ標準の履歴を利用）
- **端末のファイルを開く／ダウンロード保存／共有**（Web Share API）
- **設定**：文字サイズ、ライト／ダーク、インデント幅、折り返し、等幅フォント
- **オフライン対応**・**ホーム画面に追加**でアプリのように全画面表示
- 日本語入力（IME）と相性のよいネイティブの `textarea` ベース

## 使い方

### GitHub Pages で公開する（おすすめ）

1. このブランチを `main` にマージ
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更
3. `main` に push すると `.github/workflows/pages.yml` が自動でデプロイ
4. スマホで `https://<ユーザー名>.github.io/<リポジトリ名>/` を開く
5. ブラウザの共有メニューから「ホーム画面に追加」

### ローカルで試す

```sh
python3 -m http.server 8000
# → http://localhost:8000 を開く
```

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面構成 |
| `style.css` | スタイル（ライト／ダーク対応） |
| `app.js` | エディタ本体・実行画面の処理 |
| `syntax.js` | シンタックスハイライト |
| `runner.js` | コード実行（Python / JavaScript / C++）と出力の判定 |
| `workers/` | Python（Pyodide）・JavaScript を動かす Web Worker |
| `sw.js` | オフライン用 Service Worker（アプリ更新時は `VERSION` を上げる） |
| `manifest.webmanifest` | PWA 設定 |
| `icons/` | アプリアイコン |

## 注意

データはブラウザ内に保存されるため、ブラウザのデータ消去で消えます。
大事なファイルは「ダウンロード保存」や「共有」でバックアップしてください。
