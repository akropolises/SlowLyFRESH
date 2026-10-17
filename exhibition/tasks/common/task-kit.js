// 作業ページの共通部品。シェルからの一時停止・再開を受け取り、止められるタイマーを提供する。
// 作業はスコアやゴールを持たない。止められても失うものがないよう、状態はそのまま保ち、再開すれば続きから進む。
(() => {
  let paused = false;
  const pauseListeners = [];
  const resumeListeners = [];
  const timers = new Set();

  // 一時停止中は時間が進まないタイマー。止めた時点の残り時間を覚えておき、再開時にその分だけ待つ
  function createTimer(fn, delayMs) {
    const timer = { fn, remaining: delayMs, startedAt: 0, handle: null, done: false };
    const run = () => {
      timer.startedAt = Date.now();
      timer.handle = setTimeout(() => {
        timer.done = true;
        timers.delete(timer);
        fn();
      }, timer.remaining);
    };
    timer.pause = () => {
      clearTimeout(timer.handle);
      timer.remaining = Math.max(timer.remaining - (Date.now() - timer.startedAt), 0);
    };
    timer.resume = run;
    timer.cancel = () => {
      clearTimeout(timer.handle);
      timers.delete(timer);
    };
    timers.add(timer);
    if (!paused) run();
    return timer;
  }

  const randomBetween = (min, max) => min + Math.random() * (max - min);

  const TaskKit = {
    get paused() {
      return paused;
    },

    after(delayMs, fn) {
      return createTimer(fn, delayMs);
    },

    // minMs〜maxMsのばらついた間隔でfnを呼び続ける。機械的な等間隔にしないことで「次々に来る」感じを出す
    every(minMs, maxMs, fn) {
      let current = null;
      let stopped = false;
      const schedule = () => {
        current = createTimer(() => {
          if (stopped) return;
          fn();
          schedule();
        }, randomBetween(minMs, maxMs));
      };
      schedule();
      return {
        stop() {
          stopped = true;
          current?.cancel();
        },
      };
    },

    // 直前と同じものが続かないように選ぶ
    picker(items) {
      let last = null;
      return () => {
        const candidates = items.length > 1 ? items.filter((item) => item !== last) : items;
        last = candidates[Math.floor(Math.random() * candidates.length)];
        return last;
      };
    },

    randomBetween,

    onPause(callback) {
      pauseListeners.push(callback);
    },

    onResume(callback) {
      resumeListeners.push(callback);
    },
  };

  function setPaused(next) {
    if (paused === next) return;
    paused = next;
    document.documentElement.classList.toggle("is-paused", paused);
    timers.forEach((timer) => (paused ? timer.pause() : timer.resume()));
    (paused ? pauseListeners : resumeListeners).forEach((callback) => callback());
  }

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.source !== "exhibit-shell") return;
    if (message.type === "pause") setPaused(true);
    if (message.type === "resume") {
      setPaused(false);
      window.focus();
    }
  });

  window.TaskKit = TaskKit;
})();
