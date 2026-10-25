// 展示の画面。体験者には実際のアプリ(Gmailなど)で作業してもらい、その途中に本物のゆっくリフレッシュが差し込まれる。
// 単体では起動せず、app-main.js から本物のアプリ(electron-main.js)と一緒に起動する。
// 引数: --task=<id>(黒子の作業モードで作業を固定して開始画面を飛ばす) --windowed(開発用のウィンドウ表示)
// スタッフ用キー(どのアプリが前にあっても効く): Ctrl+Alt+Shift+R 開始画面へ戻る / Ctrl+Alt+Shift+S すぐ差し込む / Ctrl+Alt+Shift+P スタッフ設定 /
//   Ctrl+Alt+Shift+T 次の回の作業を切り替える(実際のアプリ → 黒子の作業 …) / Ctrl+Alt+Shift+Q 終了
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { app, BrowserWindow, globalShortcut, ipcMain, powerSaveBlocker, screen, shell } = require("electron");
const { GmailDemo } = require("./mail/gmail-demo");
const { StaffSettings } = require("./staff-settings");

const argValue = (name) => {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
};
const windowed = process.argv.includes("--windowed");

// 体験者がChromeなどを使っている間も効くよう、システム全体のショートカットにする。
// Ctrl+Shift+T(閉じたタブを開く)などブラウザのキーと重ならないよう、Altも足す
const staffCommands = {
  R: "reset",
  S: "trigger",
  T: "next-task",
  P: "settings",
};
// 小さな表示(次の予定)を置く位置。タスクバーのすぐ上、画面の左下から少し離す
const WIDGET_MARGIN = 16;

// 画面用の設定ファイル(window.XXX = {...} の形)を、main process でも読む。ないファイルは飛ばす
function readWindowConfig(files) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  files.forEach((file) => {
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  });
  return sandbox.window;
}

// 本物のアプリの設定(config.js / config.local.js)と、展示の設定(exhibition/config.js)
function readConfigs() {
  const root = path.join(__dirname, "..");
  return readWindowConfig([path.join(root, "config.js"), path.join(root, "config.local.js"), path.join(__dirname, "config.js")]);
}

// 展示用Gmailへのメール。Googleのログイン情報は本物のアプリと同じ設定を使い、ログイン自体は別に持つ
function createGmailDemo(configs) {
  const settings = configs.EXHIBITION_CONFIG?.gmailDemo;
  const google = configs.MICRO_SLOW_CONFIG || {};
  if (!settings?.enabled || !google.googleClientId) return null;
  return new GmailDemo({
    userDataDir: app.getPath("userData"),
    clientId: google.googleClientId,
    clientSecret: google.googleClientSecret,
    settings,
    openExternal: (url) => shell.openExternal(url),
  });
}

function start(realApp) {
  app.whenReady().then(async () => {
    // 展示中に画面が消えないようにする
    powerSaveBlocker.start("prevent-display-sleep");

    // 展示用Gmailにまだログインしていなければ、全画面になる前にブラウザでログインしてもらう(スタッフが一度だけ)。
    // ログインしなければ、メールなしで展示を始める
    const configs = readConfigs();
    const gmailDemo = createGmailDemo(configs);
    // スタッフ設定パネルで変えられる値(ゆっくリフレッシュの最短開始、メールの通数)
    const staffSettings = new StaffSettings(app.getPath("userData"), configs.EXHIBITION_CONFIG);
    if (gmailDemo && !gmailDemo.hasLogin()) {
      try {
        await gmailDemo.login();
      } catch (error) {
        console.error("展示用Gmailにログインできませんでした:", error.message);
      }
    }

    const win = new BrowserWindow({
      width: 1600,
      height: 900,
      kiosk: !windowed,
      fullscreen: !windowed,
      // 体験中の小さな表示を角丸にするため、ウィンドウ自体は透明にして中身で形を描く
      frame: windowed,
      transparent: !windowed,
      backgroundColor: windowed ? "#f6f4ef" : "#00000000",
      autoHideMenuBar: true,
      title: "ゆっくリフレッシュ 体験",
      icon: path.join(__dirname, "..", "assets", "tray-icon.png"),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win.setMenu(null);
    // 起動直後は、隠した本物のアプリのウィンドウに前を取られることがあるので、開始画面に前を戻す
    win.webContents.once("did-finish-load", () => {
      win.focus();
      setTimeout(() => !win.isDestroyed() && win.focus(), 800);
    });

    // 小さな表示のあいだは最前面に置き続ける(体験者のアプリの裏に隠れないように)。
    // ただし、ゆっくリフレッシュの全画面(本物のアプリのウィンドウ)が出ているあいだは、こちらから最前面をかけ直さない。
    // Windows では最前面のウィンドウどうしは、あとからかけたほうが前に来るので、かけ直すとゆっくリフレッシュの上に一瞬出てしまう(ちらつき)
    let widgetMode = false;
    let refreshShowing = false;
    const raiseWidget = () => {
      if (!win.isDestroyed() && widgetMode && !refreshShowing) win.setAlwaysOnTop(true, "floating");
    };
    const realWindow = realApp.window();
    realWindow?.on("show", () => {
      refreshShowing = true;
    });
    realWindow?.on("hide", () => {
      refreshShowing = false;
      raiseWidget();
    });
    let keepOnTopTimer = null;
    const keepOnTop = (enabled) => {
      widgetMode = enabled;
      clearInterval(keepOnTopTimer);
      if (!enabled) return;
      raiseWidget();
      // ほかのアプリの操作で最前面が外れたときのために、ときどき確かめる(ゆっくリフレッシュ中は何もしない)
      keepOnTopTimer = setInterval(() => {
        if (!refreshShowing && !win.isDestroyed() && !win.isAlwaysOnTop()) raiseWidget();
      }, 1000);
    };

    // 開始画面と終わりの画面は全画面(キオスク)。
    // 体験中("widget")は、画面の左下に小さな表示だけを残し、うしろのデスクトップや体験者のアプリがそのまま見えるようにする。
    // 黒子の作業モード("window")では、タスクバーの上いっぱいのウィンドウにする。開発用の --windowed では切り替えない
    let currentMode = "full";
    ipcMain.handle("exhibit-window-mode", (_event, { mode, width, height, position = "left" } = {}) => {
      if (windowed) return;
      const previousMode = currentMode;
      currentMode = mode;
      if (mode === "full") {
        keepOnTop(false);
        win.setAlwaysOnTop(false);
        win.setSkipTaskbar(false);
        win.setResizable(true);
        win.setKiosk(true);
        win.focus();
        return;
      }
      if (mode === "window") {
        win.setKiosk(false);
        win.maximize();
        return;
      }
      // 次の予定は画面の左下、リマインド(「向かう」)は画面下の中央に置く。
      // ゆっくリフレッシュ中にリマインドへ切り替えるときも、位置と大きさを変えるだけで、前後関係やウィンドウの性質には触れない
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      if (previousMode !== "widget") {
        win.setKiosk(false);
        win.setSkipTaskbar(true);
      }
      win.setBounds({
        x: position === "center" ? area.x + Math.round((area.width - width) / 2) : area.x + WIDGET_MARGIN,
        y: area.y + area.height - height - WIDGET_MARGIN,
        width,
        height,
      });
      if (previousMode !== "widget") {
        win.setResizable(false);
        keepOnTop(true);
      }
    });

    // 小さな表示になったら、体験者がうしろのアプリをすぐ使えるよう前を譲る
    ipcMain.handle("exhibit-release-focus", () => {
      if (!windowed) win.blur();
    });

    // 本物のアプリとのやりとりは、予定を渡すこととすぐ始めさせることだけ。始まりと終わりは時刻から決める(shell.js)
    ipcMain.handle("exhibit-set-meeting", (_event, meeting) => realApp.setExhibitionEvent(meeting));
    ipcMain.handle("exhibit-trigger-slow", (_event, eventId) => realApp.triggerSlow(eventId));

    // 次の体験者のための展示用Gmailの準備(初期化・最初の未読・未読に戻す)。「はじめる」で遅れないよう、体験の終わりに行う
    const prepareOptions = () => ({
      initialCount: staffSettings.values.gmailInitialCount,
      clearInbox: staffSettings.values.gmailClearInbox,
      markRecentUnread: staffSettings.values.gmailMarkRecentUnread,
      recentUnreadCount: configs.EXHIBITION_CONFIG.gmailDemo.recentUnreadCount,
    });
    // 初めて使うときや、前の体験のあと準備する前に終了していたときは、ここで準備しておく
    gmailDemo?.prepareIfNeeded(prepareOptions());

    ipcMain.handle("exhibit-settings-get", () => staffSettings.describe());
    // パネルで変えた準備の値は、次に体験が終わったときの準備から使う
    ipcMain.handle("exhibit-settings-set", (_event, values) => staffSettings.update(values));

    // 体験中に、展示用のGmailへメールを届ける。メールが止まるのは、ゆっくリフレッシュがいちばん遅く始まる時刻(最短開始+60秒)の少しあと。
    // 体験が終わったら(stop)、次の体験者のための準備をする
    ipcMain.handle("exhibit-mail", (_event, { action }) => {
      if (!gmailDemo) return { ok: false, error: "not configured" };
      if (action === "start") {
        const { minLeadSeconds, gmailMailsPerMinute } = staffSettings.values;
        gmailDemo.start({
          mailsPerMinute: gmailMailsPerMinute,
          streamSeconds: minLeadSeconds + 60 + configs.EXHIBITION_CONFIG.gmailDemo.stopAfterLatestStartSeconds,
        });
      }
      if (action === "stop") {
        gmailDemo.stop();
        gmailDemo.prepareNext(prepareOptions());
      }
      return { ok: true };
    });
    ipcMain.handle("exhibit-mail-status", () => (gmailDemo ? { enabled: true, ...gmailDemo.status() } : { enabled: false }));
    app.on("before-quit", () => gmailDemo?.stop());
    Object.entries(staffCommands).forEach(([key, command]) => {
      globalShortcut.register(`Control+Alt+Shift+${key}`, () => {
        if (!win.isDestroyed()) win.webContents.send("exhibit-command", command);
      });
    });
    globalShortcut.register("Control+Alt+Shift+Q", () => {
      app.isQuitting = true;
      app.quit();
    });
    app.on("will-quit", () => globalShortcut.unregisterAll());

    // もう一度起動しようとしたら、新しく開かずに展示の画面を前に出す
    app.on("second-instance", () => {
      if (!win.isDestroyed()) win.focus();
    });

    const query = {};
    if (argValue("task")) query.task = argValue("task");

    win.loadFile(path.join(__dirname, "shell", "index.html"), { query });
  });
}

module.exports = { start };
