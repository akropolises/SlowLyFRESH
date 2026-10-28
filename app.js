const microSlows = window.MICRO_SLOWS;
const appConfig = window.MICRO_SLOW_CONFIG || window.SLOW_INDEX_CONFIG || {};
const desktop = window.MicroSlowElectron || window.SlowIndexElectron;
const storageKeys = {
  source: "micro-slow-source",
  events: "micro-slow-events",
  onboarded: "micro-slow-onboarded",
  recentSlows: "micro-slow-recent-slows",
  artwork: "micro-slow-artwork",
};

// 出口で選べる感覚色と、キャンバスの滲み描画に使う実際のRGB値の対応表
const senseColorHex = {
  green: "#6f9f89",
  gold: "#d7a447",
  blue: "#668ca8",
  rose: "#c96f61",
};
const legacyStorageKeys = {
  source: "slow-index-source",
  events: "slow-index-events",
  onboarded: "slow-index-onboarded",
  recentSlows: "slow-index-recent-slows",
};

function migrateStorageKey(nextKey, legacyKey) {
  if (localStorage.getItem(nextKey) !== null || localStorage.getItem(legacyKey) === null) {
    return;
  }
  localStorage.setItem(nextKey, localStorage.getItem(legacyKey));
}

migrateStorageKey(storageKeys.source, legacyStorageKeys.source);
migrateStorageKey(storageKeys.events, legacyStorageKeys.events);
migrateStorageKey(storageKeys.onboarded, legacyStorageKeys.onboarded);
migrateStorageKey(storageKeys.recentSlows, legacyStorageKeys.recentSlows);

const storedSource = localStorage.getItem(storageKeys.source);
const storedEvents = readStoredEvents() || [];
const runtimeEvents = storedEvents.filter((event) => event.source !== "sample");
if (runtimeEvents.length !== storedEvents.length) {
  localStorage.setItem(storageKeys.events, JSON.stringify(runtimeEvents));
}

const state = {
  source: storedSource === "manual" ? "manual" : "google",
  events: runtimeEvents,
  dismissed: new Set(),
  // 「余白少」の予定のうち、ユーザーが手動で「届く」にしたもの
  deliverDespiteNoSpace: new Set(),
  recentSlowIds: readRecentSlowIds(),
  onboarded: localStorage.getItem(storageKeys.onboarded) === "true",
  currentProposal: null,
  currentSlow: null,
  timer: null,
  transitionTimer: null,
  schedulerTimer: null,
  googleSyncTimer: null,
  startedAt: 0,
  view: null,
  startedAutomatically: new Set(),
  artwork: readArtworkState(),
  senseSelected: false,
  galleryYear: new Date().getFullYear(),
  galleryMonth: new Date().getMonth(),
};

const maxSlowDuration = 60;
const autoStartWindowMinutes = 1;

const views = {
  onboarding: document.querySelector("#onboardingView"),
  home: document.querySelector("#homeView"),
  slow: document.querySelector("#slowView"),
  transition: document.querySelector("#transitionView"),
  gallery: document.querySelector("#galleryView"),
};

const calendarDay = document.querySelector("#calendarDay");
const todayMeta = document.querySelector("#todayMeta");
const manualForm = document.querySelector("#manualForm");
const googleConnect = document.querySelector("#googleConnect");
const googleStatus = document.querySelector("#googleStatus");
const onboardingStatus = document.querySelector("#onboardingStatus");
const rootEl = document.documentElement;

function readRecentSlowIds() {
  try {
    return JSON.parse(localStorage.getItem(storageKeys.recentSlows)) || [];
  } catch {
    return [];
  }
}

function todayDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 今日のキャンバス(todayDrops)をlocalStorageに保存。日付が変わっていた場合は、前日ぶんをhistoryに確定保存してから、新しい空のキャンバスを始める
function readArtworkState() {
  const today = todayDateKey();
  const fallback = { date: today, todayDrops: [], history: {} };
  try {
    const raw = localStorage.getItem(storageKeys.artwork);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const history = typeof parsed.history === "object" && parsed.history !== null ? parsed.history : {};
    if (parsed.date !== today) {
      if (parsed.date && Array.isArray(parsed.todayDrops) && parsed.todayDrops.length > 0) {
        history[parsed.date] = parsed.todayDrops;
      }
      return { date: today, todayDrops: [], history };
    }
    return { date: parsed.date, todayDrops: Array.isArray(parsed.todayDrops) ? parsed.todayDrops : [], history };
  } catch {
    return fallback;
  }
}

function writeArtworkState() {
  localStorage.setItem(storageKeys.artwork, JSON.stringify(state.artwork));
}

function refreshArtworkDate() {
  const today = todayDateKey();
  if (state.artwork.date === today) {
    return;
  }

  if (state.artwork.date && state.artwork.todayDrops.length > 0) {
    state.artwork.history[state.artwork.date] = state.artwork.todayDrops;
  }
  state.artwork.date = today;
  state.artwork.todayDrops = [];
  writeArtworkState();
}

function randomJitter(range) {
  return (Math.random() - 0.5) * range;
}

// 選んだ色を1滴分のデータとして今日のキャンバスに追加する
function addArtworkDrop(colorKey) {
  refreshArtworkDate();
  const drop = {
    color: colorKey,
    x: 0.5 + randomJitter(0.5),
    y: 0.5 + randomJitter(0.5),
    size: 40 + Math.random() * 50,
  };
  state.artwork.todayDrops.push(drop);
  writeArtworkState();
  return drop;
}

function pseudoRandom(seed) {
  const value = Math.sin(seed) * 43758.5453;
  return value - Math.floor(value);
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

// 1滴の絵の具を、水面に垂らしたインクのように「にじんで歪んだ」見た目にするため、
// 中心をわずかにずらした複数の半透明円を重ねて描画する(React版ArtworkCanvasと同じロジック)。
function drawInkBlot(ctx, drop, canvasSize) {
  const hex = senseColorHex[drop.color] || "#999999";
  const rgb = hexToRgb(hex);
  const seed = drop.x * 97.13 + drop.y * 57.31 + drop.size * 13.7;
  const size = drop.size * (canvasSize / 360);
  const cx = drop.x * canvasSize;
  const cy = drop.y * canvasSize;

  for (let i = 3; i >= 0; i -= 1) {
    const s = seed + i * 19.7;
    const offsetX = (pseudoRandom(s + 1) - 0.5) * size * 0.3;
    const offsetY = (pseudoRandom(s + 2) - 0.5) * size * 0.3;
    const scale = 1 + i * (0.22 + pseudoRandom(s + 3) * 0.12);
    const layerSize = size * scale;
    const opacity = Math.max(0.32 - i * 0.06 + pseudoRandom(s + 5) * 0.05, 0.05);

    ctx.beginPath();
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
    ctx.arc(cx + offsetX, cy + offsetY, layerSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderDropsOnCanvas(canvasEl, drops) {
  const size = canvasEl.clientWidth || canvasEl.width;
  if (!size) return;
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width = size * dpr;
  canvasEl.height = size * dpr;
  const ctx = canvasEl.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  drops.forEach((drop) => drawInkBlot(ctx, drop, size));
}

function dateKeyFor(year, month, day) {
  return `${year}-${(month + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function dropsForDateKey(key) {
  if (key === state.artwork.date) {
    return state.artwork.todayDrops;
  }
  return state.artwork.history[key] || [];
}

// 月間カレンダー風のギャラリー。各日のセルに、その日のキャンバスをそのまま小さく描画する
// ギャラリーで表示・月送りできるのは2026年1月〜現在月のみ
const GALLERY_MIN_MONTH_KEY = "2026-01";
const GALLERY_MAX_MONTH_KEY = galleryMonthKey(new Date().getFullYear(), new Date().getMonth());

function galleryMonthKey(year, month) {
  return `${year}-${(month + 1).toString().padStart(2, "0")}`;
}

function renderGallery() {
  const galleryTitle = document.querySelector("#galleryTitle");
  const galleryGrid = document.querySelector("#galleryGrid");
  const galleryPrevButton = document.querySelector("#galleryPrevButton");
  const galleryNextButton = document.querySelector("#galleryNextButton");
  const { galleryYear, galleryMonth } = state;
  const monthKey = galleryMonthKey(galleryYear, galleryMonth);

  galleryTitle.textContent = `${galleryYear}年${galleryMonth + 1}月`;
  galleryGrid.innerHTML = "";
  galleryPrevButton.disabled = monthKey <= GALLERY_MIN_MONTH_KEY;
  galleryNextButton.disabled = monthKey >= GALLERY_MAX_MONTH_KEY;

  const firstWeekday = new Date(galleryYear, galleryMonth, 1).getDay();
  const daysInMonth = new Date(galleryYear, galleryMonth + 1, 0).getDate();
  const todayKey = todayDateKey();

  for (let i = 0; i < firstWeekday; i += 1) {
    const filler = document.createElement("div");
    filler.className = "gallery-day empty";
    galleryGrid.append(filler);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKeyFor(galleryYear, galleryMonth, day);
    const drops = dropsForDateKey(key);
    const isToday = key === todayKey;
    const isPastOrToday = key <= todayKey;
    const cell = document.createElement("div");
    cell.className = `gallery-day${isToday ? " is-today" : ""}`;

    const number = document.createElement("span");
    number.className = "gallery-day-number";
    number.textContent = day;
    cell.append(number);

    // 今日まで(未来は除く)は、記録が0件でも開けるようにする
    if (drops.length > 0 || isPastOrToday) {
      cell.classList.add("has-drops");
      cell.dataset.dateKey = key;
      if (drops.length > 0) {
        const canvas = document.createElement("canvas");
        cell.append(canvas);
        galleryGrid.append(cell);
        requestAnimationFrame(() => renderDropsOnCanvas(canvas, drops));
      } else {
        galleryGrid.append(cell);
      }
    } else {
      galleryGrid.append(cell);
    }
  }
}

function openGalleryDay(key) {
  const drops = dropsForDateKey(key);
  const [year, month, day] = key.split("-").map(Number);
  document.querySelector("#galleryDayLabel").textContent = `${year}年${month}月${day}日`;
  document.querySelector("#galleryDayOverlay").classList.remove("hidden");
  const canvas = document.querySelector("#galleryDayCanvas");
  const emptyNote = document.querySelector("#galleryDayEmptyNote");
  if (drops.length > 0) {
    canvas.classList.remove("hidden");
    emptyNote.classList.add("hidden");
    requestAnimationFrame(() => renderDropsOnCanvas(canvas, drops));
  } else {
    canvas.classList.add("hidden");
    emptyNote.classList.remove("hidden");
    emptyNote.textContent = key === todayDateKey() ? "まだ何も描かれていません" : "この日の記録はありません";
  }
}

function closeGalleryDay() {
  document.querySelector("#galleryDayOverlay").classList.add("hidden");
}

function changeGalleryMonth(delta) {
  const monthKey = galleryMonthKey(state.galleryYear, state.galleryMonth);
  if (delta < 0 && monthKey <= GALLERY_MIN_MONTH_KEY) return;
  if (delta > 0 && monthKey >= GALLERY_MAX_MONTH_KEY) return;
  const next = new Date(state.galleryYear, state.galleryMonth + delta, 1);
  state.galleryYear = next.getFullYear();
  state.galleryMonth = next.getMonth();
  renderGallery();
}

function readStoredEvents() {
  try {
    return JSON.parse(localStorage.getItem(storageKeys.events));
  } catch {
    return null;
  }
}

function writeStoredEvents() {
  localStorage.setItem(storageKeys.events, JSON.stringify(state.events));
}

function rememberSlow(id) {
  state.recentSlowIds = [id, ...state.recentSlowIds.filter((item) => item !== id)].slice(0, 6);
  localStorage.setItem(storageKeys.recentSlows, JSON.stringify(state.recentSlowIds));
}

function minutesFromTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isCurrentEvent(event, minutes = nowMinutes()) {
  const start = minutesFromTime(event.start);
  const end = start + Number(event.duration);
  return start <= minutes && minutes < end;
}

function isUpcomingSoon(event, minutes = nowMinutes()) {
  const start = minutesFromTime(event.start);
  const diff = start - minutes;
  return diff >= 0 && diff <= (appConfig.upcomingWindowMinutes || 7);
}

function getActivePrompt() {
  if (state.events.some((event) => isCurrentEvent(event))) {
    return null;
  }

  const upcoming = state.events
    .filter((event) => !state.dismissed.has(event.id) && isUpcomingSoon(event))
    .sort((a, b) => minutesFromTime(a.start) - minutesFromTime(b.start))[0];

  if (!upcoming) {
    return null;
  }

  const index = state.events.findIndex((event) => event.id === upcoming.id);
  return buildProposalForEvent(upcoming, index);
}

function selectSlowForEvent(event, index) {
  const eventSeed = minutesFromTime(event.start) + event.title.length + index;
  const ordered = microSlows
    .map((slow, slowIndex) => ({
      slow,
      score: (slowIndex * 7 + eventSeed) % microSlows.length,
    }))
    .sort((a, b) => a.score - b.score)
    .map((item) => item.slow);

  return ordered.find((slow) => !state.recentSlowIds.includes(slow.id)) || ordered[0];
}

// 予定開始5分前の時点で、前の予定がまだ続いていなければ余白あり
function hasPreEventSpace(event) {
  const startMinutes = minutesFromTime(event.start);
  const slowStart = startMinutes - 5;
  return !state.events
    .filter((candidate) => candidate.id !== event.id)
    .some((candidate) => {
      const candidateStart = minutesFromTime(candidate.start);
      const candidateEnd = candidateStart + Number(candidate.duration);
      return candidateStart < startMinutes && candidateEnd > slowStart;
    });
}

// 自動で届く設定か。余白ありは既定で「届く」(見送り可)、余白少は既定で届かず、手動で「届く」にできる
function isAutoEnabled(proposal) {
  if (state.dismissed.has(proposal.id)) {
    return false;
  }
  return proposal.hasSpace || state.deliverDespiteNoSpace.has(proposal.id);
}

function buildProposalForEvent(event, index) {
  const startMinutes = minutesFromTime(event.start);
  const slowStart = startMinutes - 5;
  return {
    id: event.id,
    event,
    slow: selectSlowForEvent(event, index),
    slowStart: timeFromMinutes(slowStart),
    slowStartMinutes: slowStart,
    eventStartMinutes: startMinutes,
    hasSpace: hasPreEventSpace(event),
  };
}

const VIEW_FADE_MS = 320;
const mainEl = document.querySelector("main");

// 番組の切り替えもフェードで行う(ページめくりのような明確な切り替えを避け、穏やかに切り替わる)
// fadeMsを指定すると、その画面だけフェードをゆっくりにできる(Slow画面への突入を穏やかにするため)
function showView(name, { fadeMs } = {}) {
  const duration = fadeMs || VIEW_FADE_MS;
  const current = state.view ? views[state.view] : null;
  const next = views[name];

  if (current && current !== next) {
    // 画面ごとに高さが違うと、切り替え時に背景の四角がカクッと伸縮して見えるため、
    // 遷移中はmainの高さを一旦固定し、次の画面の高さへ滑らかにアニメーションさせる
    mainEl.style.minHeight = `${mainEl.getBoundingClientRect().height}px`;

    current.style.transitionDuration = `${duration}ms`;
    current.classList.add("fade-out");
    window.setTimeout(() => {
      current.classList.add("hidden");
      current.classList.remove("fade-out");
      current.style.transitionDuration = "";
    }, duration);
  }

  Object.values(views).forEach((view) => {
    if (view !== current) {
      view.classList.add("hidden");
    }
  });

  next.style.transitionDuration = `${duration}ms`;
  next.classList.remove("hidden");
  next.classList.add("fade-out");
  void next.offsetWidth;
  requestAnimationFrame(() => {
    next.classList.remove("fade-out");
    if (current && current !== next) {
      const targetHeight = next.scrollHeight;
      requestAnimationFrame(() => {
        mainEl.style.minHeight = `${targetHeight}px`;
      });
      window.setTimeout(() => {
        mainEl.style.minHeight = "";
        next.style.transitionDuration = "";
      }, duration);
    } else {
      window.setTimeout(() => {
        next.style.transitionDuration = "";
      }, duration);
    }
  });
  state.view = name;
}

function activateSource(source) {
  state.source = source;
  localStorage.setItem(storageKeys.source, source);
  document.querySelectorAll(".toggle-button").forEach((item) => {
    item.classList.toggle("active", item.dataset.source === source);
  });
  manualForm.classList.toggle("hidden", source !== "manual");
  googleConnect.classList.toggle("hidden", source !== "google");
}

function replaceEventsFromGoogle(events) {
  const localEvents = state.events.filter((event) => event.source === "manual");
  state.events = [...events, ...localEvents].sort((a, b) => minutesFromTime(a.start) - minutesFromTime(b.start));
  writeStoredEvents();
  const eventIds = new Set(state.events.map((event) => event.id));
  state.dismissed = new Set([...state.dismissed].filter((id) => eventIds.has(id)));
  state.deliverDespiteNoSpace = new Set([...state.deliverDespiteNoSpace].filter((id) => eventIds.has(id)));
  state.startedAutomatically = new Set([...state.startedAutomatically].filter((id) => eventIds.has(id)));
  activateSource("google");
  syncReminderBackends();
}

function completeOnboarding(source = "google") {
  state.onboarded = true;
  localStorage.setItem(storageKeys.onboarded, "true");
  activateSource(source);
  showView("home");
  renderHome();
}

function renderHome() {
  const proposals = state.events.map(buildProposalForEvent);
  const activePrompt = getActivePrompt();
  const availableCount = proposals.filter(isAutoEnabled).length;
  todayMeta.textContent = activePrompt
    ? `${activePrompt.event.title} がもうすぐ始まります`
    : state.events.length === 0
      ? "今日の予定はまだありません"
      : availableCount > 0
        ? `${availableCount}件は、5分前にゆっくリフレッシュします`
        : "ゆっくリフレッシュする予定はありません";
  calendarDay.innerHTML = "";

  if (activePrompt) {
    const prompt = document.createElement("article");
    prompt.className = "active-prompt";
    prompt.innerHTML = `
      <div>
        <p class="eyebrow">ゆっくリフレッシュ 提案</p>
        <h3>${activePrompt.event.start} ${activePrompt.event.title}</h3>
        <p>${Math.min(activePrompt.slow.seconds, maxSlowDuration)}秒だけ整える。</p>
      </div>
      <button class="primary-button" data-action="start" data-id="${activePrompt.id}" type="button">はじめる</button>
    `;
    calendarDay.append(prompt);
  }

  if (state.events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<p>今日の予定はまだありません</p>";
    calendarDay.append(empty);
    return;
  }

  proposals.forEach((proposal) => {
    const eventEnd = timeFromMinutes(minutesFromTime(proposal.event.start) + Number(proposal.event.duration));
    const isDismissed = state.dismissed.has(proposal.id);
    const autoLabel = isAutoEnabled(proposal) ? "届く" : proposal.hasSpace ? "見送る" : "余白少";
    const item = document.createElement("article");
    item.className = `calendar-event${isDismissed ? " dismissed" : ""}`;
    item.innerHTML = `
      <div class="event-time">
        <span>${proposal.event.start}</span>
        <span>${eventEnd}</span>
      </div>
      <button class="event-card" data-action="start" data-id="${proposal.id}" type="button">
        <span class="event-title">${proposal.event.title}</span>
        <span class="event-subtext">ゆっくリフレッシュ ${proposal.slowStart}〜（${Math.min(proposal.slow.seconds, maxSlowDuration)}秒）</span>
      </button>
      <button class="event-badge${isAutoEnabled(proposal) ? "" : " disabled"}" data-action="toggle-auto" data-id="${proposal.id}" type="button">${autoLabel}</button>
      <button class="dismiss-event" data-action="delete" data-id="${proposal.event.id}" type="button" aria-label="${proposal.event.title}を削除">×</button>
    `;
    calendarDay.append(item);
  });
}

function startSlow(proposalId, options = {}) {
  const proposal = state.events.map(buildProposalForEvent).find((item) => item.id === proposalId);
  if (!proposal) return;
  if (options.fromExternalTrigger) {
    state.startedAutomatically.add(proposal.id);
  }

  state.currentProposal = proposal;
  state.currentSlow = {
    ...proposal.slow,
    seconds: Math.min(proposal.slow.seconds, maxSlowDuration),
  };
  document.querySelector("#slowTitle").textContent = state.currentSlow.title;
  document.querySelector("#slowInstruction").textContent = state.currentSlow.instruction;
  document.querySelector("#slowDuration").textContent = `最大${state.currentSlow.seconds}秒`;

  // 呼吸円だけを先に見せ、テキストは少し遅れてふわっと出す(自動起動時も含め、突然全部が現れる驚きを和らげる)
  const slowText = document.querySelector("#slowText");
  slowText.classList.remove("visible");
  showView("slow", { fadeMs: 700 });
  document.body.classList.add("is-slow");
  centerMistOnBreathCircle();
  window.setTimeout(() => {
    slowText.classList.add("visible");
  }, 500);

  desktop?.enterSlowMode?.();
  rememberSlow(state.currentSlow.id);
  runProgress();
}

function startSlowFromExternalTrigger(proposalId) {
  if (state.view === "slow" || state.view === "transition") {
    return;
  }

  const proposal = state.events.map(buildProposalForEvent).find((item) => item.id === proposalId);
  if (!proposal || !isAutoStartDue(proposal)) {
    return;
  }

  startSlow(proposalId, { fromExternalTrigger: true });
}

function buildDesktopReminders() {
  const now = Date.now();
  return state.events
    .map(buildProposalForEvent)
    .filter(isAutoEnabled)
    .map((proposal) => {
      const dueAt = new Date();
      dueAt.setHours(Math.floor(proposal.slowStartMinutes / 60), proposal.slowStartMinutes % 60, 0, 0);
      return {
        id: proposal.id,
        eventTitle: proposal.event.title,
        seconds: Math.min(proposal.slow.seconds, maxSlowDuration),
        dueAt: dueAt.toISOString(),
      };
    })
    .filter((reminder) => new Date(reminder.dueAt).getTime() > now);
}

function syncDesktopReminders() {
  if (!desktop?.setReminders) {
    return;
  }

  desktop.setReminders(buildDesktopReminders()).catch((error) => {
    console.error("Desktop reminder sync failed.", error);
  });
}

function syncReminderBackends() {
  syncDesktopReminders();
}

// 自動開始の条件:今どの予定の最中でもなく、この予定が次の予定で、現在がその5分前(開始時刻から1分未満)であること。
// renderer側のポーリングとmain processのタイマーの両方がこの判定を通る
function isAutoStartDue(proposal, minutes = nowMinutes()) {
  if (!state.onboarded || state.view === "onboarding" || state.view === "slow" || state.view === "transition") {
    return false;
  }

  // 余白少を手動で「届く」にした予定は、前の予定の最中でも届ける
  if (proposal.hasSpace && state.events.some((event) => isCurrentEvent(event, minutes))) {
    return false;
  }

  const hasEarlierUpcomingEvent = state.events.some((event) => {
    const start = minutesFromTime(event.start);
    return minutes <= start && start < proposal.eventStartMinutes;
  });

  return (
    isAutoEnabled(proposal) &&
    !hasEarlierUpcomingEvent &&
    !state.startedAutomatically.has(proposal.id) &&
    proposal.slowStartMinutes <= minutes &&
    minutes < proposal.slowStartMinutes + autoStartWindowMinutes
  );
}

function getDueStartProposal(minutes = nowMinutes()) {
  return state.events
    .map(buildProposalForEvent)
    .filter((proposal) => isAutoStartDue(proposal, minutes))
    .sort((a, b) => a.eventStartMinutes - b.eventStartMinutes)[0] || null;
}

function startDueSlow() {
  const proposal = getDueStartProposal();
  if (!proposal) {
    if (state.view === "home") {
      renderHome();
    }
    return;
  }

  state.startedAutomatically.add(proposal.id);
  startSlow(proposal.id);
}

function bootDesktopRuntime() {
  renderHome();
}

function startAutoStartScheduler() {
  window.clearInterval(state.schedulerTimer);
  state.schedulerTimer = window.setInterval(startDueSlow, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      startDueSlow();
    }
  });
  startDueSlow();
}

function startGoogleAutoSync() {
  window.clearTimeout(state.googleSyncTimer);
  if (!desktop?.isElectron) {
    return;
  }

  const syncIfAvailable = () => {
    if (!state.onboarded || state.source !== "google" || state.view === "slow" || state.view === "transition") {
      return;
    }
    loadGoogleEvents();
  };
  const scheduleNextHourlySync = () => {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    state.googleSyncTimer = window.setTimeout(() => {
      syncIfAvailable();
      scheduleNextHourlySync();
    }, nextHour.getTime() - now.getTime());
  };

  syncIfAvailable();
  scheduleNextHourlySync();
}

function reloadCurrentSource() {
  if (state.source === "google") {
    loadGoogleEvents();
    return;
  }
  renderHome();
}

function setMist(value, transitionMs) {
  rootEl.style.transition = `--mist ${transitionMs}ms linear`;
  rootEl.style.setProperty("--mist", value.toFixed(3));
}

// 霧の進み具合を経過時間から決める。霧は画面の端から呼吸円へほぼ一定の速さで寄ってくるので、
// 秒数は見えなくても「あとどのくらいで包まれるか」は感覚的にわかる。わずかなゆらぎで機械的な等速感だけを消す。
// 最大秒数で霧の縁が呼吸円に届いて完全に包まれ、ひと呼吸おいてから終わる
function mistAmount(elapsed, ratio) {
  const drift = 0.03 * Math.sin(elapsed * 0.9) * Math.sin(elapsed * 0.37) * ratio * (1 - ratio) * 4;
  return Math.min(Math.max(ratio + drift, 0), 1);
}

// 霧が寄ってくる中心を呼吸円に合わせる(呼吸円を表示していないときは文章に合わせる)
function centerMistOnBreathCircle() {
  const circleRect = document.querySelector(".breath-circle").getBoundingClientRect();
  const rect = circleRect.width > 0 ? circleRect : document.querySelector("#slowText").getBoundingClientRect();
  rootEl.style.setProperty("--mist-x", `${rect.left + rect.width / 2}px`);
  rootEl.style.setProperty("--mist-y", `${rect.top + rect.height / 2}px`);
}

const MIST_HOLD_MS = 1600;

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

function finishSlow() {
  window.clearInterval(state.timer);
  window.clearTimeout(state.timer);
  window.clearTimeout(state.transitionTimer);
  // 霧が晴れていくのに合わせて、色選択の画面がゆっくり現れる
  document.body.classList.remove("is-slow");
  setMist(0, 1200);
  const event = state.currentProposal?.event;
  if (event) {
    state.dismissed.add(event.id);
  }
  state.senseSelected = false;
  views.transition.classList.remove("is-selecting");
  document.querySelectorAll(".sense-button").forEach((item) => item.classList.remove("selected"));
  document.querySelectorAll(".sense-ripple").forEach((ripple) => ripple.remove());
  showView("transition", { fadeMs: 900 });
  state.transitionTimer = window.setTimeout(completeTransition, 60000);
}

function completeTransition() {
  window.clearTimeout(state.transitionTimer);
  showView("home");
  renderHome();
  desktop?.leaveSlowMode?.();
}

function handleProposalAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  if (button.dataset.action === "start") {
    startSlow(id);
  }
  if (button.dataset.action === "toggle-auto") {
    const proposal = state.events.map(buildProposalForEvent).find((item) => item.id === id);
    if (!proposal) return;
    if (isAutoEnabled(proposal)) {
      state.dismissed.add(id);
      state.deliverDespiteNoSpace.delete(id);
    } else {
      state.dismissed.delete(id);
      state.startedAutomatically.delete(id);
      if (!proposal.hasSpace) {
        state.deliverDespiteNoSpace.add(id);
      }
    }
    syncReminderBackends();
    renderHome();
  }
  if (button.dataset.action === "delete") {
    state.events = state.events.filter((item) => item.id !== id);
    state.dismissed.delete(id);
    state.deliverDespiteNoSpace.delete(id);
    state.startedAutomatically.delete(id);
    writeStoredEvents();
    syncReminderBackends();
    renderHome();
  }
}

function addManualEvent(event) {
  event.preventDefault();
  const title = document.querySelector("#eventTitleInput").value.trim() || "予定";
  const start = document.querySelector("#eventTimeInput").value;
  const duration = Number(document.querySelector("#eventDurationInput").value);
  state.events.push({
    id: `manual-${Date.now()}`,
    title,
    start,
    duration,
    source: "manual",
  });
  state.events.sort((a, b) => minutesFromTime(a.start) - minutesFromTime(b.start));
  writeStoredEvents();
  syncReminderBackends();
  renderHome();
}

function getGoogleLoadErrorMessage(error) {
  const message = error?.message || "";
  if (message.includes("client_secret is missing")) {
    return "このGoogle OAuth ClientではClient Secretが必要です。config.local.jsにgoogleClientSecretを設定してから起動してください。";
  }
  return message;
}

async function loadGoogleEvents() {
  googleStatus.textContent = "Google Calendarを読み込んでいます。";
  onboardingStatus.classList.add("hidden");
  try {
    if (!desktop?.loadGoogleEvents) {
      throw new Error("Electron Google Calendar bridge is not available.");
    }

    const events = await desktop.loadGoogleEvents({
      googleClientId: appConfig.googleClientId,
      googleClientSecret: appConfig.googleClientSecret,
      googleCalendarId: appConfig.googleCalendarId,
      googleCalendarIds: appConfig.googleCalendarIds,
    });
    replaceEventsFromGoogle(events);
    googleStatus.textContent = `${events.length}件の予定を読み込みました。`;
    if (!state.onboarded) {
      completeOnboarding("google");
    }
    renderHome();
  } catch (error) {
    const message = getGoogleLoadErrorMessage(error);
    const detail = message ? ` ${message}` : "";
    googleStatus.textContent = `Google Calendarを読み込めませんでした。${detail}`;
    onboardingStatus.textContent = `Google Calendarを読み込めませんでした。${detail}`;
    onboardingStatus.classList.remove("hidden");
    console.error(error);
  }
}

// Google連携を解除する。Google側の許可を取り消し、読み込んだGoogleの予定も端末から消す。
// Googleのままだと毎時の自動同期がログインを求めてしまうため、手入力に切り替える
async function disconnectGoogle() {
  if (!window.confirm("Google連携を解除しますか。読み込んだGoogle Calendarの予定はこの端末から消えます。")) {
    return;
  }

  const result = await desktop?.revokeGoogleAuth?.();
  state.events = state.events.filter((event) => event.source !== "google");
  writeStoredEvents();
  const eventIds = new Set(state.events.map((event) => event.id));
  state.dismissed = new Set([...state.dismissed].filter((id) => eventIds.has(id)));
  state.deliverDespiteNoSpace = new Set([...state.deliverDespiteNoSpace].filter((id) => eventIds.has(id)));
  state.startedAutomatically = new Set([...state.startedAutomatically].filter((id) => eventIds.has(id)));
  googleStatus.textContent = "Google連携を解除しました。";
  if (result?.revoked === false) {
    // オフラインなどでGoogle側の取り消しに失敗した場合だけ、利用者に手動での取り消しを案内する
    window.alert("この端末の連携情報は消しましたが、Google側の許可を取り消せませんでした。Googleアカウントの「サードパーティ製のアプリとサービス」から取り消してください。");
  }
  activateSource("manual");
  syncReminderBackends();
  renderHome();
}

document.querySelector("#calendarDay").addEventListener("click", handleProposalAction);
document.querySelector("#finishSlowButton").addEventListener("click", finishSlow);
document.querySelector("#reloadButton").addEventListener("click", reloadCurrentSource);
document.querySelector("#googleConnectButton").addEventListener("click", loadGoogleEvents);
document.querySelector("#googleDisconnectButton").addEventListener("click", disconnectGoogle);
document.querySelectorAll(".privacy-link").forEach((button) => {
  button.addEventListener("click", () => desktop?.openPrivacyPolicy?.());
});
document.querySelector("#onboardingGoogleButton").addEventListener("click", loadGoogleEvents);
document.querySelector("#onboardingManualButton").addEventListener("click", () => {
  completeOnboarding("manual");
});
document.querySelector("#galleryButton").addEventListener("click", () => {
  state.galleryYear = new Date().getFullYear();
  state.galleryMonth = new Date().getMonth();
  showView("gallery");
  renderGallery();
});
document.querySelector("#galleryPrevButton").addEventListener("click", () => changeGalleryMonth(-1));
document.querySelector("#galleryNextButton").addEventListener("click", () => changeGalleryMonth(1));
document.querySelector("#galleryBackButton").addEventListener("click", () => {
  showView("home");
  renderHome();
});
document.querySelector("#galleryGrid").addEventListener("click", (event) => {
  const cell = event.target.closest(".gallery-day.has-drops");
  if (!cell) return;
  openGalleryDay(cell.dataset.dateKey);
});
document.querySelector("#galleryDayCloseButton").addEventListener("click", closeGalleryDay);
document.querySelector("#galleryDayOverlay").addEventListener("click", (event) => {
  if (event.target.id === "galleryDayOverlay") {
    closeGalleryDay();
  }
});
document.querySelectorAll(".toggle-button").forEach((button) => {
  button.addEventListener("click", () => {
    activateSource(button.dataset.source);
  });
});

document.querySelectorAll(".sense-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.senseSelected) return;
    state.senseSelected = true;
    const colorKey = button.dataset.sense;
    addArtworkDrop(colorKey);

    // 畑中アプリのColorExitScreenを踏襲:選んだ色はボタンの位置ではなく画面中央から円状に広がって消える。
    // 選択と同時にパレットを隠し、波紋だけの画面にする
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

    window.setTimeout(() => {
      completeTransition();
    }, duration);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGalleryDay();
    return;
  }
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  if (state.view === "slow") {
    finishSlow();
  } else if (state.view === "transition") {
    completeTransition();
  }
});

// 自動開始時はウィンドウが全画面に切り替わるため、呼吸円の位置が変わったら霧の中心も合わせ直す
window.addEventListener("resize", () => {
  if (state.view === "slow") {
    centerMistOnBreathCircle();
  }
});

manualForm.addEventListener("submit", addManualEvent);
if (state.onboarded) {
  activateSource(state.source);
  showView("home");
  renderHome();
} else {
  showView("onboarding");
}
bootDesktopRuntime();
startAutoStartScheduler();
startGoogleAutoSync();
if (desktop?.isElectron) {
  desktop.onStartSlow(startSlowFromExternalTrigger);
}
syncReminderBackends();
