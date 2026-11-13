// スマホ版:起動するとすぐゆっくリフレッシュが始まり、色を選び終えたらアプリを閉じる。
// 予定やGoogleカレンダーは使わない。霧の進み方・色選択の演出はデスクトップ版(app.js)と同じ
const microSlows = window.MICRO_SLOWS;
const recentSlowsKey = "micro-slow-recent-slows";
const maxSlowDuration = 60;
const MIST_HOLD_MS = 1600;
const VIEW_FADE_MS = 320;
// 色を選ばないまま置かれたときも、この時間で閉じる
const SENSE_TIMEOUT_MS = 60000;

const senseColorHex = {
  green: "#6f9f89",
  gold: "#d7a447",
  blue: "#668ca8",
  rose: "#c96f61",
};

const views = {
  slow: document.querySelector("#slowView"),
  transition: document.querySelector("#transitionView"),
};
const rootEl = document.documentElement;

const state = {
  view: null,
  currentSlow: null,
  timer: null,
  transitionTimer: null,
  startedAt: 0,
  senseSelected: false,
};

function readRecentSlowIds() {
  try {
    return JSON.parse(localStorage.getItem(recentSlowsKey)) || [];
  } catch {
    return [];
  }
}

function rememberSlow(id) {
  const recent = [id, ...readRecentSlowIds().filter((item) => item !== id)].slice(0, 6);
  try {
    localStorage.setItem(recentSlowsKey, JSON.stringify(recent));
  } catch {
    // 保存できなくても体験には支障がない
  }
}

// 直近に出たものを避けて、ひとつ選ぶ
function pickSlow() {
  const recent = readRecentSlowIds();
  const candidates = microSlows.filter((slow) => !recent.includes(slow.id));
  const pool = candidates.length > 0 ? candidates : microSlows;
  return pool[Math.floor(Math.random() * pool.length)];
}

function showView(name, { fadeMs } = {}) {
  const duration = fadeMs || VIEW_FADE_MS;
  const current = state.view ? views[state.view] : null;
  const next = views[name];

  if (current && current !== next) {
    current.style.transitionDuration = `${duration}ms`;
    current.classList.add("fade-out");
    window.setTimeout(() => {
      current.classList.add("hidden");
      current.classList.remove("fade-out");
      current.style.transitionDuration = "";
    }, duration);
  }

  next.style.transitionDuration = `${duration}ms`;
  next.classList.remove("hidden");
  next.classList.add("fade-out");
  void next.offsetWidth;
  requestAnimationFrame(() => {
    next.classList.remove("fade-out");
    window.setTimeout(() => {
      next.style.transitionDuration = "";
    }, duration);
  });
  state.view = name;
}

function setMist(value, transitionMs) {
  rootEl.style.transition = `--mist ${transitionMs}ms linear`;
  rootEl.style.setProperty("--mist", value.toFixed(3));
}

// 霧の進み具合(app.js と同じ)。ほぼ一定の速さで寄ってきて、わずかなゆらぎで機械的な等速感だけを消す
function mistAmount(elapsed, ratio) {
  const drift = 0.03 * Math.sin(elapsed * 0.9) * Math.sin(elapsed * 0.37) * ratio * (1 - ratio) * 4;
  return Math.min(Math.max(ratio + drift, 0), 1);
}

function centerMistOnBreathCircle() {
  const circleRect = document.querySelector(".breath-circle").getBoundingClientRect();
  const rect = circleRect.width > 0 ? circleRect : document.querySelector("#slowText").getBoundingClientRect();
  rootEl.style.setProperty("--mist-x", `${rect.left + rect.width / 2}px`);
  rootEl.style.setProperty("--mist-y", `${rect.top + rect.height / 2}px`);
}

function startSlow() {
  const slow = pickSlow();
  state.currentSlow = { ...slow, seconds: Math.min(slow.seconds, maxSlowDuration) };
  document.querySelector("#slowTitle").textContent = state.currentSlow.title;
  document.querySelector("#slowInstruction").textContent = state.currentSlow.instruction;
  document.querySelector("#slowDuration").textContent = `最大${state.currentSlow.seconds}秒`;

  const slowText = document.querySelector("#slowText");
  slowText.classList.remove("visible");
  showView("slow", { fadeMs: 700 });
  document.body.classList.add("is-slow");
  centerMistOnBreathCircle();
  window.setTimeout(() => {
    slowText.classList.add("visible");
  }, 500);

  rememberSlow(state.currentSlow.id);
  runProgress();
}

function runProgress() {
  window.clearInterval(state.timer);
  state.startedAt = Date.now();
  setMist(0, 0);
  state.timer = window.setInterval(() => {
    const elapsed = (Date.now() - state.startedAt) / 1000;
    const ratio = Math.min(elapsed / state.currentSlow.seconds, 1);
    if (ratio >= 1) {
      window.clearInterval(state.timer);
      setMist(1, 600);
      state.timer = window.setTimeout(finishSlow, MIST_HOLD_MS);
      return;
    }
    setMist(mistAmount(elapsed, ratio), 300);
  }, 250);
}

// 霧が晴れていくのに合わせて、色選択の画面がゆっくり現れる
function finishSlow() {
  if (state.view !== "slow") return;
  window.clearInterval(state.timer);
  window.clearTimeout(state.timer);
  document.body.classList.remove("is-slow");
  setMist(0, 1200);
  showView("transition", { fadeMs: 900 });
  state.transitionTimer = window.setTimeout(closeApp, SENSE_TIMEOUT_MS);
}

function closeApp() {
  window.clearTimeout(state.transitionTimer);
  // Android側(MainActivity)が用意する橋。ブラウザで開いたときは無いので、そのときは何もしない
  window.MicroSlowAndroid?.close?.();
}

document.querySelector("#finishSlowButton").addEventListener("click", finishSlow);

document.querySelectorAll(".sense-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.senseSelected) return;
    state.senseSelected = true;
    window.clearTimeout(state.transitionTimer);
    const colorKey = button.dataset.sense;

    // 選んだ色が画面中央から円状に広がって消え、それを見届けてからアプリを閉じる
    views.transition.classList.add("is-selecting");
    const senseRow = document.querySelector(".sense-row");
    const ripple = document.createElement("span");
    ripple.className = "sense-ripple";
    ripple.style.background = senseColorHex[colorKey] || "#999999";
    const duration = 900 + Math.random() * 500;
    ripple.style.transitionDuration = `${duration}ms`;
    senseRow.append(ripple);
    void ripple.offsetWidth;
    requestAnimationFrame(() => ripple.classList.add("spread"));

    window.setTimeout(closeApp, duration + 300);
  });
});

window.addEventListener("resize", () => {
  if (state.view === "slow") {
    centerMistOnBreathCircle();
  }
});

startSlow();
