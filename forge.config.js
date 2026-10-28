const fs = require("fs");
const path = require("path");

module.exports = {
  packagerConfig: {
    name: "ゆっくリフレッシュ",
    executableName: "ゆっくリフレッシュ",
    ...(process.platform === "win32" ? { icon: "assets/app-icon.ico" } : {}),
    ...(process.platform === "darwin" ? { icon: "assets/app-icon.icns" } : {}),
    ignore: [
      "^/config\\.local\\.js$",
      "^/forge\\.config\\.js$",
      "^/scripts($|/)",
      "^/out($|/)",
      "^/\\.git($|/)",
      "^/SlowTechApp($|/)",
      "^/docs($|/)",
    ],
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      // 公開配布用(npm run make:public)。個人のconfig.local.jsは使わず、環境変数のClient Secretだけを成果物に書き込む
      const releaseSecret = process.env.MICRO_SLOW_GOOGLE_CLIENT_SECRET;
      if (releaseSecret) {
        fs.writeFileSync(
          path.join(buildPath, "config.local.js"),
          `window.MICRO_SLOW_CONFIG.googleClientSecret = ${JSON.stringify(releaseSecret)};\n`
        );
        return;
      }

      if (
        process.env.MICRO_SLOW_INCLUDE_LOCAL_CONFIG !== "1" &&
        process.env.SLOW_INDEX_INCLUDE_LOCAL_CONFIG !== "1"
      ) {
        return;
      }

      const source = path.join(__dirname, "config.local.js");
      if (!fs.existsSync(source)) {
        throw new Error("config.local.js was not found. Create it before running npm run make:local.");
      }

      fs.copyFileSync(source, path.join(buildPath, "config.local.js"));
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32", "darwin"],
    },
  ],
};
