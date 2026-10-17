// 展示版の入口。本物のゆっくリフレッシュ(electron-main.js)をトレイに常駐させたうえで、展示の画面(main.js)を開く。
// 体験者が作業を始めると、展示の画面が本物のアプリに「次の予定」を渡し、アプリ自身が5分前に全画面で始める。
// 実行: npm run exhibit / npm run exhibit:windowed / 展示版のzip(npm run make:exhibition)の実行ファイル
const path = require("path");
const { app } = require("electron");

process.env.MICRO_SLOW_EXHIBITION = "1";
// このPCで普段使っているゆっくリフレッシュの記録やGoogleのログインと混ざらないよう、展示版は別の場所に保存する
app.setPath("userData", path.join(app.getPath("appData"), "micro-slow-exhibition"));

// 二重に起動すると、同じ保存場所を2つのアプリが同時に使ってしまうので、2つめはすぐ終える
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const realApp = require("../electron-main.js");
  require("./main.js").start(realApp);
}
