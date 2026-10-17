// 受信トレイ: メールや承認依頼が次々に届き、ボタンひとつで片づけていく。
// 届くペースは片づけるペースより少しだけ速く、未読は減りきらない。正解・不正解はない
const { senders, mailSubjects, mailPreviews, approvals } = window.TASK_PHRASES;
const mailList = document.querySelector("#mailList");
const unreadBadge = document.querySelector("#unreadBadge");
const approvalBadge = document.querySelector("#approvalBadge");
const listMeta = document.querySelector("#listMeta");

const MAX_ROWS = 40;
const pickSender = TaskKit.picker(senders);
const pickSubject = TaskKit.picker(mailSubjects);
const pickPreview = TaskKit.picker(mailPreviews);
const pickApproval = TaskKit.picker(approvals);
// 一覧からあふれた分も未読として数え続ける(片づけきれない感じを残す)
let overflow = 0;
let arrivals = 0;

function createMail({ arriving }) {
  const isApproval = Math.random() < 0.3;
  const item = document.createElement("li");
  item.className = `mail${isApproval ? " approval" : ""}${arriving ? " arriving" : ""}`;
  item.dataset.arrivedAt = Date.now();
  const subject = isApproval ? `【承認依頼】${pickApproval()}` : pickSubject();
  item.innerHTML = `
    <span class="dot"></span>
    <span class="body">
      <span class="head"><span class="sender">${pickSender()}</span><span class="time">たった今</span></span>
      <span class="text"><span class="subject">${subject}</span><span class="preview">${pickPreview()}</span></span>
    </span>
    <span class="actions">
      ${
        isApproval
          ? '<button class="primary" type="button">承認</button><button type="button">差し戻し</button>'
          : '<button class="primary" type="button">既読</button><button type="button">アーカイブ</button>'
      }
    </span>
  `;
  return item;
}

function arrive() {
  arrivals += 1;
  mailList.prepend(createMail({ arriving: true }));
  while (mailList.children.length > MAX_ROWS) {
    mailList.lastElementChild.remove();
    overflow += 1;
  }
  updateCounts({ bump: true });
}

function updateCounts({ bump = false } = {}) {
  const rows = [...mailList.querySelectorAll(".mail:not(.leaving)")];
  const approvalsLeft = rows.filter((row) => row.classList.contains("approval")).length;
  unreadBadge.textContent = rows.length + overflow;
  approvalBadge.textContent = approvalsLeft;
  listMeta.textContent = `未読 ${rows.length + overflow}件`;
  if (bump) {
    unreadBadge.classList.remove("bump");
    void unreadBadge.offsetWidth;
    unreadBadge.classList.add("bump");
  }
}

// 1分未満は「たった今」、1時間未満は「◯分前」、それ以上は「◯時間前」
function timeAgoLabel(minutes) {
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.floor(minutes / 60)}時間前`;
}

function updateTimes() {
  const now = Date.now();
  mailList.querySelectorAll(".mail").forEach((row) => {
    const minutes = Math.floor((now - Number(row.dataset.arrivedAt)) / 60000);
    row.querySelector(".time").textContent = timeAgoLabel(minutes);
  });
}

mailList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || TaskKit.paused) return;
  const row = button.closest(".mail");
  if (row.classList.contains("leaving")) return;
  row.classList.add("leaving");
  setTimeout(() => row.remove(), 280);
  // 一覧からあふれていた分を、片づけた分だけ下から補充する。あふれていた分は一覧のどれよりも古い
  if (overflow > 0) {
    overflow -= 1;
    mailList.append(createOlderMail());
  }
  updateCounts();
  updateTimes();
});

// 一覧のいちばん下(いちばん古いメール)より、さらに数分前に届いていたメールを作る
function createOlderMail() {
  const rows = [...mailList.querySelectorAll(".mail:not(.leaving)")];
  const oldest = rows.length > 0 ? Math.min(...rows.map((row) => Number(row.dataset.arrivedAt))) : Date.now();
  const row = createMail({ arriving: false });
  row.dataset.arrivedAt = oldest - Math.round(TaskKit.randomBetween(2, 6)) * 60000;
  return row;
}

// 最初から少し溜まっている
for (let i = 0; i < 9; i += 1) {
  mailList.append(createOlderMail());
}
overflow = 14;
updateCounts();
updateTimes();

// 序盤はゆっくり、慣れたころに少し速くなる
TaskKit.every(1800, 3400, () => {
  arrive();
  if (arrivals > 8 && Math.random() < 0.35) TaskKit.after(500, arrive);
});
TaskKit.every(5000, 5000, updateTimes);
