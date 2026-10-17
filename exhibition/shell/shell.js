// 展示の進行。はじめる → 作業する → 本物のゆっくリフレッシュが差し込まれる → 作業に戻る → 予定へ向かう、を1回の体験として回す。
const config = window.EXHIBITION_CONFIG;
// config.taskIdsに挙げた作業を、スタッフが Ctrl+Shift+T で切り替えて使う(作業のファイル自体は残しておける)
const tasks = config.taskIds
  .map((id) => window.EXHIBITION_TASKS.find((task) => task.id === id))
  .filter(Boolean);
const phrases = window.TASK_PHRASES;
const bridge = window.exhibitBridge;
const params = new URLSearchParams(location.search);
const fixedTaskId = params.get("task");
const MINUTE = 60000;
const MEETING_ID = "exhibition-meeting";
// スタッフが選んだ作業を、起動し直しても覚えておく
const TASK_STORAGE_KEY = "exhibition-task-id";

const launcher = document.querySelector("#launcher");
const startButton = document.querySelector("#startButton");
const staffNote = document.querySelector("#staffNote");
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

// phase: launcher → working → slow → after → leaving → end
const session = {
  phase: "launcher",
  task: null,
  // この体験の「次の予定」。開始時刻は体験ごとに、今の時刻から決める
  meeting: null,
  timers: [],
  nextEventTimer: null,
  toastTimer: null,
};

function timeLabel(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// 開始画面と終わりの画面は全画面、作業中だけはWindowsのタスクバーが見えるウィンドウにする
const setWindowMode = (mode) => bridge?.setWindowMode(mode);

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

// 次の回に使う作業。体験者には選ばせず、開始画面は「はじめる」だけにする
let currentTask = (() => {
  let saved = null;
  try {
    saved = localStorage.getItem(TASK_STORAGE_KEY);
  } catch {
    // 保存できない環境では、いつも最初の作業から
  }
  return tasks.find((task) => task.id === saved) || tasks[0];
})();

// スタッフ用: 次の回に使う作業を順に切り替え、画面の隅に一瞬だけ作業名を出す。体験の途中なら次の回から変わる
function switchTask() {
  currentTask = tasks[(tasks.indexOf(currentTask) + 1) % tasks.length];
  try {
    localStorage.setItem(TASK_STORAGE_KEY, currentTask.id);
  } catch {
    // 覚えておけなくても切り替え自体はできる
  }
  staffNote.textContent = `次の作業: ${currentTask.title}`;
  staffNote.classList.add("show");
  clearTimeout(switchTask.timer);
  switchTask.timer = setTimeout(() => staffNote.classList.remove("show"), 2000);
}

startButton.addEventListener("click", () => startSession(currentTask));

function showLauncher() {
  resetSession();
  setWindowMode("full");
  if (fixedTaskId) {
    startSession(window.EXHIBITION_TASKS.find((task) => task.id === fixedTaskId) || tasks[0]);
    return;
  }
  launcher.classList.remove("hidden");
  startButton.focus();
}

function resetSession() {
  clearSessionTimers();
  session.phase = "launcher";
  session.task = null;
  // 前の回の予定が残っていると、体験していないときに差し込まれてしまうので消しておく
  bridge?.setMeeting(null);
  taskFrame.src = "about:blank";
  toasts.innerHTML = "";
  workWindow.classList.remove("closing");
  meetingReminder.classList.remove("show");
  meetingReminder.classList.add("hidden");
  desktop.classList.add("hidden");
  endCard.classList.add("hidden");
}

// 差し込みの時刻を決め、その5分後を「次の予定」として本物のアプリに渡す。アプリは予定5分前に、自分の判定で全画面で始める。
// アプリは分単位で判定するので、差し込みは「今から minLeadSeconds 秒以上あとの、いちばん近い分の区切り」に置く
// (30秒なら、今の秒が30以下で1分後、31以上で2分後の区切り)。
// immediate(スタッフ用の即時差し込み)のときは、今の分を差し込みの分にして、すぐ始めさせる
function scheduleSlow({ immediate = false } = {}) {
  const now = Date.now();
  const slowStartMs = immediate
    ? Math.floor(now / MINUTE) * MINUTE
    : Math.ceil((now + config.minLeadSeconds * 1000) / MINUTE) * MINUTE;
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
  later(immediate ? 300 : slowStartMs - now + 1500, () => {
    if (session.phase === "working") bridge?.triggerSlow(MEETING_ID);
  });
  renderNextEvent();
}

function startSession(task) {
  resetSession();
  session.task = task;
  session.phase = "working";
  setWindowMode("window");
  launcher.classList.add("hidden");
  desktop.classList.remove("hidden");
  windowTitle.textContent = task.windowTitle;
  workHint.textContent = task.hint;
  taskFrame.src = `../tasks/${task.id}/index.html`;
  taskFrame.addEventListener("load", () => taskFrame.contentWindow.focus(), { once: true });

  scheduleSlow();
  session.nextEventTimer = setInterval(renderNextEvent, 500);
  scheduleToast();
}

// 本物のアプリが全画面になった。作業は裏で届き続ける(現実の仕事は待ってくれない)。通知は全画面の裏で見えないので止めておく
function enterSlow() {
  if (session.phase !== "working") return;
  session.phase = "slow";
  clearTimeout(session.toastTimer);
}

// 戻ると作業は溜まったまま。そこへ次の予定のリマインドが届き、作業を閉じて予定へ向かえる
function leaveSlow() {
  if (session.phase !== "slow") return;
  session.phase = "after";
  taskFrame.focus();
  taskFrame.contentWindow.focus();
  later(config.reminderDelaySeconds * 1000, showMeetingReminder);
  later(config.autoLeaveSeconds * 1000, leaveForMeeting);
}

function showMeetingReminder() {
  if (session.phase !== "after") return;
  meetingReminderText.textContent = `まもなく ${session.meeting.start} ${config.meeting.title}`;
  meetingReminder.classList.remove("hidden");
  requestAnimationFrame(() => requestAnimationFrame(() => meetingReminder.classList.add("show")));
}

// 作業ウィンドウを閉じて、次の予定へ向かう
function leaveForMeeting() {
  if (session.phase !== "after") return;
  session.phase = "leaving";
  clearSessionTimers();
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
  setWindowMode("full");
  endCardTitle.textContent = `${config.meeting.title}へ`;
  endCard.classList.remove("hidden");
  later(config.endCardSeconds * 1000, showLauncher);
}

meetingReminderButton.addEventListener("click", leaveForMeeting);
workClose.addEventListener("click", leaveForMeeting);
endCard.addEventListener("click", showLauncher);

bridge?.onSlowMode((mode) => {
  if (mode === "enter") enterSlow();
  if (mode === "leave") leaveSlow();
});

// 作業ウィンドウ左下の次の予定。予定が迫ると色が変わる(時刻はWindowsのタスクバーの時計に任せる)
function renderNextEvent() {
  const minutesLeft = Math.ceil((session.meeting.startMs - Date.now()) / MINUTE);
  const label = minutesLeft > 0 ? `あと${minutesLeft}分` : "開始";
  nextEvent.textContent = `次の予定 ${session.meeting.start} ${config.meeting.title}・${label}`;
  nextEvent.classList.toggle("soon", minutesLeft <= 6);
}

// 作業中に届く通知。作業と関係なく、ときどき割り込んでくる
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

// スタッフ用キー(main processのbefore-input-eventから届く)
bridge?.onCommand((command) => {
  if (command === "reset") showLauncher();
  if (command === "next-task") switchTask();
  if (command === "trigger" && session.phase === "working") {
    clearSessionTimers();
    session.nextEventTimer = setInterval(renderNextEvent, 500);
    scheduleToast();
    scheduleSlow({ immediate: true });
  }
});

showLauncher();
