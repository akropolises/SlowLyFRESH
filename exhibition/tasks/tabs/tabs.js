// タブとToDo: ToDoをクリックするとその仕事のタブが開き、ページのボタンを押すと片づく(ToDoにチェックが入る)。
// 開いたタブは閉じない限りたまっていくので、急いで片づけるほど画面はとっ散らかる。
// ToDoは、右上に届く依頼のぶんだけ増える。どれから片づけてもよく、正解・不正解はない
const { senders } = window.TASK_PHRASES;
const todoTab = document.querySelector("#todoTab");
const tabsEl = document.querySelector("#tabs");
const tabOverflow = document.querySelector("#tabOverflow");
const address = document.querySelector("#address");
const bookmarks = document.querySelector("#bookmarks");
const todoPage = document.querySelector("#todoPage");
const todoList = document.querySelector("#todoList");
const todoCount = document.querySelector("#todoCount");
const workPage = document.querySelector("#workPage");
const workBreadcrumb = document.querySelector("#workBreadcrumb");
const workTitle = document.querySelector("#workTitle");
const workLines = document.querySelector("#workLines");
const workAction = document.querySelector("#workAction");
const workDone = document.querySelector("#workDone");
const requests = document.querySelector("#requests");
const downloadBar = document.querySelector("#downloadBar");
const downloadText = document.querySelector("#downloadText");
const downloadClose = document.querySelector("#downloadClose");

// ToDoと、それを片づけるために開くタブ、そのページで押すボタン。file があれば、押したあとにダウンロードのお知らせが出る
const JOBS = [
  { todo: "見積もりの確認", tab: "見積もり比較", action: "確認しました" },
  { todo: "議事録の共有", tab: "議事録 - 編集中", action: "共有する" },
  { todo: "経費の精算", tab: "経費精算システム", action: "申請する" },
  { todo: "資料の差し替え", tab: "資料_最終版", action: "差し替える" },
  { todo: "日程の再調整", tab: "カレンダー", action: "候補を送る" },
  { todo: "備品の発注", tab: "備品カタログ", action: "注文する" },
  { todo: "報告書の提出", tab: "報告書 - 提出", action: "提出する" },
  { todo: "請求書の確認", tab: "請求書_10月.pdf", action: "確認しました", file: "請求書_10月.pdf" },
  { todo: "スライドの修正", tab: "スライド_修正", action: "保存する" },
  { todo: "返信の下書き", tab: "メール - 下書き", action: "送信する" },
  { todo: "アンケートの集計", tab: "アンケート集計", action: "集計する", file: "集計結果.xlsx" },
  { todo: "勤怠の入力", tab: "勤怠", action: "登録する" },
  { todo: "契約書の確認", tab: "契約書.pdf", action: "確認しました", file: "契約書_控え.pdf" },
  { todo: "週報の作成", tab: "週報", action: "提出する" },
  { todo: "会議室の予約", tab: "会議室予約", action: "予約する" },
  { todo: "名簿の更新", tab: "名簿_最新", action: "保存する", file: "名簿_最新.csv" },
];
// 最初から開きっぱなしになっている、ToDoとは関係のないタブ
const LEFTOVER_TABS = ["社内ポータル", "チャット", "検索結果", "新しいタブ", "参考記事", "共有フォルダ"];
const BOOKMARKS = ["社内ポータル", "勤怠", "経費", "共有ドライブ", "マニュアル", "会議室予約", "チャット", "あとで読む", "参考", "旧ポータル", "テンプレ", "ヘルプ"];
const FAVICON_COLORS = ["#4f7fd0", "#d0624f", "#4fa86b", "#d0a24f", "#8a64c8", "#4fa7b3", "#8a94a3"];
const REQUEST_PHRASES = ["お願いします", "今日中にお願いします", "急ぎでお願いできますか", "対応お願いします"];
// タブは名前が少し読める幅までしか並べず、それ以上は古いものから右端の「+N」にまとめる
const MAX_VISIBLE_TABS = 12;

const pickJob = TaskKit.picker(JOBS);
const pickSender = TaskKit.picker(senders.filter((name) => !name.endsWith("者")));
const pickRequest = TaskKit.picker(REQUEST_PHRASES);
let hiddenTabs = 0;
let activeTab = todoTab;
let nextId = 1;

const pickFrom = (items) => items[Math.floor(Math.random() * items.length)];

// まだToDoにない仕事を優先して選ぶ(同じToDoが並ばないように)
function pickNewJob() {
  const pending = new Set([...todoList.querySelectorAll(".todo-item:not(.done)")].map((item) => item.job));
  const fresh = JOBS.filter((job) => !pending.has(job));
  return fresh.length > 0 ? pickFrom(fresh) : pickJob();
}

function bump(el) {
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

// ToDo
function addTodo(job, { arriving }) {
  const item = document.createElement("li");
  item.className = `todo-item${arriving ? " arriving" : ""}`;
  item.dataset.id = String(nextId++);
  item.job = job;
  item.innerHTML = `
    <span class="checkbox"></span>
    <span class="todo-text">${job.todo}</span>
    <span class="todo-open">開く ›</span>
  `;
  if (arriving) {
    todoList.prepend(item);
  } else {
    todoList.append(item);
  }
  updateTodoCount({ bumped: arriving });
}

function updateTodoCount({ bumped = false } = {}) {
  todoCount.textContent = todoList.querySelectorAll(".todo-item:not(.done)").length;
  if (bumped) bump(todoCount);
}

function completeTodo(todoId) {
  const item = todoList.querySelector(`.todo-item[data-id="${todoId}"]`);
  if (!item || item.classList.contains("done")) return;
  item.classList.add("done");
  item.querySelector(".checkbox").textContent = "✓";
  updateTodoCount();
  setTimeout(() => item.remove(), 900);
}

// ToDoをクリックすると、その仕事のタブを開く(もう開いていれば、そのタブに切り替える)
todoList.addEventListener("click", (event) => {
  const item = event.target.closest(".todo-item");
  if (!item || item.classList.contains("done") || TaskKit.paused) return;
  const opened = tabsEl.querySelector(`.tab[data-todo-id="${item.dataset.id}"]`);
  activate(opened || openTab({ title: item.job.tab, job: item.job, todoId: item.dataset.id }));
});

// タブ
function openTab({ title, job = null, todoId = null }) {
  const visible = [...tabsEl.children];
  if (visible.length >= MAX_VISIBLE_TABS) {
    const oldest = visible.find((tab) => tab !== activeTab);
    oldest.remove();
    hiddenTabs += 1;
    renderOverflow();
  }
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.job = job;
  tab.done = false;
  if (todoId) tab.dataset.todoId = todoId;
  tab.innerHTML = `
    <span class="favicon" style="--fav:${pickFrom(FAVICON_COLORS)}"></span>
    <span class="tab-title">${title}</span>
    <button class="close" type="button" aria-label="タブを閉じる">×</button>
  `;
  tabsEl.append(tab);
  return tab;
}

function renderOverflow() {
  tabOverflow.textContent = hiddenTabs > 0 ? `+${hiddenTabs}` : "";
}

function activate(tab) {
  activeTab.classList.remove("active");
  activeTab = tab;
  tab.classList.add("active");
  renderPage();
}

todoTab.addEventListener("click", () => {
  if (!TaskKit.paused) activate(todoTab);
});

tabsEl.addEventListener("click", (event) => {
  if (TaskKit.paused) return;
  const tab = event.target.closest(".tab");
  if (!tab || tab.classList.contains("closing")) return;
  if (!event.target.closest(".close")) {
    activate(tab);
    return;
  }
  tab.classList.add("closing");
  if (tab === activeTab) activate(todoTab);
  setTimeout(() => tab.remove(), 200);
});

// ページ。ToDoのタブならToDoの一覧、ほかのタブならその仕事のページ(関係のないタブは中身だけ)
function renderPage() {
  const isTodo = activeTab === todoTab;
  todoPage.classList.toggle("hidden", !isTodo);
  workPage.classList.toggle("hidden", isTodo);
  if (isTodo) {
    address.textContent = "work.example/todo/today";
    return;
  }
  const title = activeTab.querySelector(".tab-title").textContent;
  const { job, done } = activeTab;
  address.textContent = `work.example/${title}`;
  workBreadcrumb.textContent = job ? `ToDo › ${job.todo}` : "開いたままのページ";
  workTitle.textContent = title;
  workLines.innerHTML = Array.from({ length: 6 }, () => `<span style="width:${Math.round(TaskKit.randomBetween(45, 100))}%"></span>`).join("");
  workAction.classList.toggle("hidden", !job || done);
  workAction.textContent = job ? job.action : "";
  workDone.classList.toggle("hidden", !done);
}

// ページのボタンを押すと、その仕事が片づく。タブは開いたまま残る
workAction.addEventListener("click", () => {
  if (TaskKit.paused || !activeTab.job || activeTab.done) return;
  activeTab.done = true;
  activeTab.classList.add("is-done");
  completeTodo(activeTab.dataset.todoId);
  if (activeTab.job.file) showDownload(activeTab.job.file);
  renderPage();
});

// 依頼が届くと、右上にお知らせが出て、ToDoが1つ増える
function receiveRequest() {
  const job = pickNewJob();
  addTodo(job, { arriving: true });
  const note = document.createElement("div");
  note.className = "request";
  note.innerHTML = `<strong>${pickSender()}</strong><span>${job.todo}、${pickRequest()}</span>`;
  requests.prepend(note);
  while (requests.children.length > 3) requests.lastElementChild.remove();
  TaskKit.after(4500, () => {
    note.classList.add("leaving");
    TaskKit.after(300, () => note.remove());
  });
}

// ダウンロード完了のお知らせ(ファイルを扱う仕事を片づけたときだけ出る)
function showDownload(file) {
  downloadText.textContent = `${file} のダウンロードが完了しました`;
  downloadBar.classList.remove("hidden");
}

downloadClose.addEventListener("click", () => {
  if (!TaskKit.paused) downloadBar.classList.add("hidden");
});

BOOKMARKS.forEach((name) => {
  const mark = document.createElement("span");
  mark.textContent = name;
  bookmarks.append(mark);
});

// 最初から、関係のないタブがいくつか開きっぱなしで、ToDoもたまっている
LEFTOVER_TABS.forEach((title) => openTab({ title }));
for (let i = 0; i < 8; i += 1) addTodo(pickNewJob(), { arriving: false });
renderPage();

TaskKit.every(5000, 8000, receiveRequest);
