// 展示で体験前に見せるコンセプト動画の台本。録画開始(t0)からの経過秒で場面を進める。
// この動画だけを見て体験できるよう、「何のアプリか」「作業中に突然はじまること」「何をすればよいか」
// 「Enterですぐ戻れること」「最後に色を選ぶこと」「4分前には終わること」だけを、ひとつずつゆっくり伝える。
const SLOW_RATE = 3; // 画面内のゆっくリフレッシュを少し早送りし、霧の進みを見せる

// 縦長版(縦置きのディスプレイ向け)はレイアウトだけを切り替え、台本は横長と共通にする
const searchParams = new URLSearchParams(location.search);
if (searchParams.get("orientation") === "portrait") {
  document.documentElement.classList.add("portrait");
  if (searchParams.get("rotate") === "1") {
    document.documentElement.classList.add("rotated");
  }
}

const headline = document.querySelector("#headline");
const headlineMain = headline.querySelector(".main");
const headlineSub = headline.querySelector(".sub");
const layers = {
  fast: document.querySelector("#fastLayer"),
  name: document.querySelector("#nameLayer"),
  timeline: document.querySelector("#timelineLayer"),
  screen: document.querySelector("#screenLayer"),
};
const timeline = document.querySelector("#timeline");
const screenApp = document.querySelector("#screenApp");
const appFrame = document.querySelector("#appFrame");
const keycap = document.querySelector("#keycap");
const workText = document.querySelector("#workText");
const appKind = document.querySelector("#appKind");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snap = (name) => window.demoBridge?.snap(name);

let t0 = 0;
const elapsed = () => (Date.now() - t0) / 1000;
const until = (seconds) => sleep(Math.max(seconds - elapsed(), 0) * 1000);

function showLayers(...names) {
  Object.entries(layers).forEach(([key, layer]) => layer.classList.toggle("show", names.includes(key)));
}

async function setHeadline(main, sub = "", position = "top") {
  if (headline.classList.contains("show")) {
    headline.classList.remove("show");
    await sleep(1000);
  }
  // 「｜」は縦長のときだけ改行する位置
  headlineMain.innerHTML = main.replace(/｜/g, '<br class="pbr">');
  headlineSub.innerHTML = sub;
  headline.classList.remove("center", "top");
  headline.classList.add(position);
  void headline.offsetWidth;
  headline.classList.add("show");
}

function hideHeadline() {
  headline.classList.remove("show");
}

// 作業中の打ち込み。typing中はカーソルを点滅させず、手が止まると点滅させる
const workTextFull = "・展示ブースの配置を確認する\n・説明パネルの文言を短くする\n・来場者アンケートの項目を3つに絞る\n・当日の受付の流れを決める";
let typedLength = 0;
let typingActive = false;

function renderWorkText(blink) {
  const text = workTextFull.slice(0, typedLength).replace(/</g, "&lt;");
  workText.innerHTML = `${text}<span class="caret${blink ? " blink" : ""}"></span>`;
}

async function typeWork() {
  typingActive = true;
  while (typingActive && typedLength < workTextFull.length) {
    typedLength += 1;
    renderWorkText(false);
    const typed = workTextFull[typedLength - 1];
    await sleep(typed === "\n" ? 650 : 120 + Math.random() * 110);
  }
  renderWorkText(true);
}

function stopTyping() {
  typingActive = false;
}

// アプリとのやりとり(画面内に本物のアプリを動かす)
const appFrameMessage = (message) => appFrame.contentWindow.postMessage({ source: "demo-stage", ...message }, "*");
const appWaiters = { enter: [], leave: [] };
window.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.source !== "demo-app") return;
  if (message.type === "enter") {
    // 実アプリと同じく、作業画面の上に0.5秒でふわっと出る
    stopTyping();
    screenApp.style.transition = "opacity 500ms linear";
    screenApp.style.opacity = "1";
  }
  if (message.type === "leave") {
    screenApp.style.transition = "opacity 400ms linear";
    screenApp.style.opacity = "0";
  }
  appWaiters[message.type]?.splice(0).forEach((resolve) => resolve());
});
const waitForApp = (type) => new Promise((resolve) => appWaiters[type].push(resolve));

async function pressEnter() {
  keycap.classList.add("pressed");
  appFrameMessage({ type: "key", key: "Enter" });
  await sleep(180);
  keycap.classList.remove("pressed");
}

async function runTimeline() {
  // もっと速く、もっと多く、もっと効率よく(0〜8秒)
  const words = [...layers.fast.querySelectorAll(".fast-word")];
  for (const [index, word] of words.entries()) {
    await until(0.8 + index * 1.2);
    word.classList.add("show");
  }
  await until(4.6);
  snap("c01-fast");
  // 「もっと速く…」はアプリの約束ではなく見る人の日常なので、言葉が消えるのと入れ替わりに「そんな毎日に」と受ける
  await until(6.4);
  words.forEach((word) => word.classList.add("blur"));

  // 何のためのものか(7〜16秒)
  await until(7);
  await setHeadline("そんな毎日に、ちょうどよい遅さを。", "", "center");
  await until(9);
  showLayers("name");
  await until(10.8);
  appKind.classList.add("show");
  await until(13);
  snap("c02-concept");
  await until(16);
  hideHeadline();
  showLayers();

  // 作業中に、突然はじまる(17〜31秒)
  await until(17);
  appKind.classList.remove("show");
  renderWorkText(true);
  showLayers("screen");
  await until(18);
  const typing = typeWork();
  await setHeadline("次の予定の5分前。");
  await until(21.5);
  snap("c03-working");
  await until(23.5);
  const entered = waitForApp("enter");
  appFrameMessage({ type: "click", selector: 'button.event-card[data-id="manual-2"]' });
  await entered;
  await typing;
  await until(25);
  await setHeadline("作業中でも、｜画面いっぱいに自動ではじまります。", "驚かなくて大丈夫。ゆっくリフレッシュの時間です");
  await until(29);
  snap("c04-started");

  // 何をすればよいか(31〜37.5秒)
  await until(31.5);
  await setHeadline("画面の一文にしたがって、｜ひとつの感覚を味わいます。", "霧が画面を満たしたら終わり。長くても60秒です");
  await until(35);
  snap("c05-sense");

  // Enterで、すぐ終えられる(38〜43秒)
  await until(38);
  await setHeadline("満足したら、そこでおしまい。", "Enterキーで、いつでも終えられます");
  keycap.classList.add("show");
  await until(41.2);
  await pressEnter();

  // 最後に色を選ぶ(43〜53秒)
  await until(43);
  await setHeadline("最後に、今の気分に近い色をひとつ。", "色を選ぶか、もう一度Enterで、元の作業に戻ります");
  await until(46);
  snap("c06-color");
  await until(48.5);
  const left = waitForApp("leave");
  await pressEnter();
  await left;
  await sleep(900);
  const resumed = typeWork();
  await until(51);
  snap("c07-back");
  await until(53);
  stopTyping();
  await resumed;

  // 4分前には終わる(53.5〜60秒)
  keycap.classList.remove("show");
  hideHeadline();
  showLayers("timeline");
  await until(54.5);
  await setHeadline("遅くとも4分前には終わるから、", "次の予定にも、ゆとりをもって向かえます");
  await until(56);
  timeline.classList.add("margin");
  await until(58.5);
  snap("c07-margin");
  await until(60);
  hideHeadline();
  showLayers();

  // 結び(61〜69秒)
  await until(61.2);
  await setHeadline("速さの中に、ちょうどよい遅さを。", "", "center");
  await until(63.2);
  showLayers("name");
  await until(65.5);
  snap("c08-closing");
  await until(68);
  hideHeadline();
  showLayers();
  await until(69.6);
}

// 短い版(約42秒)。体験に必要な情報だけを残し、「4分前には終わる」の場面は省く
async function runShortTimeline() {
  // もっと速く、もっと多く、もっと効率よく(0〜5秒)。3語がそろって2秒ほど読めるようにする
  const words = [...layers.fast.querySelectorAll(".fast-word")];
  for (const [index, word] of words.entries()) {
    await until(0.5 + index * 0.7);
    word.classList.add("show");
  }
  await until(4.4);
  words.forEach((word) => word.classList.add("blur"));

  // 何のためのものか(5〜10.5秒)
  await until(4.9);
  await setHeadline("そんな毎日に、ちょうどよい遅さを。", "", "center");
  await until(6.2);
  showLayers("name");
  appKind.classList.add("show");
  await until(8);
  snap("s01-concept");
  await until(10.2);
  hideHeadline();
  showLayers();

  // 作業中に、突然はじまる(11〜20.5秒)
  await until(11);
  appKind.classList.remove("show");
  renderWorkText(true);
  showLayers("screen");
  await until(11.6);
  const typing = typeWork();
  await setHeadline("次の予定の5分前。");
  await until(15);
  const entered = waitForApp("enter");
  appFrameMessage({ type: "click", selector: 'button.event-card[data-id="manual-2"]' });
  await entered;
  await typing;
  await until(16);
  await setHeadline("作業中でも、｜画面いっぱいに自動ではじまります。", "驚かなくて大丈夫。ゆっくリフレッシュの時間です");
  await until(19);
  snap("s02-started");

  // 何をすればよいか(21〜26秒)
  await until(21);
  await setHeadline("画面の一文にしたがって、｜ひとつの感覚を味わいます。", "霧が画面を満たしたら終わり。長くても60秒です");
  await until(24.5);
  snap("s03-sense");

  // Enterで、すぐ元の作業へ戻れる(26.5〜33秒)。色を選ぶ画面は一瞬映るだけにする
  await until(26.5);
  await setHeadline("満足したら、そこでおしまい。", "Enterキーで、すぐに元の作業へ戻れます");
  keycap.classList.add("show");
  await until(28.8);
  await pressEnter();
  await until(30);
  snap("s04-color");
  const left = waitForApp("leave");
  await pressEnter();
  await left;
  await sleep(700);
  const resumed = typeWork();
  await until(33);
  stopTyping();
  await resumed;
  keycap.classList.remove("show");
  hideHeadline();
  showLayers();

  // 結び(34〜39.5秒)
  await until(34);
  await setHeadline("速さの中に、ちょうどよい遅さを。", "", "center");
  await until(35.5);
  showLayers("name");
  await until(37);
  snap("s05-closing");
  await until(38.5);
  hideHeadline();
  showLayers();
  await until(39.9);
}

window.startDemo = async () => {
  t0 = Date.now();
  // 予定前の自動開始が録画中に起きないよう、時計は余裕のある時刻にしておく
  const base = new Date();
  base.setHours(9, 40, 0, 0);
  appFrame.src = `../../index.html?t0=${t0}&base=${base.getTime()}&slowRate=${SLOW_RATE}`;
  await new Promise((resolve) => appFrame.addEventListener("load", resolve, { once: true }));

  const stopRecording = await window.startRecording();
  t0 = Date.now();
  try {
    const variant = searchParams.get("variant");
    await (variant === "short" ? runShortTimeline() : runTimeline());
  } catch (error) {
    log(`timeline failed: ${error.stack || error}`);
  }
  await stopRecording();
  await window.demoBridge.done();
};
