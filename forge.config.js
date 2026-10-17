const fs = require("fs");
const path = require("path");

// 展示版(npm run make:exhibition)は、本物のアプリと展示の画面を一緒に入れ、入口を exhibition/app-main.js にする。
// 普段のアプリの成果物と混ざらないよう、出力先も out/exhibition に分ける
const exhibitionBuild = process.env.MICRO_SLOW_EXHIBITION_BUILD === "1";
const appName = exhibitionBuild ? "ゆっくリフレッシュ展示版" : "ゆっくリフレッシュ";

module.exports = {
  ...(exhibitionBuild ? { outDir: "out/exhibition" } : {}),
  packagerConfig: {
    name: appName,
    executableName: appName,
    ...(process.platform === "win32" ? { icon: "assets/app-icon.ico" } : {}),
    ...(process.platform === "darwin" ? { icon: "assets/app-icon.icns" } : {}),
    ignore: [
      "^/config\\.local\\.js$",
      "^/forge\\.config\\.js$",
      "^/scripts($|/)",
      ...(exhibitionBuild ? [] : ["^/exhibition($|/)"]),
      "^/out($|/)",
      "\\.bat$",
      "^/\\.git($|/)",
      "^/SlowTechApp($|/)",
    ],
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      if (exhibitionBuild) {
        const packageJsonPath = path.join(buildPath, "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        packageJson.main = "exhibition/app-main.js";
        fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
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
