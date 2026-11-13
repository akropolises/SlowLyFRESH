// スマホ版:起動するとすぐゆっくリフレッシュが始まり、終わったら霧が晴れて画面が消え、アプリを閉じる。
// 予定やGoogleカレンダー、色選択は使わない。霧の進み方はデスクトップ版(app.js)と同じ
const microSlows = window.MICRO_SLOWS;
const recentSlowsKey = "micro-slow-recent-slows";
const maxSlowDuration = 60;
const MIST_HOLD_MS = 1600;
// 終わったあと、霧が晴れて文字が消えていくのを見届けてから閉じる
const END_FADE_MS = 1200;

const slowView = document.querySelector("#slowView");
const rootEl = document.documentElement;

const state = {
  currentSlow: null,
  timer: null,
  startedAt: 0,
  finished: false,
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

function fadeSlowView(visible, duration) {
  slowView.style.transitionDuration = `${duration}ms`;
  slowView.classList.toggle("fade-out", !visible);
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

  // 呼吸円を先に見せ、テキストは少し遅れてふわっと出す
  const slowText = document.querySelector("#slowText");
  slowText.classList.remove("visible");
  slowView.classList.remove("hidden");
  fadeSlowView(false, 0);
  void slowView.offsetWidth;
  requestAnimationFrame(() => fadeSlowView(true, 700));
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

// 霧が晴れていくのに合わせて文字と呼吸円も消え、消えきったらアプリを閉じる
function finishSlow() {
  if (state.finished) return;
  state.finished = true;
  window.clearInterval(state.timer);
  window.clearTimeout(state.timer);
  document.body.classList.remove("is-slow");
  setMist(0, END_FADE_MS);
  fadeSlowView(false, END_FADE_MS);
  window.setTimeout(closeApp, END_FADE_MS + 200);
}

function closeApp() {
  // Android側(MainActivity)が用意する橋。ブラウザで開いたときは無いので、そのときは何もしない
  window.MicroSlowAndroid?.close?.();
}

document.querySelector("#finishSlowButton").addEventListener("click", finishSlow);

window.addEventListener("resize", () => {
  if (!state.finished) {
    centerMistOnBreathCircle();
  }
});

startSlow();
