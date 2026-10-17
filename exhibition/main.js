// 展示の画面。体験者に黒子の作業をしてもらい、その途中に本物のゆっくリフレッシュが差し込まれる。
// 単体では起動せず、app-main.js から本物のアプリ(electron-main.js)と一緒に起動する。
// 引数: --task=<id>(作業を固定して開始画面を飛ばす) --windowed(開発用のウィンドウ表示)
// スタッフ用キー: Ctrl+Shift+R 開始画面へ戻る / Ctrl+Shift+S すぐ差し込む / Ctrl+Shift+T 次の回の作業を切り替える / Ctrl+Shift+Q 終了
const path = require("path");
const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require("electron");

const argValue = (name) => {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
};
const windowed = process.argv.includes("--windowed");


const staffCommands = {
  r: "reset",
  s: "trigger",
  t: "next-task",
};

function start(realApp) {
  app.whenReady().then(() => {
    // 展示中に画面が消えないようにする
    powerSaveBlocker.start("prevent-display-sleep");

    const win = new BrowserWindow({
      width: 1600,
      height: 900,
      kiosk: !windowed,
      fullscreen: !windowed,
      // 作業中のウィンドウは作業画面が自前のタイトルバーを持つので、Windowsの枠は付けない(閉じる・動かすを防ぐ)
      frame: windowed,
      autoHideMenuBar: true,
      title: "ゆっくリフレッシュ 体験",
      icon: path.join(__dirname, "..", "assets", "tray-icon.png"),
      backgroundColor: "#f6f4ef",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win.setMenu(null);

    // 開始画面と終わりの画面は全画面(キオスク)、作業中はタスクバーの上いっぱいのウィンドウにする。
    // 作業中はWindowsのタスクバー(と時計)だけが見える。開発用の --windowed では切り替えない
    ipcMain.handle("exhibit-window-mode", (_event, mode) => {
      if (windowed) return;
      if (mode === "full") {
        win.setKiosk(true);
        return;
      }
      win.setKiosk(false);
      win.maximize();
    });

    // 本物のアプリとのやりとり。予定を渡す・すぐ始めさせる・全画面の始まりと終わりを受け取る
    ipcMain.handle("exhibit-set-meeting", (_event, meeting) => realApp.setExhibitionEvent(meeting));
    ipcMain.handle("exhibit-trigger-slow", (_event, eventId) => realApp.triggerSlow(eventId));
    realApp.onSlowModeChange((mode) => {
      if (win.isDestroyed()) return;
      win.webContents.send("exhibit-slow-mode", mode);
      // ゆっくリフレッシュのウィンドウが隠れたら、作業のウィンドウを前に戻す
      if (mode === "leave") win.focus();
    });

    // 作業のiframeの中でキーが押されても拾えるよう、webContents単位でスタッフ用キーを見る
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.control || !input.shift) return;
      const key = input.key.toLowerCase();
      if (key === "q") {
        event.preventDefault();
        app.isQuitting = true;
        app.quit();
        return;
      }
      if (staffCommands[key]) {
        event.preventDefault();
        win.webContents.send("exhibit-command", staffCommands[key]);
      }
    });

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
