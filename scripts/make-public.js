// 一般公開用のビルド。Google OAuth Client Secretは環境変数 MICRO_SLOW_GOOGLE_CLIENT_SECRET から受け取り、
// 成果物の中にだけ書き込む(Gitや個人のconfig.local.jsには依存しない)
const { spawnSync } = require("child_process");

if (!process.env.MICRO_SLOW_GOOGLE_CLIENT_SECRET) {
  console.error("MICRO_SLOW_GOOGLE_CLIENT_SECRET is not set. Set it to the desktop OAuth client secret before running npm run make:public.");
  process.exit(1);
}

const env = { ...process.env };
delete env.MICRO_SLOW_INCLUDE_LOCAL_CONFIG;
delete env.SLOW_INDEX_INCLUDE_LOCAL_CONFIG;

const result = spawnSync("npm", ["run", "make"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});

process.exit(result.status ?? 1);
