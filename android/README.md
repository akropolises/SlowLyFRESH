# ゆっくリフレッシュ Android版

開発者のスマホに入れて使うための、最小限のAndroidアプリです。Play Storeでの公開は考えていません。

- アプリを起動すると、すぐにゆっくリフレッシュ(Micro Slow)が始まります。直近6回に出たものは避けて選びます
- 終わるか「ここまでにする」を押すと、色選択になります。色を選ぶと波紋が広がり、アプリが閉じます(色を選ばないまま60秒たったときも閉じます)
- 戻るボタンでも途中で閉じます。体験中は画面が消えず、通知バーなどは隠れます
- Googleカレンダー、予定、自動起動、ギャラリーはありません。選んだ色も保存しません

## しくみ

画面は `web/` のページをWebViewで出しているだけです。デスクトップ版と共通の `styles.css`、`micro-slows.js`、フォント(`assets/fonts/`)は、ビルドのたびにリポジトリのルートから写します。Micro Slowの内容や見た目をデスクトップ版で直せば、次のビルドでAndroid版にも入ります。

- `web/index.html`、`web/mobile.js`、`web/mobile.css`: スマホ版の画面と流れ(霧の進み方と色選択の演出は `app.js` と同じ)
- `app/src/main/java/jp/naelab/microslow/MainActivity.java`: WebViewを出し、ページから `MicroSlowAndroid.close()` が呼ばれたらアプリを閉じる

## ビルド(Windows)

1. 道具を入れる(初回だけ)。JDK 17、Android SDK、Gradleを `%LOCALAPPDATA%\MicroSlowAndroid` に入れます。管理者権限やAndroid Studioは要りません

   ```powershell
   powershell -ExecutionPolicy Bypass -File android\setup-tools.ps1
   ```

2. APKを作る

   ```powershell
   powershell -ExecutionPolicy Bypass -File android\build.ps1
   ```

   できたAPKは `android\app\build\outputs\apk\debug\app-debug.apk` です。スマホがUSBでつながっていれば、そのままインストールします。

デバッグ用の署名(このPCの `%USERPROFILE%\.android\debug.keystore`)で作ります。上書きインストールは同じPCで作ったAPKどうしでしかできません。別のPCで作ったAPKを入れるときは、先にスマホからアンインストールしてください。

リポジトリのフォルダ名に日本語が入っているため、`gradle.properties` で `android.overridePathCheck=true` にしています。

## スマホに入れる

### USBでつなぐ(おすすめ)

1. スマホの「設定」→「デバイス情報」で「ビルド番号」を7回タップし、開発者向けオプションを出す
2. 「設定」→「システム」→「開発者向けオプション」で「USBデバッグ」をオンにする
3. USBでPCにつなぎ、スマホに出る「USBデバッグを許可しますか」で許可する
4. `android\build.ps1` を実行する(作り直して入れ直すときも同じ)

### ファイルを送る

`app-debug.apk` をGoogleドライブなどでスマホに送り、スマホで開いてインストールします。初回だけ「この提供元のアプリを許可」の確認が出ます。
