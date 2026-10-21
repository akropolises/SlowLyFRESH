// 展示の画面。体験者には実際のアプリ(Gmailなど)で作業してもらい、その途中に本物のゆっくリフレッシュが差し込まれる。
// 単体では起動せず、app-main.js から本物のアプリ(electron-main.js)と一緒に起動する。
// 引数: --task=<id>(黒子の作業モードで作業を固定して開始画面を飛ばす) --windowed(開発用のウィンドウ表示)
// スタッフ用キー(どのアプリが前にあっても効く): Ctrl+Alt+Shift+R 開始画面へ戻る / Ctrl+Alt+Shift+S すぐ差し込む /
//   Ctrl+Alt+Shift+T 次の回の黒子の作業を切り替える / Ctrl+Alt+Shift+Q 終了
const path = require("path");
const { app, BrowserWindow, globalShortcut, ipcMain, powerSaveBlocker, screen } = require("electron");

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
};
// 小さな表示(次の予定)を置く位置。タスクバーのすぐ上、画面の左下から少し離す
const WIDGET_MARGIN = 16;

function start(realApp) {
  app.whenReady().then(() => {
    // 展示中に画面が消えないようにする
    powerSaveBlocker.start("prevent-display-sleep");

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

    // 小さな表示のあいだは最前面に置き続ける。ゆっくリフレッシュの全画面(こちらも最前面)が出入りすると外れることがあるので、ときどきかけ直す
    let keepOnTopTimer = null;
    const keepOnTop = (enabled) => {
      clearInterval(keepOnTopTimer);
      if (!enabled) return;
      win.setAlwaysOnTop(true, "floating");
      keepOnTopTimer = setInterval(() => {
        if (!win.isDestroyed() && !win.isKiosk() && !win.isAlwaysOnTop()) win.setAlwaysOnTop(true, "floating");
      }, 1000);
    };

    // 開始画面と終わりの画面は全画面(キオスク)。
    // 体験中("widget")は、画面の左下に小さな表示だけを残し、うしろのデスクトップや体験者のアプリがそのまま見えるようにする。
    // 黒子の作業モード("window")では、タスクバーの上いっぱいのウィンドウにする。開発用の --windowed では切り替えない
    ipcMain.handle("exhibit-window-mode", (_event, { mode, width, height, position = "left" } = {}) => {
      if (windowed) return;
      if (mode === "full") {
        keepOnTop(false);
        win.setAlwaysOnTop(false);
        win.setSkipTaskbar(false);
        win.setResizable(true);
        win.setKiosk(true);
        win.focus();
        return;
      }
      win.setKiosk(false);
      if (mode === "window") {
        win.maximize();
        return;
      }
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      win.setResizable(true);
      // 次の予定は画面の左下、リマインド(「向かう」)は画面下の中央に置く
      win.setBounds({
        x: position === "center" ? area.x + Math.round((area.width - width) / 2) : area.x + WIDGET_MARGIN,
        y: area.y + area.height - height - WIDGET_MARGIN,
        width,
        height,
      });
      win.setResizable(false);
      win.setSkipTaskbar(true);
      keepOnTop(true);
    });

    // 小さな表示になったら、体験者がうしろのアプリをすぐ使えるよう前を譲る
    ipcMain.handle("exhibit-release-focus", () => {
      if (!windowed) win.blur();
    });

    // 本物のアプリとのやりとりは、予定を渡すこととすぐ始めさせることだけ。始まりと終わりは時刻から決める(shell.js)
    ipcMain.handle("exhibit-set-meeting", (_event, meeting) => realApp.setExhibitionEvent(meeting));
    ipcMain.handle("exhibit-trigger-slow", (_event, eventId) => realApp.triggerSlow(eventId));

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
