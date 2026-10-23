// スタッフ設定パネル(開始画面で Ctrl+Alt+Shift+P)で変えられる値。初期値は config.js、変えた値は展示版の保存場所に残る。
const fs = require("fs");
const path = require("path");

// 変えられる値と、その範囲。default は config.js(EXHIBITION_CONFIG)から取る。
// ゆっくリフレッシュの開始だけはどの作業でも共通で、メールの値は「実際のアプリ」(展示用Gmail)と「受信トレイ」で別々
const FIELDS = {
  // ゆっくリフレッシュが始まるのは「はじめる」から この秒数〜この秒数+60秒 のあいだ
  minLeadSeconds: { min: 20, max: 120, step: 10, default: (config) => config.minLeadSeconds },
  // 実際のアプリ: 「はじめる」の直後に展示用Gmailへ入れる未読メールの通数と、体験中に届く通数(1分あたり。0なら届かない)
  gmailInitialCount: { min: 0, max: 50, step: 1, default: (config) => config.gmailDemo.initialCount },
  gmailMailsPerMinute: { min: 0, max: 30, step: 1, default: (config) => config.gmailDemo.mailsPerMinute },
  // 受信トレイ: 最初の未読メールの通数と、体験中に届く通数(1分あたり。0なら届かない)
  inboxInitialCount: { min: 0, max: 50, step: 1, default: (config) => config.inboxTask.initialCount },
  inboxMailsPerMinute: { min: 0, max: 30, step: 1, default: (config) => config.inboxTask.mailsPerMinute },
};
// 以前の名前で保存された値(実際のアプリと受信トレイで共通だったころ)は、実際のアプリの値として引き継ぐ
const LEGACY_NAMES = { initialCount: "gmailInitialCount", mailsPerMinute: "gmailMailsPerMinute" };

const clamp = (value, { min, max, step }) => Math.min(max, Math.max(min, Math.round((Number(value) - min) / step) * step + min));

class StaffSettings {
  constructor(userDataDir, config) {
    this.file = path.join(userDataDir, "exhibition-settings.json");
    this.defaults = Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, field.default(config)]));
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      // まだ変えたことがなければ初期値のまま
    }
    Object.entries(LEGACY_NAMES).forEach(([oldName, newName]) => {
      if (oldName in saved && !(newName in saved)) saved[newName] = saved[oldName];
    });
    this.values = this.normalize({ ...this.defaults, ...saved });
  }

  normalize(values) {
    return Object.fromEntries(
      Object.entries(FIELDS).map(([key, field]) => {
        const value = Number(values[key]);
        return [key, Number.isFinite(value) ? clamp(value, field) : this.defaults[key]];
      })
    );
  }

  describe() {
    const fields = Object.fromEntries(Object.entries(FIELDS).map(([key, { min, max, step }]) => [key, { min, max, step }]));
    return { values: this.values, defaults: this.defaults, fields };
  }

  // values が null なら初期値に戻す
  update(values) {
    this.values = values ? this.normalize({ ...this.values, ...values }) : { ...this.defaults };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (values) fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    else if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    return this.describe();
  }
}

module.exports = { StaffSettings };
