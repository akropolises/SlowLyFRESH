// 展示用PCで動かす展示版のzipを作る。出力先は out/exhibition/make/zip/。
// 展示用PCでもGoogleカレンダーを読めるよう、config.local.js(Client Secret)も成果物に含める。
const { spawnSync } = require("child_process");

const result = spawnSync("npm", ["run", "make"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    MICRO_SLOW_EXHIBITION_BUILD: "1",
    MICRO_SLOW_INCLUDE_LOCAL_CONFIG: "1",
  },
});

process.exit(result.status ?? 1);
