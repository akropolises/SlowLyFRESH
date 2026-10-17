# Micro Slow

Micro Slowは、予定前の短い余白に短いSlowness体験を差し込むElectronデスクトップアプリのプロトタイプです。

「遅くなれ」と促すのではなく、次の予定を妨げない範囲で、最大60秒の感覚体験を提案します。

## Quick Start

```powershell
npm install
npm run electron
```

Electron版では、アプリがバックグラウンドに常駐し、予定5分前の開始時刻にウィンドウを全画面表示してMicro Slowを開始します。

## Google Calendar連携

Google Calendar連携はElectron main processでOAuthを行います。外部ブラウザでGoogleログインを開き、localhostの一時callbackで認可コードを受け取ります。

Google Cloudでは、デスクトップアプリ用のOAuth Client IDを使います。共有用のClient IDは `config.js` に置きます。

```js
window.MICRO_SLOW_CONFIG = {
  googleClientId: "YOUR_DESKTOP_OAUTH_CLIENT_ID",
  upcomingWindowMinutes: 7,
};
```

旧バージョンの `SLOW_INDEX_CONFIG` も読み込み互換性のために残していますが、新規設定では `MICRO_SLOW_CONFIG` を使います。

カレンダーは、Google Calendar の CalendarList API で取得できる表示中のカレンダーを読み込みます。primary カレンダーだけでなく、Google Calendar上で表示対象になっている共有カレンダーも対象です。

読み込み対象を固定したい場合は、`config.local.js` でカレンダーIDを指定できます。

```js
window.MICRO_SLOW_CONFIG.googleCalendarIds = [
  "primary",
  "xxxxx@group.calendar.google.com",
];
```

古い単一指定の `googleCalendarId` も互換性のために使えます。

Google Cloudのデスクトップアプリ用OAuth Clientでtoken交換時に `client_secret is missing` が出る場合は、`config.local.js` にだけClient Secretを追加します。

```js
window.MICRO_SLOW_CONFIG.googleClientSecret = "YOUR_DESKTOP_OAUTH_CLIENT_SECRET";
```

Client SecretはGitにコミットしません。

現在の実装は読み取り専用です。予定の作成・編集は行わず、`calendar.readonly` スコープで当日の予定だけを読み込みます。OAuth tokenはElectronのuserDataディレクトリに保存され、プロジェクトフォルダには保存されません。

## 現在の実装

- 手入力予定、Google Calendar予定の表示
- primaryカレンダーと表示中の共有カレンダーの読み込み
- Google Calendar表示中の更新ボタンによる再同期
- Google Calendar起動直後と毎時00分の自動同期
- Google Calendar更新時の手入力予定保持
- 手入力予定の追加と削除
- 予定ごとの自動開始スキップ切り替え
- 予定5分前のMicro Slow提案
- 予定5分前の全画面表示とMicro Slow自動開始
- トレイ常駐
- ウィンドウを閉じても終了せず、非表示化
- 25種類のMicro Slow体験
- 直近に出たMicro Slowを避ける提案ロジック
- 数字カウントに依存しない円形の進行表示
- 開始前の最大所要時間表示
- 完了後の色入力と、選択色による記録ギャラリー
- 日付が変わった場合のキャンバス記録切り替え
- ギャラリーの月送り範囲を2026年1月から現在月までに制限
- 色入力後の自動非表示化

## ファイル構成

- `index.html`: 画面構造
- `styles.css`: UIスタイルとMicro Slow中の視覚表現
- `app.js`: renderer側の予定管理、提案生成、Micro Slow実行ロジック
- `electron-main.js`: Electron main process、常駐、最前面表示、Google OAuth、Calendar API読み込み
- `electron-preload.js`: Electron preload bridge
- `forge.config.js`: Electron ForgeのWindows zipビルド設定
- `scripts/make-with-local-config.js`: `config.local.js` を成果物にだけ含める検証用ビルドスクリプト
- `scripts/make-exhibition.js`: 展示用PCで動かす展示版のzipを `out/exhibition/` に作るビルドスクリプト
- `scripts/demo/`: 展示用デモ動画(操作デモ・コンセプト)の録画スクリプト
- `exhibition/`: 展示版(黒子の作業の途中に、本物のゆっくリフレッシュが差し込まれる)
- `assets/tray-icon.png`: Trayとウィンドウで使うアプリアイコン
- `assets/app-icon.ico`: Windowsビルド用アイコン
- `assets/fonts/`: ゆっくリフレッシュ中と色選択で使うZen Kaku Gothic New(SIL Open Font License、`OFL.txt` を同梱)
- `micro-slows.js`: アプリが読み込むMicro Slowデータ
- `config.js`: 共有用の既定設定
- `config.example.js`: 個人設定ファイルのひな形
- `CONTRIBUTING.md`: 複数人開発の手順
- `requirements.md`: 要件と実装状態
- `micro-slows.md`: Micro Slow一覧と編集方針

## 記録ギャラリー

Micro Slow完了後に選んだ色は、当日のキャンバスに1滴として保存されます。
記録はlocalStorageに保存され、アプリを再起動しても保持されます。
アプリを起動したまま日付をまたいだ場合も、次に色を選んだ時点で前日分を履歴へ移し、新しい日のキャンバスを始めます。

ギャラリーは2026年1月から現在月までを表示対象にします。

## 開発

構文チェックを実行します。

```powershell
npm run check
```

Windows向けのzip配布物を作る場合は、Electron Forgeを使います。

```powershell
npm run make
```

成果物は `out/make/zip/win32/x64/` に出力されます。`config.local.js` は配布物に含めません。Google OAuth Client Secretなしで動作確認する場合は、ローカルの `config.local.js` にSecretを書かずにビルドしてください。ただし、利用中のOAuth ClientがSecret必須の場合はGoogle Calendar読み込み時に `client_secret is missing` で失敗します。

Google OAuth Client Secretを配布物に含めて検証する場合は、`config.local.js` にSecretを書いたうえで次を実行します。

```powershell
npm run make:local
```

この場合も `config.local.js` はGitには入りません。packaging中にだけ成果物へコピーされます。

展示用の動画(いずれもMP4、1920x1080、24fps、無音、ループ再生向け)は `scripts/demo/` のスクリプトで録画します。録画中は約1分間、デモ用のウィンドウが最前面に表示されます。動画ではサンプルの予定と時計を使い、実アプリの記録やGoogle連携には触れません。

操作デモ(約57秒)は次で録画します。ゆっくリフレッシュ本体は5倍速で見せます。

```powershell
npm run demo:record
```

成果物は `out/demo/micro-slow-demo.mp4` に出力されます。

体験の前に見せるコンセプト動画(約72秒)は次で録画します。この動画だけで体験できるよう、Fastな毎日に「ちょうどよい遅さ」を届けるという考え方、Googleカレンダーと連携するデスクトップアプリであること、作業中でも予定5分前に全画面で自動開始すること、画面の一文にしたがって感覚を味わうこと、Enterキーですぐ終えられること、最後に色を選ぶこと、4分前には終わることを、ひとつずつゆっくり伝えます。

```powershell
npm run demo:concept
```

成果物は `out/demo/micro-slow-concept.mp4` に出力されます。

同じ内容を約42秒に詰めた短い版は次で録画します。「4分前には終わる」の場面を省き、色を選ぶ画面は一瞬映すだけにして、それ以外の体験に必要な説明は残しています。

```powershell
npm run demo:concept-short
```

成果物は `out/demo/micro-slow-concept-short.mp4` に出力されます。

展示会場では、展示版を使います。体験者が意味のない作業をしているうちに、トレイに常駐している本物のゆっくリフレッシュが差し込まれます。展示用PCで動かすzipは次で作り、`out/exhibition/` に出力されます。記録は普段のアプリと別の場所に保存されます。使い方、進行設定、作業の増やし方は `exhibition/README.md` を参照してください。

```powershell
npm run make:exhibition
```

開発中に展示版を動かすときは次のとおりです。

```powershell
npm run exhibit
```

複数人で開発する場合は、最初に `CONTRIBUTING.md` を確認してください。

## 配布ターゲット方針

現在の配布物はWindows向けzipのみです。

macOS向けのElectron配布物は、署名やnotarizationまで含めてmacOS上でビルドする方針です。Windows環境からのクロスビルドは当面の標準手順にしません。

Android版は、既存のHTML/CSS/JavaScript rendererを活かしやすいCapacitor版から着手します。Electron固有の `electron-main.js` / `electron-preload.js` はAndroidでは使えないため、Google認証、通知、ローカル保存、バックグラウンド起動相当の処理はCapacitor側の実装に置き換えます。

Android対応はElectronデスクトップ版とはブランチを分けて進めます。作業ブランチ名は `feature/android-capacitor` を基本とし、Windows配布物の保守やElectron固有の変更と混ぜないようにします。

## Secretの扱い

Google OAuth Client SecretはGitにコミットしません。ローカルでは `.gitignore` 済みの `config.local.js` にだけ置きます。

通常のWindows配布物を作る `npm run make` では、`config.local.js` は成果物に含めません。ローカル検証など、Secretを含めたbuildが必要な場合だけ `npm run make:local` を使います。この成果物にはSecretが入るため、公開配布、共有、アップロードには使いません。

Android版でも同じ方針を維持します。Secretや個人設定はGit管理対象にせず、Capacitor版で必要になる認証情報の注入方法はAndroidブランチ側のドキュメントに明記します。

## Micro Slowの考え方

このプロトタイプでは、Slownessを単なる遅さではなく、自己のリズムと周囲とのズレが少ない状態として扱います。

Micro Slowは、予定の前に短い感覚体験を置くことで、焦りや通知反応から一時的に離れ、現在の身体感覚へ戻るための入口です。

## まだやっていないこと

- Windows zip以外の配布形式
- コード署名、インストーラー
- OS起動時の自動起動設定UI
- 予定種別ごとのMicro Slow最適化
- 展示用モード
