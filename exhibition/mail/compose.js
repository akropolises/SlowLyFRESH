// 届けるメールを選び、1通のメール(RFC 2822)の形にする。
const crypto = require("crypto");
const { COLLEAGUES, TEMPLATES } = require("./templates");

const pick = (items) => items[Math.floor(Math.random() * items.length)];
const randomBetween = (min, max) => min + Math.random() * (max - min);
const familyOf = (template) => template.family || template.id;

// 1回の体験ぶんのメールの選び方。直近 recentWindow 通と family(同じ会社・同じ種類の依頼)が重ならない種類から選び、
// その中でも、この回にまだ使っていない種類を優先する
function createPicker(recentWindow) {
  const history = [];
  return () => {
    const used = new Set(history);
    const recentFamilies = new Set(history.slice(-recentWindow).map((template) => familyOf(template)));
    const fresh = TEMPLATES.filter((template) => !recentFamilies.has(familyOf(template)));
    const unused = fresh.filter((template) => !used.has(template));
    const template = pick(unused.length > 0 ? unused : fresh.length > 0 ? fresh : TEMPLATES);
    history.push(template);
    return template;
  };
}

// 届くたびに変わる値。日付は日本時間で作る
function placeholderValues(date) {
  const part = (options) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...options }).format(date);
  const later = new Date(date.getTime() + 3 * 86400000);
  const md = (d) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(d);
  const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  const yen = (min, max) => `${Math.round(randomBetween(min, max)).toLocaleString("ja-JP")}円`;
  return {
    code: digits(6),
    tracking: `${digits(4)}-${digits(4)}-${digits(4)}`,
    ml: String(100 + Math.floor(Math.random() * 900)),
    amount: yen(500, 12000),
    bigamount: yen(18000, 96000),
    md: md(date),
    hm: part({ hour: "2-digit", minute: "2-digit", hour12: false }),
    ymd: part({ year: "numeric", month: "2-digit", day: "2-digit" }),
    future: md(later),
  };
}

// 種類ごとの体裁にして、{code} などを埋める
function composeMail(template, date) {
  const values = placeholderValues(date);
  const fill = (text) => text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
  const subject = fill(template.subject);
  const text = fill(template.body);

  if (template.kind === "work") {
    const sender = pick(COLLEAGUES);
    const firstName = sender.name.split(" ")[0];
    return { sender, subject, body: `お疲れさまです。${firstName}です。\n\n${text}\n\n${sender.name}` };
  }

  const sender = { name: template.sender[0], key: template.sender[1] };
  if (template.kind === "promo") {
    const line = "━━━━━━━━━━━━━━━━━━━━━━━━";
    const body = [line, `  ${sender.name} メールマガジン`, line, "", "※このメールは、配信を希望された方にお送りしています。", "",
      text, "", line, "配信停止・配信先の変更はこちら", `発行：${sender.name}`, line].join("\n");
    return { sender, subject, body };
  }
  return { sender, subject, body: `${text}\n\n――――――――――\n※このメールは送信専用のアドレスから自動でお送りしています。\n${sender.name}` };
}

// 日本語のヘッダーをMIMEの形にする。長い件名でも1かたまりが規格の長さ(75文字)を超えないよう、12文字ずつに分けて折り返す
function encodeHeader(text) {
  const chars = Array.from(text);
  const words = [];
  for (let i = 0; i < chars.length; i += 12) {
    words.push(`=?UTF-8?B?${Buffer.from(chars.slice(i, i + 12).join(""), "utf8").toString("base64")}?=`);
  }
  return words.join("\r\n ");
}

// 1通ぶんのメール(Gmail API に渡す raw)。差出人は展示用アドレスの「+」付きの別名にするので、返信しても外へは出ない
function buildRawMail(template, date, myAddress) {
  const { sender, subject, body } = composeMail(template, date);
  const [user, domain] = myAddress.split("@");
  const raw = [
    `From: ${encodeHeader(sender.name)} <${user}+${sender.key}@${domain}>`,
    `To: ${myAddress}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@exhibition.local>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ].join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64url");
}

module.exports = { createPicker, buildRawMail, randomBetween };
