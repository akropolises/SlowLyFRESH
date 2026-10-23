// 展示用Gmailの受信トレイに、体験中だけメールを次々と届ける。
// メールは送信せず、Gmail API で受信トレイに直接入れる(messages.insert)。送信数の上限にはかからず、受信トレイも読まない。
// ログインは本物のアプリ(カレンダー)とは別に持ち、展示版の保存場所に置く。
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { createPicker, buildRawMail, randomBetween } = require("./compose");

// メールを入れる・ラベルを作る権限と、自分のアドレスを知るための権限だけ。受信トレイを読む権限は求めない
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.insert",
  "https://www.googleapis.com/auth/gmail.labels",
  "openid",
  "email",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const LOGIN_TIMEOUT_MS = 5 * 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base64Url = (buffer) => buffer.toString("base64url");

class GmailDemo {
  constructor({ userDataDir, clientId, clientSecret, settings, openExternal }) {
    this.statePath = path.join(userDataDir, "exhibition-gmail.json");
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.settings = settings;
    this.openExternal = openExternal;
    this.labelId = null;
    this.session = null;
    this.lastError = null;
    // state: { tokens, email, lastMailAt, lastEndAt }
    try {
      this.state = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
    } catch {
      this.state = {};
    }
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  hasLogin() {
    return Boolean(this.state.tokens?.refresh_token && this.state.email);
  }

  status() {
    return { ready: this.hasLogin() && !this.lastError, email: this.state.email || null, error: this.lastError };
  }

  // ---- ログイン(ブラウザでGoogleにログインし、localhost で認可コードを受け取る) ----

  async login() {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    const { redirectUri, waitForCode, close } = await this.startLoopbackServer();
    try {
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      await this.openExternal(url.toString());
      const code = await Promise.race([
        waitForCode,
        sleep(LOGIN_TIMEOUT_MS).then(() => {
          throw new Error("Gmailへのログインが時間内に終わりませんでした");
        }),
      ]);
      const tokens = await this.requestToken({ code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" });
      const email = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")).email;
      this.state = { ...this.state, email, tokens: { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 } };
      this.lastError = null;
      this.saveState();
      return email;
    } finally {
      close();
    }
  }

  startLoopbackServer() {
    return new Promise((resolve, reject) => {
      let settle;
      let fail;
      const waitForCode = new Promise((codeResolve, codeReject) => {
        settle = codeResolve;
        fail = codeReject;
      });
      waitForCode.catch(() => {});
      const server = http.createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (!code && !error) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><meta charset="utf-8"><title>展示用Gmail</title><p style="font-family:sans-serif;padding:2em">${
          error ? "ログインできませんでした。展示のアプリに戻ってください。" : "ログインしました。このタブを閉じて、展示のアプリに戻ってください。"
        }</p>`);
        if (error) fail(new Error(error));
        else settle(code);
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        resolve({ redirectUri: `http://127.0.0.1:${server.address().port}`, waitForCode, close: () => server.close() });
      });
    });
  }

  async requestToken(params) {
    const body = new URLSearchParams({ client_id: this.clientId, ...params });
    if (this.clientSecret) body.set("client_secret", this.clientSecret);
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Googleのトークンを取得できませんでした: ${data.error_description || data.error || response.status}`);
    return data;
  }

  async accessToken() {
    const tokens = this.state.tokens;
    if (!tokens?.refresh_token) throw new Error("Gmailにログインしていません");
    if (tokens.access_token && tokens.expires_at > Date.now() + 60000) return tokens.access_token;
    const refreshed = await this.requestToken({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" });
    this.state.tokens = { ...tokens, ...refreshed, refresh_token: tokens.refresh_token, expires_at: Date.now() + refreshed.expires_in * 1000 };
    this.saveState();
    return this.state.tokens.access_token;
  }

  async gmail(method, pathname, body) {
    const response = await fetch(`${GMAIL_URL}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Gmail API ${response.status}: ${data.error?.message || ""}`);
    return data;
  }

  async ensureLabel() {
    if (this.labelId) return this.labelId;
    const name = this.settings.label;
    const { labels = [] } = await this.gmail("GET", "/labels");
    const found = labels.find((label) => label.name === name);
    this.labelId = found
      ? found.id
      : (await this.gmail("POST", "/labels", { name, labelListVisibility: "labelShow", messageListVisibility: "show" })).id;
    return this.labelId;
  }

  async insertMail(template, date) {
    await this.gmail("POST", "/messages?internalDateSource=dateHeader", {
      raw: buildRawMail(template, date, this.state.email),
      labelIds: ["INBOX", "UNREAD", await this.ensureLabel()],
    });
    this.state.lastMailAt = Math.max(this.state.lastMailAt || 0, date.getTime());
  }

  // ---- 1回の体験 ----

  // 最初に未読を initialCount 通、古いものから順に入れ、そのまま「始まりから streamSeconds 秒」まで、1分に mailsPerMinute 通のペースで届け続ける。
  // 最初の未読は前の回のメールより新しい日時にするので、受信トレイの上から initialCount 通はいつも未読になる
  async start({ initialCount, mailsPerMinute, streamSeconds }) {
    if (!this.hasLogin()) return;
    const session = {};
    this.session = session;
    const isCurrent = () => this.session === session;
    const pickTemplate = createPicker(this.settings.recentWindow);
    const startedAt = Date.now();

    try {
      const floor = Math.max((this.state.lastMailAt || 0) + 1000, (this.state.lastEndAt || 0) + 1000, startedAt - 60 * 60000);
      const offsets = Array.from({ length: initialCount }, () => Math.random()).sort((a, b) => a - b);
      for (const offset of offsets) {
        if (!isCurrent()) return;
        await this.insertMail(pickTemplate(), new Date(Math.min(floor + offset * (startedAt - floor), startedAt)));
      }

      // 届く間隔は平均(60秒 / 1分あたりの通数)の 0.7〜1.3倍でばらつかせる。0通なら、ここでは何も届けない
      const until = startedAt + streamSeconds * 1000;
      const meanSeconds = mailsPerMinute > 0 ? 60 / mailsPerMinute : 0;
      while (meanSeconds > 0 && isCurrent()) {
        await sleep(randomBetween(meanSeconds * 0.7, meanSeconds * 1.3) * 1000);
        if (!isCurrent() || Date.now() >= until) break;
        await this.insertMail(pickTemplate(), new Date());
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      console.error("展示用Gmailにメールを届けられませんでした:", error.message);
    } finally {
      if (isCurrent()) this.endSession();
      this.saveState();
    }
  }

  stop() {
    if (this.session) this.endSession();
    this.saveState();
  }

  endSession() {
    this.session = null;
    this.state.lastEndAt = Date.now();
  }
}

module.exports = { GmailDemo };
