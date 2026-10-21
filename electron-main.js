const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require("electron");

let mainWindow = null;
let tray = null;
const reminderTimers = new Map();
const googleCalendarScope = "https://www.googleapis.com/auth/calendar.readonly";
const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleCalendarEventsUrl = "https://www.googleapis.com/calendar/v3/calendars";
const googleCalendarListUrl = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const appIconPath = path.join(__dirname, "assets", "tray-icon.png");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 600,
    show: false,
    title: "ゆっくリフレッシュ",
    icon: appIconPath,
    backgroundColor: "#fffdf8",
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(appIconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("ゆっくリフレッシュ");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "ゆっくリフレッシュを開く", click: showMainWindow },
      {
        label: "終了",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", showMainWindow);
}

function showMainWindow() {
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.focus();
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
  }, 3000);
}

// ウィンドウの不透明度をなめらかに変化させる(OSレベルの表示/非表示が唐突に切り替わらないようにする)
function animateWindowOpacity(from, to, durationMs, onDone) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const steps = Math.max(Math.round(durationMs / 16), 1);
  let step = 0;
  mainWindow.setOpacity(from);
  const timer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    step += 1;
    const ratio = Math.min(step / steps, 1);
    mainWindow.setOpacity(from + (to - from) * ratio);
    if (ratio >= 1) {
      clearInterval(timer);
      onDone?.();
    }
  }, 16);
}

function enterSlowMode() {
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.setOpacity(0);
  mainWindow.show();
  mainWindow.setFullScreen(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.focus();
  animateWindowOpacity(0, 1, 500);
}

function leaveSlowMode() {
  if (!mainWindow) return;

  animateWindowOpacity(1, 0, 400, () => {
    mainWindow.setAlwaysOnTop(false);
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
    mainWindow.hide();
    mainWindow.setOpacity(1);
  });
}

function clearReminderTimers() {
  reminderTimers.forEach((timer) => clearTimeout(timer));
  reminderTimers.clear();
}

function getTokenPath() {
  return path.join(app.getPath("userData"), "google-tokens.json");
}

function readStoredTokens() {
  try {
    return JSON.parse(fs.readFileSync(getTokenPath(), "utf8"));
  } catch {
    return null;
  }
}

function writeStoredTokens(tokens) {
  fs.mkdirSync(path.dirname(getTokenPath()), { recursive: true });
  fs.writeFileSync(getTokenPath(), JSON.stringify(tokens, null, 2));
}

function clearStoredTokens() {
  try {
    fs.unlinkSync(getTokenPath());
  } catch {
    // No stored token yet.
  }
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    return text ? ` ${text}` : "";
  } catch {
    return "";
  }
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function toTimeValue(date) {
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function normalizeGoogleEvents(items, calendar = {}) {
  return (items || [])
    .filter((event) => event.start?.dateTime && event.end?.dateTime)
    .map((event) => {
      // 前日から続いている予定は、今日の0:00開始として扱う(前日の開始時刻のままだと今日の分単位の比較で最中と判定できない)
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const startDate = new Date(Math.max(new Date(event.start.dateTime).getTime(), dayStart.getTime()));
      const endDate = new Date(event.end.dateTime);
      return {
        id: `${calendar.id || "primary"}:${event.id}`,
        title: event.summary || "予定",
        start: toTimeValue(startDate),
        duration: Math.max(Math.round((endDate - startDate) / 60000), 1),
        source: "google",
        calendarId: calendar.id || "primary",
        calendarSummary: calendar.summary || "",
      };
    });
}

function startLoopbackServer() {
  return new Promise((resolve, reject) => {
    let settleCode;
    let rejectCode;
    const waitForCode = new Promise((codeResolve, codeReject) => {
      settleCode = codeResolve;
      rejectCode = codeReject;
    });

    const closePage = (title, message) => `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        color: #24332f;
        background: #fffdf8;
        font-family: system-ui, sans-serif;
      }
      main {
        width: min(28rem, calc(100vw - 2rem));
        text-align: center;
      }
      p {
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <p id="fallback">このタブは自動で閉じます。閉じない場合は手動で閉じてください。</p>
    </main>
    <script>
      window.setTimeout(() => {
        window.close();
        document.getElementById("fallback").textContent = "認可処理は完了しました。このタブを閉じてゆっくリフレッシュに戻ってください。";
      }, 250);
    </script>
  </body>
</html>`;

    const server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      response.writeHead(error ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        error
          ? closePage("Google login failed", "ゆっくリフレッシュでGoogle Calendarを読み込めませんでした。")
          : closePage("Google login complete", "ゆっくリフレッシュに戻ってGoogle Calendarを読み込んでいます。")
      );
      server.close();

      if (error) {
        rejectCode(new Error(error));
        return;
      }
      settleCode(code);
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/oauth2callback`,
        waitForCode,
      });
    });
    server.once("error", rejectCode);
    server.once("error", reject);
  });
}

function buildTokenParams(params) {
  const tokenParams = new URLSearchParams(params);
  if (!tokenParams.get("client_secret")) {
    tokenParams.delete("client_secret");
  }
  return tokenParams;
}

async function exchangeCodeForTokens({ clientId, clientSecret, code, codeVerifier, redirectUri }) {
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildTokenParams({
      client_id: clientId,
      client_secret: clientSecret || "",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}.${await readErrorBody(response)}`);
  }
  return response.json();
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildTokenParams({
      client_id: clientId,
      client_secret: clientSecret || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    clearStoredTokens();
    throw new Error(`Token refresh failed: ${response.status}.${await readErrorBody(response)}`);
  }
  return response.json();
}

async function getGoogleAccessToken(clientId, clientSecret) {
  const stored = readStoredTokens();
  if (stored?.refresh_token && stored.expires_at && stored.expires_at > Date.now() + 60000) {
    return stored.access_token;
  }

  if (stored?.refresh_token) {
    const refreshed = await refreshAccessToken(clientId, clientSecret, stored.refresh_token);
    const next = {
      ...stored,
      ...refreshed,
      refresh_token: stored.refresh_token,
      expires_at: Date.now() + refreshed.expires_in * 1000,
    };
    writeStoredTokens(next);
    return next.access_token;
  }

  return authorizeGoogle(clientId, clientSecret);
}

async function authorizeGoogle(clientId, clientSecret) {
  const { verifier, challenge } = createPkcePair();
  const { redirectUri, waitForCode } = await startLoopbackServer();
  const authUrl = new URL(googleAuthUrl);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: googleCalendarScope,
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  await shell.openExternal(authUrl.toString());
  const code = await waitForCode;
  const tokens = await exchangeCodeForTokens({
    clientId,
    clientSecret,
    code,
    codeVerifier: verifier,
    redirectUri,
  });
  const stored = {
    ...tokens,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  writeStoredTokens(stored);
  return stored.access_token;
}

async function fetchGoogleJson(url, accessToken, errorLabel) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`${errorLabel} failed: ${response.status}.${await readErrorBody(response)}`);
  }

  return response.json();
}

async function listReadableGoogleCalendars(accessToken) {
  const calendars = [];
  let pageToken;

  do {
    const url = new URL(googleCalendarListUrl);
    url.search = new URLSearchParams({
      minAccessRole: "reader",
      showDeleted: "false",
      showHidden: "false",
      ...(pageToken ? { pageToken } : {}),
    }).toString();

    const data = await fetchGoogleJson(url, accessToken, "CalendarList API");
    calendars.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return calendars.filter((calendar) => calendar.primary || calendar.selected);
}

function normalizeCalendarIds(configuredCalendarIds, configuredCalendarId) {
  if (Array.isArray(configuredCalendarIds) && configuredCalendarIds.length > 0) {
    return configuredCalendarIds.filter(Boolean);
  }
  if (configuredCalendarId) {
    return [configuredCalendarId];
  }
  return [];
}

async function listTodayGoogleEvents({ clientId, clientSecret, calendarId, calendarIds = [] }) {
  if (!clientId) {
    throw new Error("Missing Google OAuth Client ID.");
  }

  const accessToken = await getGoogleAccessToken(clientId, clientSecret);
  const configuredCalendarIds = normalizeCalendarIds(calendarIds, calendarId);
  const calendars =
    configuredCalendarIds.length > 0
      ? configuredCalendarIds.map((id) => ({ id, summary: id }))
      : await listReadableGoogleCalendars(accessToken);

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const eventGroups = await Promise.all(
    calendars.map(async (calendar) => {
      const url = new URL(`${googleCalendarEventsUrl}/${encodeURIComponent(calendar.id)}/events`);
      url.search = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        showDeleted: "false",
        singleEvents: "true",
        orderBy: "startTime",
      }).toString();

      const data = await fetchGoogleJson(url, accessToken, `Calendar API (${calendar.summary || calendar.id})`);
      return normalizeGoogleEvents(data.items, calendar);
    })
  );

  return eventGroups.flat().sort((a, b) => a.start.localeCompare(b.start));
}

function scheduleReminders(reminders) {
  clearReminderTimers();
  reminders.forEach((reminder) => {
    const dueAt = new Date(reminder.dueAt).getTime();
    const delay = dueAt - Date.now();
    if (!Number.isFinite(dueAt) || delay <= 0) {
      return;
    }

    // 開始してよいかはrenderer側で判定する(予定の最中なら開始しない)。開始する場合はenterSlowModeでウィンドウを出すので、
    // ここでは表示しない。分の境目ぴったりより少し後に届くよう余裕を持たせる
    const timer = setTimeout(() => {
      reminderTimers.delete(reminder.id);
      mainWindow?.webContents.send("electron-start-slow", reminder.id);
    }, delay + 1000);
    reminderTimers.set(reminder.id, timer);
  });
}

ipcMain.handle("set-reminders", (_event, reminders) => {
  scheduleReminders(Array.isArray(reminders) ? reminders : []);
  return { scheduled: reminderTimers.size };
});

ipcMain.handle("show-window", () => {
  showMainWindow();
});

ipcMain.handle("enter-slow-mode", () => {
  enterSlowMode();
});

ipcMain.handle("leave-slow-mode", () => {
  leaveSlowMode();
});

ipcMain.handle("load-google-events", (_event, config) => {
  return listTodayGoogleEvents({
    clientId: config?.googleClientId,
    clientSecret: config?.googleClientSecret,
    calendarId: config?.googleCalendarId,
    calendarIds: config?.googleCalendarIds,
  });
});

ipcMain.handle("clear-google-auth", () => {
  clearStoredTokens();
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.setLoginItemSettings({
    openAtLogin: false,
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  clearReminderTimers();
});

app.on("window-all-closed", () => {});
