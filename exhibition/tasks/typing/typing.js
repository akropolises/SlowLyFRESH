// 入力: 表示された言葉をローマ字で打ち込む。打ち終わると次の言葉に進み、下の表に1行増える。
// 打ち間違えても減点はなく、正しいキーを待つだけ。未入力の列はじわじわ伸びる
const words = window.TYPING_WORDS;
const queueEl = document.querySelector("#queue");
const queueCount = document.querySelector("#queueCount");
const promptEl = document.querySelector("#prompt");
const wordEl = document.querySelector("#word");
const kanaEl = document.querySelector("#kana");
const romajiEl = document.querySelector("#romaji");
const records = document.querySelector("#records");

const VISIBLE_QUEUE = 8;
const pickWord = TaskKit.picker(words);
const queue = Array.from({ length: 7 }, pickWord);
let current = null;
let typed = 0;
let recordNo = 1040 + Math.floor(Math.random() * 400);
let advancing = false;

function renderQueue(newCount = 0) {
  queueCount.textContent = queue.length;
  queueEl.innerHTML = "";
  queue.slice(0, VISIBLE_QUEUE).forEach((item, index) => {
    const li = document.createElement("li");
    li.textContent = item.word;
    if (index >= Math.min(queue.length, VISIBLE_QUEUE) - newCount) li.className = "new";
    queueEl.append(li);
  });
}

function renderRomaji({ miss = false } = {}) {
  const text = current.romaji;
  romajiEl.innerHTML = `<span class="typed">${text.slice(0, typed)}</span><span class="next${miss ? " miss" : ""}">${text[typed] || ""}</span>${text.slice(typed + 1)}`;
}

function nextWord() {
  current = queue.shift() || pickWord();
  if (queue.length < 3) queue.push(pickWord());
  typed = 0;
  promptEl.classList.remove("done");
  wordEl.textContent = current.word;
  kanaEl.textContent = current.kana;
  renderRomaji();
  renderQueue();
}

function addRecord(word) {
  recordNo += 1;
  const row = document.createElement("tr");
  row.className = "new";
  row.innerHTML = `<td>${recordNo}</td><td>${word}</td><td>入力済み</td>`;
  records.prepend(row);
  while (records.children.length > 30) records.lastElementChild.remove();
}

// 日本語入力がオンでも打てるよう、文字ではなく物理キー(KeyA など)で判定する
function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (code === "Minus") return "-";
  return null;
}

document.addEventListener("keydown", (event) => {
  if (TaskKit.paused || advancing || event.ctrlKey || event.altKey || event.metaKey) return;
  const key = keyFromCode(event.code);
  if (!key) return;
  event.preventDefault();

  if (key !== current.romaji[typed]) {
    renderRomaji({ miss: true });
    return;
  }
  typed += 1;
  renderRomaji();
  if (typed >= current.romaji.length) {
    advancing = true;
    promptEl.classList.add("done");
    addRecord(current.word);
    setTimeout(() => {
      advancing = false;
      nextWord();
    }, 280);
  }
});

// 未入力が少しずつ増えていく
TaskKit.every(3500, 6500, () => {
  const count = Math.random() < 0.3 ? 2 : 1;
  for (let i = 0; i < count; i += 1) queue.push(pickWord());
  renderQueue(count);
  queueCount.classList.remove("bump");
  void queueCount.offsetWidth;
  queueCount.classList.add("bump");
});

nextWord();
