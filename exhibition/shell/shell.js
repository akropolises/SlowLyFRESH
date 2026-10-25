// 展示の進行。はじめる → 作業する → 本物のゆっくリフレッシュが差し込まれる → 作業に戻る → 予定へ向かう、を1回の体験として回す。
// 作業は2通り。「実際のアプリ」なら、体験者は実際のアプリ(Gmailなど)で作業し、展示の画面は左下の小さな表示
// (次の予定まであと何分)だけになる。黒子の作業(tasks/)なら、展示の画面の中にその作業を出す。
// どれにするかは、スタッフが Ctrl+Alt+Shift+T で次の回のぶんを切り替える(最初は config.workMode で決まる)
const config = window.EXHIBITION_CONFIG;

const tasks = config.taskIds
  .map((id) => window.EXHIBITION_TASKS.find((task) => task.id === id))
  .filter(Boolean);
const OWN_WORK = { id: "own", title: "実際のアプリ" };
// 切り替える順番: 実際のアプリ → 黒子の作業(config.taskIdsの順) → 実際のアプリ …
const workChoices = [OWN_WORK, ...tasks];
const phrases = window.TASK_PHRASES;
const bridge = window.exhibitBridge;
const params = new URLSearchParams(location.search);
// --task=<id> を付けて起動したときは、いつもその黒子の作業を使う
const fixedTaskId = params.get("task");
const MINUTE = 60000;
const MEETING_ID = "exhibition-meeting";
// スタッフが選んだ作業を、起動し直しても覚えておく
const WORK_STORAGE_KEY = "exhibition-work";
// 小さな表示のウィンドウの大きさと位置。ふだんは左下に次の予定だけ、リマインドのときは画面下の中央に置く(影のぶん余白を含む)
const WIDGET_SIZES = {
  next: { width: 480, height: 76 },
  reminder: { width: 640, height: 110, position: "center" },
};

const launcher = document.querySelector("#launcher");
const startButton = document.querySelector("#startButton");
const staffNote = document.querySelector("#staffNote");
const mailNote = document.querySelector("#mailNote");
const settingsPanel = document.querySelector("#settingsPanel");
const settingsForm = document.querySelector("#settingsForm");
const workSelect = document.querySelector("#workSelect");
const settingsOutputs = {
  minLeadSeconds: [document.querySelector("#minLeadOutput"), (v) => `${v}〜${v + 60}秒後`],
  gmailInitialCount: [document.querySelector("#gmailInitialCountOutput"), (v) => `${v}通`],
  gmailMailsPerMinute: [document.querySelector("#gmailMailsPerMinuteOutput"), (v) => (v === 0 ? "届かない" : `1分に${v}通`)],
  inboxInitialCount: [document.querySelector("#inboxInitialCountOutput"), (v) => `${v}通`],
  inboxMailsPerMinute: [document.querySelector("#inboxMailsPerMinuteOutput"), (v) => (v === 0 ? "届かない" : `1分に${v}通`)],
};
const widget = document.querySelector("#widget");
const widgetText = document.querySelector("#widgetText");
const widgetButton = document.querySelector("#widgetButton");
const desktop = document.querySelector("#desktop");
const workWindow = document.querySelector("#workWindow");
const workClose = document.querySelector("#workClose");
const meetingReminder = document.querySelector("#meetingReminder");
const meetingReminderText = document.querySelector("#meetingReminderText");
const meetingReminderButton = document.querySelector("#meetingReminderButton");
const endCardTitle = document.querySelector("#endCardTitle");
const windowTitle = document.querySelector("#windowTitle");
const workHint = document.querySelector("#workHint");
const taskFrame = document.querySelector("#taskFrame");
const toasts = document.querySelector("#toasts");
const nextEvent = document.querySelector("#nextEvent");
const endCard = document.querySelector("#endCard");

// phase: launcher → working → after(ゆっくリフレッシュ中と、その後) → leaving → end
const session = {
  phase: "launcher",
  // この回の黒子の作業。実際のアプリで作業する回は null
  task: null,
  // この体験の「次の予定」。開始時刻は体験ごとに、今の時刻から決める
  meeting: null,
  timers: [],
  nextEventTimer: null,
  toastTimer: null,
  // 展示用Gmailへのメールを届けている最中か
  mailActive: false,
};

// 実際のアプリで作業する回は、「はじめる」から100秒間(体験が先に終わればそこまで)、展示用Gmailにメールが届く(exhibition/mail/)
function startMail() {
  session.mailActive = true;
  bridge?.mail({ action: "start" });
}

function stopMail() {
  if (!session.mailActive) return;
  session.mailActive = false;
  bridge?.mail({ action: "stop" });
}

// スタッフ向け: 展示用Gmailが使えないとき(ログインしていない・Googleにつながらない)は、開始画面の隅に出しておく
async function showMailStatus() {
  const status = await bridge?.mailStatus();
  if (!status?.enabled || status.ready) {
    mailNote.classList.add("hidden");
    return;
  }
  mailNote.textContent = status.error ? `展示用Gmailにメールを届けられません(${status.error})` : "展示用Gmailにログインしていません(メールは届きません)";
  mailNote.classList.remove("hidden");
}

function timeLabel(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// 開始画面と終わりの画面は全画面。体験中は小さな表示("widget")か、黒子の作業のウィンドウ("window")
const setWindowMode = (mode, size = {}) => bridge?.setWindowMode({ mode, ...size });

function later(ms, fn) {
  session.timers.push(setTimeout(fn, ms));
}

function clearSessionTimers() {
  session.timers.forEach((timer) => clearTimeout(timer));
  session.timers = [];
  clearInterval(session.nextEventTimer);
  clearTimeout(session.toastTimer);
}

const postToTask = (message) => taskFrame.contentWindow?.postMessage({ source: "exhibit-shell", ...message }, "*");

// 次の回の作業。体験者には選ばせず、開始画面は「はじめる」だけにする
let currentWork = (() => {
  let saved = null;
  try {
    saved = localStorage.getItem(WORK_STORAGE_KEY);
  } catch {
    // 保存できない環境では、config.workMode で決まる最初の作業から
  }
  const fallback = config.workMode === "decoy" && tasks.length > 0 ? tasks[0] : OWN_WORK;
  return workChoices.find((choice) => choice.id === saved) || fallback;
})();

// スタッフ向けの短いお知らせを、画面の隅に一瞬だけ出す
function showStaffNote(text) {
  staffNote.textContent = text;
  staffNote.classList.add("show");
  clearTimeout(showStaffNote.timer);
  showStaffNote.timer = setTimeout(() => staffNote.classList.remove("show"), 2000);
}

// 次の回の作業を決めて、起動し直しても覚えておく。体験の途中なら次の回から変わる
function setWork(choice) {
  currentWork = choice;
  try {
    localStorage.setItem(WORK_STORAGE_KEY, currentWork.id);
  } catch {
    // 覚えておけなくても切り替え自体はできる
  }
}

// スタッフ用: 次の回の作業を順に切り替え、画面の隅に一瞬だけ名前を出す
function switchWork() {
  setWork(workChoices[(workChoices.indexOf(currentWork) + 1) % workChoices.length]);
  showStaffNote(`次の作業: ${currentWork.title}`);
}

// ---- スタッフ設定パネル(開始画面で Ctrl+Alt+Shift+P) ----

// 保存されている設定(ゆっくリフレッシュの最短開始と、受信トレイの作業のメールの通数。展示用Gmailの値は main process が使う)。
// 読めるまでは config.js の値
let staffValues = {
  minLeadSeconds: config.minLeadSeconds,
  inboxInitialCount: config.inboxTask.initialCount,
  inboxMailsPerMinute: config.inboxTask.mailsPerMinute,
};
bridge?.getSettings().then((settings) => {
  staffValues = settings.values;
});

function fillSettingsForm({ values, fields }, work) {
  Object.entries(fields).forEach(([key, field]) => {
    const input = settingsForm.elements[key];
    if (field.type === "boolean") {
      input.checked = values[key];
      return;
    }
    Object.assign(input, { min: field.min, max: field.max, step: field.step });
    input.value = values[key];
    renderSettingOutput(key);
  });
  document.querySelector("#recentUnreadCount").textContent = config.gmailDemo.recentUnreadCount;
  workSelect.innerHTML = workChoices.map((choice) => `<option value="${choice.id}">${choice.title}</option>`).join("");
  workSelect.value = work.id;
}

function renderSettingOutput(key) {
  const [output, format] = settingsOutputs[key];
  output.textContent = format(Number(settingsForm.elements[key].value));
}

async function openSettings() {
  if (session.phase !== "launcher" || !bridge) return;
  fillSettingsForm(await bridge.getSettings(), currentWork);
  settingsPanel.classList.remove("hidden");
  settingsForm.elements.minLeadSeconds.focus();
}

function closeSettings() {
  settingsPanel.classList.add("hidden");
  startButton.focus();
}

Object.keys(settingsOutputs).forEach((key) => {
  settingsForm.elements[key].addEventListener("input", () => renderSettingOutput(key));
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = {
    ...Object.fromEntries(Object.keys(settingsOutputs).map((key) => [key, Number(settingsForm.elements[key].value)])),
    gmailClearInbox: settingsForm.elements.gmailClearInbox.checked,
    gmailMarkRecentUnread: settingsForm.elements.gmailMarkRecentUnread.checked,
  };
  staffValues = (await bridge.setSettings(values)).values;
  setWork(workChoices.find((choice) => choice.id === workSelect.value) || currentWork);
  closeSettings();
  showStaffNote("設定を保存しました");
});

// 初期値(config.js)に戻す。作業も、最初の設定(config.workMode)に戻す
document.querySelector("#settingsReset").addEventListener("click", async () => {
  const settings = await bridge.setSettings(null);
  staffValues = settings.values;
  setWork(config.workMode === "decoy" && tasks.length > 0 ? tasks[0] : OWN_WORK);
  fillSettingsForm(settings, currentWork);
  showStaffNote("初期値に戻しました");
});

document.querySelector("#settingsCancel").addEventListener("click", closeSettings);
settingsPanel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
});

startButton.addEventListener("click", () => startSession(currentWork === OWN_WORK ? null : currentWork));

function showLauncher() {
  resetSession();
  setWindowMode("full");
  if (fixedTaskId) {
    startSession(window.EXHIBITION_TASKS.find((task) => task.id === fixedTaskId) || tasks[0]);
    return;
  }
  launcher.classList.remove("hidden");
  startButton.focus();
  showMailStatus();
}

function resetSession() {
  clearSessionTimers();
  settingsPanel.classList.add("hidden");
  stopMail();
  session.phase = "launcher";
  session.task = null;
  // 前の回の予定が残っていると、体験していないときに差し込まれてしまうので消しておく
  bridge?.setMeeting(null);
  document.body.classList.remove("mode-widget");
  widget.classList.add("hidden");
  widget.classList.remove("is-reminder");
  taskFrame.src = "about:blank";
  toasts.innerHTML = "";
  workWindow.classList.remove("closing");
  meetingReminder.classList.remove("show");
  meetingReminder.classList.add("hidden");
  desktop.classList.add("hidden");
  endCard.classList.add("hidden");
}

// 差し込みの時刻を決め、その5分後を「次の予定」として本物のアプリに渡す。アプリは予定5分前に、自分の判定で全画面で始める。
// アプリは分単位で判定するので、差し込みは「今から minLeadSeconds 秒以上あとの、いちばん近い分の区切り」に置く。
// immediate(スタッフ用の即時差し込み)のときは、今の分を差し込みの分にして、すぐ始めさせる
function scheduleSlow({ immediate = false } = {}) {
  const now = Date.now();
  const slowStartMs = immediate
    ? Math.floor(now / MINUTE) * MINUTE
    : Math.ceil((now + staffValues.minLeadSeconds * 1000) / MINUTE) * MINUTE;
  const meetingStartMs = slowStartMs + 5 * MINUTE;
  session.meeting = { startMs: meetingStartMs, start: timeLabel(meetingStartMs) };
  bridge?.setMeeting({
    id: MEETING_ID,
    title: config.meeting.title,
    start: session.meeting.start,
    duration: config.meeting.duration,
    excludeSlowIds: config.excludedSlowIds,
  });
  // アプリ自身のタイマーと定期判定(15秒ごと)に加えて、念のため5分前になった直後にも開始を促す。二重開始はアプリ側で防がれる
  later(immediate ? 300 : slowStartMs - now + 500, () => {
    if (session.phase === "working") bridge?.triggerSlow(MEETING_ID);
  });
  // ゆっくリフレッシュは分の区切り(00秒)に始まるので、その少しあと(既定1秒後)に裏の表示を「向かう」に切り替えておく。
  // 本物のアプリの全画面に隠れているので、ゆっくリフレッシュが終わって画面が明けたときには、もう切り替わっている
  const switchAt = Math.max(slowStartMs + config.reminderAfterStartSeconds * 1000, now + 1300);
  later(switchAt - now, slowStarted);
  later(slowStartMs + config.autoLeaveSeconds * 1000 - now, leaveForMeeting);
  renderNextEvent();
}

function startSession(task) {
  resetSession();
  session.task = task;
  session.phase = "working";
  launcher.classList.add("hidden");

  if (session.task) {
    setWindowMode("window");
    desktop.classList.remove("hidden");
    windowTitle.textContent = task.windowTitle;
    workHint.textContent = task.hint;
    // 受信トレイの作業のメールの通数とペース(スタッフ設定)。届くのをやめる時刻は、展示用Gmailと同じ決め方
    const taskParams = new URLSearchParams({
      initial: staffValues.inboxInitialCount,
      rate: staffValues.inboxMailsPerMinute,
      stopAfter: staffValues.minLeadSeconds + 60 + config.gmailDemo.stopAfterLatestStartSeconds,
    });
    taskFrame.src = `../tasks/${task.id}/index.html?${taskParams}`;
    taskFrame.addEventListener("load", () => taskFrame.contentWindow.focus(), { once: true });
    scheduleToast();
  } else {
    // 体験者は実際のアプリで作業する。展示の画面は左下の小さな表示だけにして、前を譲る
    document.body.classList.add("mode-widget");
    widget.classList.remove("hidden");
    setWindowMode("widget", WIDGET_SIZES.next);
    bridge?.releaseFocus();
    startMail();
  }

  scheduleSlow();
  session.nextEventTimer = setInterval(renderNextEvent, 500);
}

// ゆっくリフレッシュが始まったころ。作業は裏で届き続ける(現実の仕事は待ってくれない)が、通知は全画面の裏で見えないので止める。
// 戻ったときに出ているよう、次の予定のリマインド(「向かう」)に切り替えておく
function slowStarted() {
  if (session.phase !== "working") return;
  session.phase = "after";
  clearTimeout(session.toastTimer);
  showMeetingReminder();
}

function showMeetingReminder() {
  if (session.phase !== "after") return;
  const text = `まもなく ${session.meeting.start} ${config.meeting.title}`;
  if (!session.task) {
    widgetText.textContent = text;
    widget.classList.add("is-reminder");
    setWindowMode("widget", WIDGET_SIZES.reminder);
    return;
  }
  meetingReminderText.textContent = text;
  meetingReminder.classList.remove("hidden");
  requestAnimationFrame(() => requestAnimationFrame(() => meetingReminder.classList.add("show")));
}

// 作業を閉じて、次の予定へ向かう
function leaveForMeeting() {
  if (session.phase !== "after") return;
  session.phase = "leaving";
  clearSessionTimers();
  stopMail();
  if (!session.task) {
    showEndCard();
    return;
  }
  postToTask({ type: "pause" });
  meetingReminder.classList.remove("show");
  toasts.innerHTML = "";
  workWindow.classList.add("closing");
  nextEvent.classList.remove("soon");
  nextEvent.textContent = `${config.meeting.title}へ移動中`;
  later(1600, showEndCard);
}

function showEndCard() {
  session.phase = "end";
  document.body.classList.remove("mode-widget");
  widget.classList.add("hidden");
  setWindowMode("full");
  endCardTitle.textContent = `${config.meeting.title}へ`;
  endCard.classList.remove("hidden");
  later(config.endCardSeconds * 1000, showLauncher);
}

widgetButton.addEventListener("click", leaveForMeeting);
meetingReminderButton.addEventListener("click", leaveForMeeting);
workClose.addEventListener("click", leaveForMeeting);
endCard.addEventListener("click", showLauncher);
// 終わりの画面では、Enterキーでも開始画面へ戻れる。そのEnterを押しっぱなしにしても次の回が始まらないよう、
// 戻ってからEnterを離すまでは、開始画面の「はじめる」にEnterを渡さない
let holdingReturnEnter = false;
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter") return;
    if (session.phase === "end") {
      event.preventDefault();
      if (!event.repeat) {
        holdingReturnEnter = true;
        showLauncher();
      }
      return;
    }
    if (holdingReturnEnter) event.preventDefault();
  },
  true
);
document.addEventListener("keyup", (event) => {
  if (event.key === "Enter") holdingReturnEnter = false;
});


// 次の予定まであと何分。予定が迫ると色が変わる(時刻はWindowsのタスクバーの時計に任せる)
function renderNextEvent() {
  const minutesLeft = Math.ceil((session.meeting.startMs - Date.now()) / MINUTE);
  const label = minutesLeft > 0 ? `あと${minutesLeft}分` : "開始";
  const text = `次の予定 ${session.meeting.start} ${config.meeting.title}・${label}`;
  const soon = minutesLeft <= 6;
  nextEvent.textContent = text;
  nextEvent.classList.toggle("soon", soon);
  if (!widget.classList.contains("is-reminder")) {
    widgetText.textContent = text;
    widget.classList.toggle("soon", soon);
  }
}

// 黒子の作業モードで、作業中に届く通知。作業と関係なく、ときどき割り込んでくる
const pickSender = (() => {
  const people = phrases.senders.filter((name) => !name.endsWith("課") && !name.endsWith("局") && !name.endsWith("者"));
  return () => people[Math.floor(Math.random() * people.length)];
})();
const pickChat = (() => {
  let last = null;
  return () => {
    const candidates = phrases.chats.filter((item) => item !== last);
    last = candidates[Math.floor(Math.random() * candidates.length)];
    return last;
  };
})();

function scheduleToast() {
  clearTimeout(session.toastTimer);
  session.toastTimer = setTimeout(() => {
    if (session.phase === "working") {
      showToast(pickSender(), pickChat());
      scheduleToast();
    }
  }, 7000 + Math.random() * 7000);
}

function showToast(title, body) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${title}</strong><span>${body}</span>`;
  toasts.append(toast);
  while (toasts.children.length > 2) toasts.firstElementChild.remove();
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

// スタッフ用キー(main processのグローバルショートカットから届く)
bridge?.onCommand((command) => {
  if (command === "reset") showLauncher();
  if (command === "next-task") switchWork();
  if (command === "settings") openSettings();
  if (command === "trigger" && session.phase === "working") {
    clearSessionTimers();
    session.nextEventTimer = setInterval(renderNextEvent, 500);
    if (session.task) scheduleToast();
    scheduleSlow({ immediate: true });
  }
});

showLauncher();
