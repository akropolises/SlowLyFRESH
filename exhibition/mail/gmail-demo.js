// 展示用Gmailの受信トレイに、体験中だけメールを次々と届ける。
// メールは送信せず、Gmail API で受信トレイに直接入れる(messages.insert)。送信数の上限にはかからない。
// スタッフ設定によっては、はじめに前の回の展示メールをゴミ箱へ移したり、受信トレイの直近のメールを未読に戻したりする。
// ログインは本物のアプリ(カレンダー)とは別に持ち、展示版の保存場所に置く。
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { createPicker, buildRawMail, randomBetween } = require("./compose");

// メールを入れる・ラベルを作る権限、受信トレイのメールを一覧してゴミ箱へ移したり未読に戻したりする権限(gmail.modify)、
// 自分のアドレスを知るための権限。メールを完全に削除する権限(https://mail.google.com/)は求めない
const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.insert",
  "https://www.googleapis.com/auth/gmail.labels",
  MODIFY_SCOPE,
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
    // state: { tokens, email, lastMailAt, lastEndAt, prepared(次の体験の準備ができているか) }
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

  // gmail.modify を足す前のログインは、権限が足りないので、ログインし直してもらう
  hasLogin() {
    const tokens = this.state.tokens;
    return Boolean(tokens?.refresh_token && this.state.email && (tokens.scope || "").split(" ").includes(MODIFY_SCOPE));
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

  // 前の回の展示メールを、スレッドごと(体験者の返信もまとめて)ゴミ箱へ移す。ゴミ箱からは30日で消える
  async clearDemoMails() {
    const labelId = await this.ensureLabel();
    for (;;) {
      const { threads = [] } = await this.gmail("GET", `/threads?labelIds=${labelId}&maxResults=100`);
      if (threads.length === 0) return;
      for (let i = 0; i < threads.length; i += 10) {
        await Promise.all(threads.slice(i, i + 10).map((thread) => this.gmail("POST", `/threads/${thread.id}/trash`)));
      }
    }
  }

  // 受信トレイの新しいほうから count 通を未読にする(展示のメールかどうかは問わない)
  async markRecentUnread(count) {
    if (count <= 0) return;
    const { messages = [] } = await this.gmail("GET", `/messages?labelIds=INBOX&maxResults=${count}`);
    if (messages.length === 0) return;
    await this.gmail("POST", "/messages/batchModify", { ids: messages.map((message) => message.id), addLabelIds: ["UNREAD"] });
  }

  async insertMail(template, date) {
    await this.gmail("POST", "/messages?internalDateSource=dateHeader", {
      raw: buildRawMail(template, date, this.state.email),
      labelIds: ["INBOX", "UNREAD", await this.ensureLabel()],
    });
    this.state.lastMailAt = Math.max(this.state.lastMailAt || 0, date.getTime());
  }

  // ---- 1回の体験 ----

  // 受信トレイでいちばん新しいメールの日時(なければ0)
  async newestInboxTime() {
    const { messages = [] } = await this.gmail("GET", "/messages?labelIds=INBOX&maxResults=1");
    if (messages.length === 0) return 0;
    const message = await this.gmail("GET", `/messages/${messages[0].id}?format=minimal`);
    return Number(message.internalDate) || 0;
  }

  // 次の体験者のための準備。体験の終わりに(初めて使うときは起動時に)行い、「はじめる」ではメールを届けることだけをする。
  // clearInbox なら、まず前の回の展示メールをゴミ箱へ移す。
  // 次に未読を initialCount 通、古いものから順に入れる(受信トレイのどのメールよりも新しい日時にするので、受信トレイの上から initialCount 通は未読)。
  // markRecentUnread なら、そのあと受信トレイの新しいほうから recentUnreadCount 通を未読にする。
  // 準備が重なったときは、前の準備が終わってから順に行う
  prepareNext(options) {
    this.preparing = (this.preparing || Promise.resolve()).then(() => this.runPrepare(options));
    return this.preparing;
  }

  async runPrepare({ initialCount, clearInbox = false, markRecentUnread = false, recentUnreadCount = 25 }) {
    if (!this.hasLogin()) return;
    try {
      if (clearInbox) await this.clearDemoMails();
      // 準備のメールと、次の体験で届くメールで、系統が重ならないよう同じ選び方を使い続ける
      this.picker = createPicker(this.settings.recentWindow);
      const now = Date.now();
      const floor = Math.max((await this.newestInboxTime()) + 1000, now - 60 * 60000);
      // 直前の準備から間がないときは、前の準備より新しくなるよう1通1秒ずつ先へずらす
      const end = Math.max(now, floor + initialCount * 1000);
      const offsets = Array.from({ length: initialCount }, () => Math.random()).sort((a, b) => a - b);
      for (const offset of offsets) {
        await this.insertMail(this.picker(), new Date(floor + offset * (end - floor)));
      }
      if (markRecentUnread) await this.markRecentUnread(recentUnreadCount);
      this.state.prepared = true;
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      console.error("展示用Gmailの準備ができませんでした:", error.message);
    } finally {
      this.saveState();
    }
  }

  // 準備がまだなら(前の体験のあと準備する前にアプリを終えたなど)、準備する
  prepareIfNeeded(options) {
    if (this.hasLogin() && !this.state.prepared) return this.prepareNext(options);
    return Promise.resolve();
  }

  // 「はじめる」から streamSeconds 秒まで、1分に mailsPerMinute 通のペースで届け続ける(最初の未読は、準備で入れてある)
  async start({ mailsPerMinute, streamSeconds }) {
    if (!this.hasLogin()) return;
    const session = {};
    this.session = session;
    const isCurrent = () => this.session === session;
    const pickTemplate = this.picker || createPicker(this.settings.recentWindow);
    const startedAt = Date.now();
    this.state.prepared = false;
    this.saveState();

    try {
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
