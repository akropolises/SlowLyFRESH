// 展示用デモ動画の録画スクリプト。
// 台本のページ(stage.html / concept.html)を表示し、そのページ自身の画面をMediaRecorderで録画する(recorder.js)。
// 縦長版は、ディスプレイの高さが足りなくても録画できるよう、ページを90度回して横長のウィンドウに描き、書き出すときに戻す。
// 実行: npm run demo:record(操作デモ) / npm run demo:concept(体験前に見せるコンセプト動画)
//       npm run demo:concept-short(コンセプト動画の短い版)
//       npm run demo:concept:portrait / demo:concept-short:portrait(コンセプト動画の縦長版)
// 出力: out/demo/ の micro-slow-demo.mp4 / micro-slow-concept(-short)(-portrait).mp4
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, BrowserWindow, ipcMain, session } = require("electron");

const projectRoot = path.join(__dirname, "..", "..");
const argValue = (name) => {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
};

// ウィンドウは常に1280x720。1.5倍の密度で描画し、1920x1080(縦長版は1080x1920)で録画する
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;
const SCALE = 1.5;

// コンセプト動画は、縦置きのディスプレイ向けの縦長版(-portrait)も録画できる
const portrait = { orientation: "portrait", rotate: "1" };
const videos = {
  demo: { stage: "stage.html", out: "micro-slow-demo.mp4" },
  concept: { stage: "concept.html", out: "micro-slow-concept.mp4" },
  "concept-short": { stage: "concept.html", query: { variant: "short" }, out: "micro-slow-concept-short.mp4" },
  "concept-portrait": { stage: "concept.html", query: { ...portrait }, out: "micro-slow-concept-portrait.mp4" },
  "concept-short-portrait": {
    stage: "concept.html",
    query: { variant: "short", ...portrait },
    out: "micro-slow-concept-short-portrait.mp4",
  },
};
const video = videos[argValue("video") || "demo"];
if (!video) {
  throw new Error(`Unknown --video. Use one of: ${Object.keys(videos).join(", ")}`);
}
const outPath = argValue("out") || path.join(projectRoot, "out", "demo", video.out);
const snapDir = argValue("snaps");

app.commandLine.appendSwitch("force-device-scale-factor", String(SCALE));
// 実アプリのlocalStorageやOAuth tokenに触れないよう、録画専用の一時userDataを使う
const userDataDir = path.join(os.tmpdir(), "micro-slow-demo-recorder");
fs.rmSync(userDataDir, { recursive: true, force: true });
app.setPath("userData", userDataDir);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    useContentSize: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "demo-preload.js"),
      contextIsolation: false,
      sandbox: false,
      nodeIntegrationInSubFrames: true,
      backgroundThrottling: false,
    },
  });
  win.setContentSize(STAGE_WIDTH, STAGE_HEIGHT);
  win.center();

  // ステージ自身のフレームを録画対象にする(デスクトップ全体は映さない)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    callback({ video: request.frame });
  });

  ipcMain.handle("demo-save", (_event, bytes) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(bytes));
    console.log(`saved ${outPath} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`);
  });

  // スナップショットは確認用なので、縦長版も回したままの画面で保存する
  ipcMain.handle("demo-snap", async (_event, name) => {
    if (!snapDir) return;
    const image = await win.webContents.capturePage();
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, `${name}.png`), image.toPNG());
  });

  ipcMain.handle("demo-log", (_event, message) => {
    console.log(message);
  });

  ipcMain.handle("demo-done", () => {
    app.quit();
  });

  win.loadFile(path.join(__dirname, video.stage), { query: video.query || {} });
  win.webContents.once("did-finish-load", () => {
    // getDisplayMediaはユーザー操作を要求するため、ユーザー操作扱いで録画を始める
    win.webContents.executeJavaScript("window.startDemo()", true).catch((error) => {
      console.error(error);
      app.exit(1);
    });
  });
});
