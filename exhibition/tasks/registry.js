// 展示で使える作業の一覧。作業を増やすときは tasks/<id>/index.html を作り、ここに1件足す。
// 実際に使うかどうかは config.js の taskIds で決める。title はスタッフが切り替えたときに出る名前。
// windowTitle: 作業ウィンドウのタイトルバー / hint: 作業ウィンドウの上に出す一文(やり方がわかる程度に短く)
window.EXHIBITION_TASKS = [
  {
    id: "inbox",
    title: "受信トレイ",
    windowTitle: "メール - 受信トレイ",
    hint: "届いたものを、ボタンひとつで片づけていってください",
  },
  {
    id: "tabs",
    title: "タブとToDo",
    windowTitle: "ブラウザ",
    hint: "ToDoをクリックして開き、ページのボタンで片づけてください",
  },
  {
    id: "typing",
    title: "入力",
    windowTitle: "データ入力",
    hint: "表示された言葉を、ローマ字で打ち込んでください(日本語入力はオフのまま)",
  },
];
