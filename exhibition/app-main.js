// 展示版の入口。本物のゆっくリフレッシュ(electron-main.js、通常版のまま)をトレイに常駐させたうえで、展示の画面(main.js)を開く。
// 体験者が作業を始めると、展示の画面が本物のアプリに「次の予定」を渡し、アプリ自身が5分前に全画面で始める。
// 実行: npm run exhibit / npm run exhibit:windowed / 展示版のzip(npm run make:exhibition)の実行ファイル
const path = require("path");
const { app } = require("electron");

// このPCで普段使っているゆっくリフレッシュの記録やGoogleのログインと混ざらないよう、展示版は別の場所に保存する
app.setPath("userData", path.join(app.getPath("appData"), "micro-slow-exhibition"));

// 二重に起動すると、同じ保存場所を2つのアプリが同時に使ってしまうので、2つめはすぐ終える
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 本物のアプリが最初に作るウィンドウをつかまえておく。展示では起動時にウィンドウを出さず、トレイに常駐するだけにしたいので、
  // 最初に表示されたときだけ、見えないうちに隠す(ゆっくリフレッシュの開始時は、アプリ自身がまた表示する)
  let realWindow = null;
  app.once("browser-window-created", (_event, win) => {
    realWindow = win;
    win.setOpacity(0);
    win.once("show", () => {
      win.hide();
      win.setOpacity(1);
    });
  });

  require("../electron-main.js");
  require("./main.js").start({
    // 予定を渡す(nullで消す)。アプリは手入力の予定と同じように扱い、5分前に自動で始める
    setExhibitionEvent: (event) => realWindow?.webContents.send("exhibition-event", event),
    // 予定5分前の判定を満たしていれば、アプリの定期判定を待たずにすぐ始めさせる(通常版にもある口)
    triggerSlow: (eventId) => realWindow?.webContents.send("electron-start-slow", eventId),
  });
}
