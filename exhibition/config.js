// 展示の進行設定。会場や体験時間に合わせてここを調整する
window.EXHIBITION_CONFIG = {
  // 展示で使う作業(tasks/registry.js のid)。最初のものから始まり、スタッフが Ctrl+Shift+T で順に切り替える
  taskIds: ["inbox", "tabs"],
  // ゆっくリフレッシュは、「はじめる」からこの秒数以上あとの、いちばん近い分の区切りで差し込まれる
  // (20なら、押したときの秒が40以下で次の分、41以上でその次の分の区切り。押してから20〜80秒後)。次の予定は、その5分後になる
  minLeadSeconds: 20,
  // ゆっくリフレッシュから戻ってから、次の予定のリマインドが届くまでの秒数
  reminderDelaySeconds: 3,
  // リマインドに応えなかったときに、作業ウィンドウを自動で閉じて予定へ向かうまでの秒数(戻った時点から数える)
  autoLeaveSeconds: 30,
  // 終わりの画面を出しておく秒数(過ぎると開始画面へ戻る)
  endCardSeconds: 12,
  // 体験者の画面に出す「次の予定」の名前と長さ(開始時刻は体験ごとに決まる)
  meeting: { title: "定例ミーティング", duration: 60 },
  // 展示会場では成り立ちにくい体験(micro-slows.js のid)。展示の予定では選ばれない
  excludedSlowIds: ["hold-warm-object"],
};
