// 振り返りキャンバスの記録と、ゆっくリフレッシュ中の呼吸円をSVGに書き出す。Illustratorで開いて編集・.ai保存できる。
// 実行: npm run export:artwork
//   --user-data=<フォルダ>  アプリの記録フォルダ(省略時は %APPDATA%/micro-slow などを探す)
//   --input=<JSON>         記録の代わりにJSONファイルを読む(localStorageの micro-slow-artwork と同じ形)
//   --out=<フォルダ>        書き出し先(省略時は out/artwork)
// 出力: <out>/breath-circle.svg
//       <out>/<日付>/canvas.svg(その日のキャンバス全体)と drop-01-green.svg …(1滴ずつ)
// 記録はアプリのフォルダから一時フォルダに複製してから読むので、アプリの記録を書き換えることはない。
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, BrowserWindow } = require("electron");
const { inkBlotLayers } = require("../artwork-shapes.js");

const projectRoot = path.join(__dirname, "..");
const argValue = (name) => {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
};
const outDir = path.resolve(argValue("out") || path.join(projectRoot, "out", "artwork"));
const inputPath = argValue("input");

// アプリのキャンバスは360px四方を基準にしている(drop.size もこの大きさでの直径)
const CANVAS_SIZE = 360;
const ARTWORK_KEY = "micro-slow-artwork";

const round = (value) => Number(value.toFixed(3));

function svgDocument({ width, height, viewBox, body, title }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="${viewBox}">
  <title>${title}</title>
${body}
</svg>
`;
}

function blotCircles(drop, indent) {
  return inkBlotLayers(drop, CANVAS_SIZE)
    .map(
      (layer) =>
        `${indent}<circle cx="${round(layer.cx)}" cy="${round(layer.cy)}" r="${round(layer.r)}" fill="${layer.color}" fill-opacity="${round(layer.opacity)}"/>`
    )
    .join("\n");
}

// その日のキャンバス全体。アプリと同じく360px四方で切り取り、1滴ずつグループに分ける
function canvasSvg(dateKey, drops) {
  const groups = drops
    .map((drop, index) => `    <g id="${dropName(drop, index)}">\n${blotCircles(drop, "      ")}\n    </g>`)
    .join("\n");
  const body = `  <defs>
    <clipPath id="canvas-clip"><rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}"/></clipPath>
  </defs>
  <g clip-path="url(#canvas-clip)">
${groups}
  </g>`;
  return svgDocument({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    viewBox: `0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`,
    body,
    title: `ゆっくリフレッシュ ${dateKey}`,
  });
}

// 1滴だけ。にじみ全体がちょうど収まる大きさで書き出す(キャンバスの端で切れていた部分も含める)
function dropSvg(dateKey, drop, index) {
  const layers = inkBlotLayers(drop, CANVAS_SIZE);
  const margin = 2;
  const left = Math.min(...layers.map((layer) => layer.cx - layer.r)) - margin;
  const top = Math.min(...layers.map((layer) => layer.cy - layer.r)) - margin;
  const right = Math.max(...layers.map((layer) => layer.cx + layer.r)) + margin;
  const bottom = Math.max(...layers.map((layer) => layer.cy + layer.r)) + margin;
  return svgDocument({
    width: right - left,
    height: bottom - top,
    viewBox: `${round(left)} ${round(top)} ${round(right - left)} ${round(bottom - top)}`,
    body: `  <g id="${dropName(drop, index)}">\n${blotCircles(drop, "    ")}\n  </g>`,
    title: `ゆっくリフレッシュ ${dateKey} ${index + 1}滴目`,
  });
}

function dropName(drop, index) {
  return `drop-${String(index + 1).padStart(2, "0")}-${drop.color}`;
}

// 呼吸円。styles.css の .breath-circle(放射グラデーション3枚の重ね)を、呼吸がいちばん大きく濃いときの形で描く。
// CSSのradial-gradientは要素の箱の最も遠い角までを100%とするので、同じ半径にそろえている
function breathCircleSvg() {
  const size = 200;
  const half = size / 2;
  const farthest = (x, y) => Math.hypot(Math.max(x, size - x), Math.max(y, size - y));
  const gradients = [
    // 下から順に重ねる(CSSでは最後に書いたものがいちばん下)
    {
      id: "breath-base",
      cx: half,
      cy: half,
      stops: [
        [0, "#efc66b", 0.36],
        [1, "#d98b77", 0.18],
      ],
    },
    {
      id: "breath-green",
      cx: size * 0.55,
      cy: size * 0.58,
      stops: [
        [0, "#2e6f65", 0.24],
        [0.58, "#2e6f65", 0],
      ],
    },
    {
      id: "breath-highlight",
      cx: size * 0.4,
      cy: size * 0.35,
      stops: [
        [0, "#ffffff", 0.95],
        [0.35, "#ffffff", 0],
      ],
    },
  ];
  const defs = gradients
    .map(
      (gradient) =>
        `    <radialGradient id="${gradient.id}" gradientUnits="userSpaceOnUse" cx="${round(gradient.cx)}" cy="${round(gradient.cy)}" r="${round(farthest(gradient.cx, gradient.cy))}">\n` +
        gradient.stops
          .map(([offset, color, opacity]) => `      <stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`)
          .join("\n") +
        "\n    </radialGradient>"
    )
    .join("\n");
  const circles = gradients
    .map((gradient) => `    <circle cx="${half}" cy="${half}" r="${half}" fill="url(#${gradient.id})"/>`)
    .join("\n");
  return svgDocument({
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    body: `  <defs>\n${defs}\n  </defs>\n  <g id="breath-circle">\n${circles}\n  </g>`,
    title: "ゆっくリフレッシュ 呼吸円",
  });
}

// localStorageの記録は {date, todayDrops, history} の形。当日分も含めて日付ごとの滴にまとめる
function dropsByDate(artwork) {
  const days = { ...(artwork.history || {}) };
  if (artwork.date && Array.isArray(artwork.todayDrops) && artwork.todayDrops.length > 0) {
    days[artwork.date] = artwork.todayDrops;
  }
  return Object.fromEntries(Object.entries(days).filter(([, drops]) => Array.isArray(drops) && drops.length > 0).sort());
}

function findUserData() {
  const given = argValue("user-data");
  if (given) return path.resolve(given);
  // npm run electron と配布版(Electron Forge)のどちらで動かした記録も探す
  const candidates = ["micro-slow", "ゆっくリフレッシュ"].map((name) => path.join(app.getPath("appData"), name));
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, "Local Storage")));
  if (!found) {
    throw new Error(`アプリの記録が見つかりませんでした。--user-data=<フォルダ> で指定してください。\n探した場所: ${candidates.join(", ")}`);
  }
  return found;
}

// アプリと同じ file:// のページからlocalStorageを読む。記録は一時フォルダの複製から読む
async function readArtworkFromApp(userData) {
  const page = path.join(app.getPath("userData"), "read-artwork.html");
  fs.writeFileSync(page, "<!doctype html><title>read</title>");
  const win = new BrowserWindow({ show: false });
  await win.loadFile(page);
  const raw = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(ARTWORK_KEY)})`);
  win.destroy();
  if (!raw) {
    throw new Error(`${userData} に振り返りキャンバスの記録がありませんでした。`);
  }
  return JSON.parse(raw);
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

let sourceUserData = null;
if (!inputPath) {
  // userDataはapp準備完了前に決める必要があるため、記録フォルダを探すのもここで行う。
  // ここで投げたエラーはElectronのエラーダイアログになって止まってしまうため、表示して終わる
  try {
    sourceUserData = findUserData();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "micro-slow-export-"));
    fs.cpSync(path.join(sourceUserData, "Local Storage"), path.join(workDir, "Local Storage"), { recursive: true });
    app.setPath("userData", workDir);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

app.whenReady().then(async () => {
  try {
    const artwork = inputPath
      ? JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"))
      : await readArtworkFromApp(sourceUserData);
    console.log(`記録: ${inputPath ? path.resolve(inputPath) : sourceUserData}`);

    writeFile(path.join(outDir, "breath-circle.svg"), breathCircleSvg());
    const days = dropsByDate(artwork);
    Object.entries(days).forEach(([dateKey, drops]) => {
      writeFile(path.join(outDir, dateKey, "canvas.svg"), canvasSvg(dateKey, drops));
      drops.forEach((drop, index) => {
        writeFile(path.join(outDir, dateKey, `${dropName(drop, index)}.svg`), dropSvg(dateKey, drop, index));
      });
    });
    const dropCount = Object.values(days).reduce((sum, drops) => sum + drops.length, 0);
    console.log(`書き出し: ${outDir}(呼吸円1つ、${Object.keys(days).length}日分のキャンバス、${dropCount}滴)`);
    process.exitCode = 0;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
  app.quit();
});

// 一時フォルダの複製は、Electronが閉じてファイルを手放してから消す
app.on("will-quit", () => {
  if (!sourceUserData) return;
  try {
    fs.rmSync(app.getPath("userData"), { recursive: true, force: true });
  } catch {
    // 消せなくても一時フォルダなので害はない
  }
});
